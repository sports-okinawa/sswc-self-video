// 写し元: athcon-video-self-edit/scripts/self/drive.test.mjs (485d27f)
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DriveAuthError, DriveRequestError, deleteFile, downloadFile, getAccessToken, listFiles, resetTokenCache, uploadFile } from "./drive.mjs"

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })
const tokenReply = (token = "tok", expires_in = 3600) => json({ access_token: token, expires_in })
const isToken = (url) => String(url).includes("oauth2")

let tmp
beforeEach(() => {
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid")
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret")
  vi.stubEnv("GOOGLE_OAUTH_REFRESH_TOKEN", "refresh")
  resetTokenCache()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drive-test-"))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("getAccessToken", () => {
  it("exchanges the refresh token and caches the result", async () => {
    const fetchMock = vi.fn(async () => tokenReply("abc"))
    vi.stubGlobal("fetch", fetchMock)
    expect(await getAccessToken()).toBe("abc")
    expect(await getAccessToken()).toBe("abc")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://oauth2.googleapis.com/token")
    expect(init.body.get("grant_type")).toBe("refresh_token")
    expect(init.body.get("refresh_token")).toBe("refresh")
  })

  it("refreshes again once the token is about to expire", async () => {
    const fetchMock = vi.fn(async () => tokenReply("short", 30)) // 有効期限が余裕時間(60秒)より短い
    vi.stubGlobal("fetch", fetchMock)
    await getAccessToken()
    await getAccessToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("throws DriveAuthError with the Japanese guidance on invalid_grant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_grant" }, 400)))
    const err = await getAccessToken().catch((e) => e)
    expect(err).toBeInstanceOf(DriveAuthError)
    expect(err.message).toBe("Googleドライブの許可が切れています。設定手順の『許可し直す』を行ってください")
  })
})

describe("downloadFile", () => {
  it("streams the file to disk with a Bearer header", async () => {
    const fetchMock = vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response("video-bytes")))
    vi.stubGlobal("fetch", fetchMock)
    const dest = path.join(tmp, "raw.mp4")
    await downloadFile("FILE1", dest)
    expect(fs.readFileSync(dest, "utf8")).toBe("video-bytes")
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toContain("/drive/v3/files/FILE1?alt=media")
    expect(init.headers.Authorization).toBe("Bearer tok")
  })

  it("refreshes once on 401 and throws DriveAuthError if it stays 401", async () => {
    const fetchMock = vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response("no", { status: 401 })))
    vi.stubGlobal("fetch", fetchMock)
    await expect(downloadFile("FILE1", path.join(tmp, "x.mp4"))).rejects.toBeInstanceOf(DriveAuthError)
    // token, 401, token(取り直し), 401
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("recovers when the attempt after a refresh succeeds", async () => {
    let driveCalls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (isToken(url)) return tokenReply()
        return ++driveCalls === 1 ? new Response("no", { status: 401 }) : new Response("ok")
      }),
    )
    const dest = path.join(tmp, "y.mp4")
    await downloadFile("FILE1", dest)
    expect(fs.readFileSync(dest, "utf8")).toBe("ok")
  })

  it("leaves neither the file nor a .part when the stream fails midway", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"))
      },
      pull(controller) {
        controller.error(new Error("connection reset"))
      },
    })
    vi.stubGlobal("fetch", vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response(body))))
    const dest = path.join(tmp, "broken.mp4")
    await expect(downloadFile("FILE1", dest)).rejects.toThrow("connection reset")
    expect(fs.existsSync(dest)).toBe(false)
    expect(fs.existsSync(`${dest}.part`)).toBe(false)
  })

  it("throws a readable error on other failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response("gone", { status: 404 }))))
    await expect(downloadFile("FILE1", path.join(tmp, "z.mp4"))).rejects.toThrow(/ダウンロード.*404/)
  })
})

describe("uploadFile", () => {
  it("starts a resumable session then PUTs the file, returning id and webViewLink", async () => {
    const local = path.join(tmp, "out.mp4")
    fs.writeFileSync(local, "0123456789")
    const calls = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (isToken(url)) return tokenReply()
        calls.push({ url: String(url), init })
        if (init.method === "POST") return new Response(null, { status: 200, headers: { Location: "https://upload.example/session1" } })
        return json({ id: "NEWID", webViewLink: "https://drive.google.com/file/d/NEWID/view" })
      }),
    )
    const result = await uploadFile("FOLDER", local, "動画.mp4", "video/mp4")
    expect(result).toEqual({ id: "NEWID", webViewLink: "https://drive.google.com/file/d/NEWID/view" })

    const [start, put] = calls
    expect(start.url).toContain("uploadType=resumable")
    expect(start.url).toContain("fields=id,webViewLink")
    expect(start.init.headers.Authorization).toBe("Bearer tok")
    expect(start.init.headers["X-Upload-Content-Length"]).toBe("10")
    expect(JSON.parse(start.init.body)).toEqual({ name: "動画.mp4", parents: ["FOLDER"] })
    expect(put.url).toBe("https://upload.example/session1")
    expect(put.init.method).toBe("PUT")
    expect(put.init.headers["Content-Length"]).toBe("10")
    expect(put.init.duplex).toBe("half")
  })

  it("sends appProperties in the session metadata when given", async () => {
    const local = path.join(tmp, "p.mp4")
    fs.writeFileSync(local, "x")
    const calls = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (isToken(url)) return tokenReply()
        calls.push(init)
        if (init.method === "POST") return new Response(null, { status: 200, headers: { Location: "https://upload.example/s" } })
        return json({ id: "ID", webViewLink: "w" })
      }),
    )
    await uploadFile("FOLDER", local, "a.mp4", "video/mp4", { scriptId: "p1", jobId: "j1" })
    expect(JSON.parse(calls[0].body)).toEqual({ name: "a.mp4", parents: ["FOLDER"], appProperties: { scriptId: "p1", jobId: "j1" } })
  })

  it("fails clearly when the session has no Location", async () => {
    const local = path.join(tmp, "a.mp4")
    fs.writeFileSync(local, "x")
    vi.stubGlobal("fetch", vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response(null, { status: 200 }))))
    await expect(uploadFile("F", local, "a.mp4", "video/mp4")).rejects.toThrow(/アップロード先/)
  })

  it("throws a DriveRequestError with the HTTP status and Drive's reason, without the raw body in the message", async () => {
    const local = path.join(tmp, "q.mp4")
    fs.writeFileSync(local, "x")
    const body = {
      error: {
        code: 403,
        message: "The user's Drive storage quota has been exceeded.",
        errors: [{ domain: "usageLimits", reason: "storageQuotaExceeded", message: "The user's Drive storage quota has been exceeded." }],
      },
    }
    vi.stubGlobal("fetch", vi.fn(async (url) => (isToken(url) ? tokenReply() : json(body, 403))))
    const err = await uploadFile("F", local, "q.mp4", "video/mp4").catch((e) => e)
    expect(err).toBeInstanceOf(DriveRequestError)
    expect(err).toMatchObject({ name: "DriveRequestError", status: 403, reason: "storageQuotaExceeded" })
    expect(err.message).toBe("ドライブのアップロード開始に失敗しました(HTTP 403)")
  })

  it("leaves the reason empty when the error body is not Drive JSON", async () => {
    const local = path.join(tmp, "r.mp4")
    fs.writeFileSync(local, "x")
    vi.stubGlobal("fetch", vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response("<html>oops</html>", { status: 502 }))))
    const err = await uploadFile("F", local, "r.mp4", "video/mp4").catch((e) => e)
    expect(err).toMatchObject({ name: "DriveRequestError", status: 502, reason: "" })
    expect(err.message).not.toContain("oops")
  })
})

describe("deleteFile", () => {
  it("treats 404 as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response(null, { status: 404 }))))
    await expect(deleteFile("GONE")).resolves.toBeUndefined()
  })
  it("sends DELETE and accepts 204", async () => {
    const fetchMock = vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response(null, { status: 204 })))
    vi.stubGlobal("fetch", fetchMock)
    await deleteFile("F1")
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE")
  })
  it("throws on other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response("x", { status: 500 }))))
    await expect(deleteFile("F1")).rejects.toThrow(/削除.*500/)
  })
})

describe("listFiles", () => {
  it("passes the query and follows pages", async () => {
    const urls = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (isToken(url)) return tokenReply()
        urls.push(new URL(String(url)))
        return urls.length === 1 ? json({ files: [{ id: "a" }], nextPageToken: "NEXT" }) : json({ files: [{ id: "b" }] })
      }),
    )
    const files = await listFiles("trashed=false", "id,name")
    expect(files).toEqual([{ id: "a" }, { id: "b" }])
    expect(urls[0].searchParams.get("q")).toBe("trashed=false")
    expect(urls[0].searchParams.get("fields")).toBe("nextPageToken,files(id,name)")
    expect(urls[1].searchParams.get("pageToken")).toBe("NEXT")
  })
  it("stops with an error after 50 pages instead of looping forever", async () => {
    let pages = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (isToken(url)) return tokenReply()
        pages++
        return json({ files: [], nextPageToken: "AGAIN" })
      }),
    )
    await expect(listFiles("q")).rejects.toThrow(/50 ページ/)
    expect(pages).toBe(50)
  })
  it("throws on an error response", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (isToken(url) ? tokenReply() : new Response("x", { status: 500 }))))
    await expect(listFiles("q")).rejects.toThrow(/一覧の取得.*500/)
  })
})

