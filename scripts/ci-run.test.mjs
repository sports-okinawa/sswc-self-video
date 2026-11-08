import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DriveAuthError, DriveRequestError } from "./lib/drive.mjs"
import {
  ASSETS_MISSING_WARNING,
  AUTH_REASON,
  DRIVE_FULL_REASON,
  GENERIC_REASON,
  SOURCE_TRASH_WARNING,
  doneBaseName,
  pickBgm,
  runCi,
  sign,
} from "./ci-run.mjs"

const SECRET = "test-secret"
const JOB_ID = "11111111-2222-3333-4444-555555555555"
const SOURCE_ID = "SRC-FILE-ID-abcdef123"
const SCRIPT_ID = "6650aa00bb11cc22dd33ee44"
const TITLE = "筋トレ前のストレッチ、実は逆効果？"
const SCRIPT_LINE = "研究では、長く伸ばすと力が##5%##下がりました。"
const APP = "https://app.example.test"

const job = {
  jobId: JOB_ID,
  scriptId: SCRIPT_ID,
  title: TITLE,
  scenes: [{ role: "つかみ", lines: [SCRIPT_LINE] }],
  citation: "Behm DG, et al.(2016)Appl Physiol Nutr Metab",
  captions: { powerlab: "キャプション", itomanPark: "キャプション" },
  fileId: SOURCE_ID,
  endCard: ["パワーラボ浦添 / 糸満パーク", "初めての方は30日間無料", "プロフィールのリンクから"],
}

const env = {
  APP_BASE_URL: APP,
  SSWC_VIDEO_SECRET: SECRET,
  SSWC_SELF_DRIVE_DONE_FOLDER_ID: "DONE-FOLDER-ID",
  SSWC_SELF_DRIVE_ASSETS_FOLDER_ID: "ASSETS-FOLDER-ID",
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

/** fetch の差し替え: ジョブの取得と結果の通知を記録する */
const makeFetch = ({ jobStatus = 200 } = {}) => {
  const posts = []
  const gets = []
  const fetchImpl = vi.fn(async (url, init = {}) => {
    if ((init.method ?? "GET") === "GET") {
      gets.push({ url: String(url), headers: init.headers })
      return jobStatus === 200 ? json(job) : json({ error: "x" }, jobStatus)
    }
    posts.push({ url: String(url), headers: init.headers, body: init.body, payload: JSON.parse(init.body) })
    return json({ ok: true })
  })
  return { fetchImpl, posts, gets }
}

let uploadSeq = 0
/** ドライブの差し替え */
const makeDrive = (over = {}) => {
  const calls = { uploads: [], trashed: [], deleted: [], downloads: [] }
  const drive = {
    listFiles: vi.fn(async () => [
      { id: "BGM-1", name: "bgm-a.mp3" },
      { id: "BGM-2", name: "bgm-b.mp3" },
      { id: "HIT", name: "sfx-hit.wav" },
      { id: "WHOOSH", name: "sfx-whoosh.wav" },
    ]),
    downloadFile: vi.fn(async (id, dest) => {
      calls.downloads.push(id)
      fs.writeFileSync(dest, "x")
    }),
    uploadFile: vi.fn(async (folderId, localPath, name, mime) => {
      calls.uploads.push({ folderId, name, mime })
      uploadSeq++
      return { id: `UP-${uploadSeq}`, webViewLink: "https://drive.google.com/x" }
    }),
    trashFile: vi.fn(async (id) => {
      calls.trashed.push(id)
    }),
    deleteFile: vi.fn(async (id) => {
      calls.deleted.push(id)
    }),
    ...over,
  }
  return { drive, calls }
}

const doneEdit = vi.fn(async ({ workDir }) => {
  const finalPath = path.join(workDir, "final.mp4")
  const coverPath = path.join(workDir, "cover.png")
  fs.writeFileSync(finalPath, "v")
  fs.writeFileSync(coverPath, "c")
  return { status: "done", reasons: [], warnings: [], finalPath, coverPath, durationSec: 88.4, foundRatio: 1 }
})

let tmp
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ci-run-test-"))
  uploadSeq = 0
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const run = (deps) =>
  runCi({ jobId: JOB_ID, env, deps: { workDir: tmp, sleep: async () => {}, now: () => new Date("2026-11-08T03:00:00Z"), ...deps } })

describe("runCi", () => {
  it("fetches the job with a signed request, then notifies running → done with resultFileId", async () => {
    const { fetchImpl, posts, gets } = makeFetch()
    const { drive, calls } = makeDrive()
    const result = await run({ fetchImpl, drive, edit: doneEdit })

    expect(gets).toHaveLength(1)
    const u = new URL(gets[0].url)
    expect(u.origin + u.pathname).toBe(`${APP}/api/sswc-video/job`)
    expect(u.searchParams.get("jobId")).toBe(JOB_ID)
    const ts = u.searchParams.get("ts")
    expect(gets[0].headers["X-Signature"]).toBe(sign(SECRET, `${JOB_ID}.${ts}`))

    expect(posts.map((p) => p.payload.status)).toEqual(["running", "done"])
    for (const p of posts) {
      expect(p.url).toBe(`${APP}/api/webhooks/sswc-self-video`)
      expect(p.headers["X-Signature"]).toBe(`sha256=${crypto.createHmac("sha256", SECRET).update(p.body).digest("hex")}`)
    }
    const done = posts[1].payload
    expect(done.jobId).toBe(JOB_ID)
    expect(done.resultFileId).toBe("UP-1")
    expect(done.videoUrl).toBe("https://drive.google.com/file/d/UP-1/view")
    expect(done.coverUrl).toBe("https://drive.google.com/file/d/UP-2/view")
    expect(done.durationSec).toBe(88.4)
    expect(done.warnings).toEqual([])

    // ファイル名にタイトルを入れない
    expect(calls.uploads).toEqual([
      { folderId: "DONE-FOLDER-ID", name: "20261108_ddee44.mp4".replace("ddee44", SCRIPT_ID.slice(-6)), mime: "video/mp4" },
      { folderId: "DONE-FOLDER-ID", name: `20261108_${SCRIPT_ID.slice(-6)}_cover.png`, mime: "image/png" },
    ])
    expect(calls.trashed).toEqual([SOURCE_ID])
    expect(result.exitCode).toBe(0)
    expect(result.delivered).toBe(true)
  })

  it("passes job, assets and the downloaded source video to edit", async () => {
    const { fetchImpl } = makeFetch()
    const { drive, calls } = makeDrive()
    const edit = vi.fn(doneEdit)
    await run({ fetchImpl, drive, edit })
    const arg = edit.mock.calls[0][0]
    expect(arg.job.scriptId).toBe(SCRIPT_ID)
    expect(fs.existsSync(arg.videoPath)).toBe(true)
    expect(arg.assets.bgm).toMatch(/bgm\.mp3$/)
    expect(arg.assets.hit).toMatch(/sfx-hit\.wav$/)
    expect(arg.assets.whoosh).toMatch(/sfx-whoosh\.wav$/)
    expect(calls.downloads).toContain(SOURCE_ID)
  })

  it("source trash 403 becomes warning", async () => {
    const { fetchImpl, posts } = makeFetch()
    const { drive } = makeDrive({
      trashFile: vi.fn(async () => {
        throw new DriveRequestError("更新", 403, "insufficientFilePermissions")
      }),
    })
    const result = await run({ fetchImpl, drive, edit: doneEdit })
    const done = posts.at(-1).payload
    expect(done.status).toBe("done")
    expect(done.warnings).toEqual([SOURCE_TRASH_WARNING])
    expect(SOURCE_TRASH_WARNING).toBe("元の動画を消せませんでした。ドライブの未編集フォルダから削除してください")
    expect(result.exitCode).toBe(0)
  })

  it("source trash 404 is silent", async () => {
    const { fetchImpl, posts } = makeFetch()
    const { drive } = makeDrive({
      trashFile: vi.fn(async () => {
        throw new DriveRequestError("更新", 404, "notFound")
      }),
    })
    await run({ fetchImpl, drive, edit: doneEdit })
    expect(posts.at(-1).payload.warnings).toEqual([])
  })

  it("does not write to the done folder when edit fails, and forwards edit's reasons", async () => {
    const { fetchImpl, posts } = makeFetch()
    const { drive, calls } = makeDrive()
    const edit = vi.fn(async () => ({ status: "failed", reasons: ["横向きで撮影されています。縦向きで撮り直してください"], warnings: [] }))
    const result = await run({ fetchImpl, drive, edit })
    expect(calls.uploads).toEqual([])
    expect(calls.trashed).toEqual([])
    expect(posts.map((p) => p.payload.status)).toEqual(["running", "failed"])
    expect(posts[1].payload.reasons).toEqual(["横向きで撮影されています。縦向きで撮り直してください"])
    expect(result.exitCode).toBe(1)
  })

  it("exits 1 without any notification when the job cannot be fetched", async () => {
    const { fetchImpl, posts } = makeFetch({ jobStatus: 404 })
    const { drive } = makeDrive()
    const logs = vi.spyOn(console, "log").mockImplementation(() => {})
    const result = await run({ fetchImpl, drive, edit: doneEdit })
    expect(posts).toEqual([])
    expect(result.exitCode).toBe(1)
    expect(logs.mock.calls.map((c) => c.join(" "))).toContain("step: job fetch failed 404")
  })

  it("continues with a warning when BGM/SFX are missing", async () => {
    const { fetchImpl, posts } = makeFetch()
    const { drive } = makeDrive({ listFiles: vi.fn(async () => [{ id: "HIT", name: "sfx-hit.wav" }]) })
    const edit = vi.fn(doneEdit)
    await run({ fetchImpl, drive, edit })
    expect(edit.mock.calls[0][0].assets).toMatchObject({ bgm: null, whoosh: null })
    expect(posts.at(-1).payload.status).toBe("done")
    expect(posts.at(-1).payload.warnings).toEqual([ASSETS_MISSING_WARNING])
  })

  it("maps drive storage quota errors on upload to the fixed reason and removes partial uploads", async () => {
    const { fetchImpl, posts } = makeFetch()
    let n = 0
    const { drive, calls } = makeDrive({
      uploadFile: vi.fn(async () => {
        n++
        if (n === 2) throw new DriveRequestError("アップロード", 403, "storageQuotaExceeded")
        return { id: "UP-PART", webViewLink: "" }
      }),
    })
    const result = await run({ fetchImpl, drive, edit: doneEdit })
    const last = posts.at(-1).payload
    expect(last.status).toBe("failed")
    expect(last.reasons).toEqual([DRIVE_FULL_REASON])
    expect(DRIVE_FULL_REASON).toBe("ATHCON のドライブの空き容量が足りません")
    expect(calls.deleted).toEqual(["UP-PART"])
    expect(calls.trashed).toEqual([])
    expect(result.exitCode).toBe(1)
  })

  it("maps an expired Google permission to the fixed reason", async () => {
    const { fetchImpl, posts } = makeFetch()
    const { drive } = makeDrive({
      downloadFile: vi.fn(async () => {
        throw new DriveAuthError()
      }),
    })
    await run({ fetchImpl, drive, edit: doneEdit })
    expect(posts.at(-1).payload.reasons).toEqual([AUTH_REASON])
    expect(AUTH_REASON.startsWith("Googleドライブの許可が切れています")).toBe(true)
  })

  it("never forwards raw error messages (paths, ids) as reasons", async () => {
    const { fetchImpl, posts } = makeFetch()
    const { drive } = makeDrive()
    const edit = vi.fn(async () => {
      throw new Error(`ffmpeg failed: C:\\work\\${SOURCE_ID}.mp4`)
    })
    const errs = vi.spyOn(console, "error").mockImplementation(() => {})
    const logs = vi.spyOn(console, "log").mockImplementation(() => {})
    await run({ fetchImpl, drive, edit })
    expect(posts.at(-1).payload.reasons).toEqual([GENERIC_REASON])
    const all = [...logs.mock.calls, ...errs.mock.calls].map((c) => c.join(" ")).join("\n")
    expect(all).not.toContain(SOURCE_ID)
    expect(all).not.toContain("ffmpeg failed")
  })

  it("logs only fixed phrases and numbers (no fileId, title, script text or URL)", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {})
    const errs = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const scenario of ["done", "failed", "trash403", "quota"]) {
      const { fetchImpl } = makeFetch()
      const over =
        scenario === "trash403"
          ? { trashFile: vi.fn(async () => { throw new DriveRequestError("更新", 403, "x") }) }
          : scenario === "quota"
            ? { uploadFile: vi.fn(async () => { throw new DriveRequestError("アップロード", 403, "storageQuotaExceeded") }) }
            : {}
      const { drive } = makeDrive(over)
      const edit =
        scenario === "failed" ? vi.fn(async () => ({ status: "failed", reasons: ["x"], warnings: [] })) : doneEdit
      await run({ fetchImpl, drive, edit })
    }
    const lines = [...logs.mock.calls, ...errs.mock.calls].map((c) => c.map(String).join(" "))
    expect(lines.length).toBeGreaterThan(0)
    const all = lines.join("\n")
    for (const secret of [SOURCE_ID, JOB_ID, SCRIPT_ID, TITLE, "研究では", "DONE-FOLDER-ID", "ASSETS-FOLDER-ID", "UP-1", "BGM-1", "http", SECRET]) {
      expect(all).not.toContain(secret)
    }
    for (const l of lines) expect(l).toMatch(/^step: [a-z0-9 .:/-]+$/i)
  })
})

describe("helpers", () => {
  it("doneBaseName is yyyyMMdd (JST) + last 6 of scriptId", () => {
    // 2026-11-08 20:00 UTC は日本時間で 11/9
    expect(doneBaseName(SCRIPT_ID, new Date("2026-11-08T20:00:00Z"))).toBe(`20261109_${SCRIPT_ID.slice(-6)}`)
  })

  it("pickBgm chooses deterministically by jobId among bgm*.mp3", () => {
    const files = [
      { id: "a", name: "bgm-a.mp3" },
      { id: "b", name: "bgm-b.mp3" },
      { id: "c", name: "readme.txt" },
      { id: "d", name: "BGM-c.MP3" },
    ]
    const first = pickBgm(files, JOB_ID)
    expect(["a", "b", "d"]).toContain(first.id)
    expect(pickBgm([...files].reverse(), JOB_ID).id).toBe(first.id)
    expect(pickBgm([{ id: "c", name: "readme.txt" }], JOB_ID)).toBeNull()
  })
})
