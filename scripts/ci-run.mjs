// GitHub Actions の入口: ジョブ取得 → 素材と元動画の取得 → 編集 → 完成フォルダへアップロード → 元動画の片付け → 結果の通知
// 写し元の考え方: athcon-video-self-edit/scripts/self/ci-run.mjs (485d27f)
//
// このリポジトリは公開で、Actions のログは誰でも見られる。ログに出すのは「step: 固定の文 数値」だけ。
// 台本・タイトル・ファイル ID・ファイル名・URL・エラーの本文(パスや ID を含みうる)は出さず、webhook の理由にも入れない。
//
// 入力(環境変数): JOB_ID
// 秘密: APP_BASE_URL・SSWC_VIDEO_SECRET・SSWC_SELF_DRIVE_DONE_FOLDER_ID・SSWC_SELF_DRIVE_ASSETS_FOLDER_ID・GOOGLE_OAUTH_*(drive.mjs)
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { DriveAuthError, DriveRequestError, deleteFile, downloadFile, listFiles, trashFile, uploadFile } from "./lib/drive.mjs"

const RETRIES = 3 // 最初の 1 回に加えて、失敗したら最大 3 回まで再送
const RETRY_WAIT_MS = 2000

// 失敗の理由・警告(スタッフが画面とメールで読む文。固定)
export const GENERIC_REASON = "動画の編集中にエラーが起きました。もう一度「動画を編集」を押してください"
export const DRIVE_FULL_REASON = "ATHCON のドライブの空き容量が足りません"
export const AUTH_REASON = new DriveAuthError().message
export const SOURCE_NOT_FOUND_REASON = "元の動画が見つかりませんでした。ドライブの未編集フォルダに動画があるか確認して、選び直してください"
export const UPLOAD_FAILED_REASON = "完成した動画をドライブに保存できませんでした。もう一度「動画を編集」を押してください"
export const SOURCE_TRASH_WARNING = "元の動画を消せませんでした。ドライブの未編集フォルダから削除してください"
export const ASSETS_MISSING_WARNING = "BGM/効果音がありません"

/** HMAC-SHA256 の署名。webapp の libs/sswcPaper/signature.ts と同じ "sha256=<hex>" */
export const sign = (secret, raw) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 固定の文と数値だけのログ */
const step = (msg) => console.log(`step: ${msg}`)

const isAuthError = (e) => e instanceof DriveAuthError || e?.name === "DriveAuthError"
const isDriveError = (e) => e instanceof DriveRequestError || e?.name === "DriveRequestError"

/** 通知先・取得先は https(手元の確認用に http://localhost だけ許す) */
const allowedBase = (appBaseUrl) => {
  try {
    const u = new URL(appBaseUrl)
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  } catch {
    return false
  }
}

const endpoint = (appBaseUrl, p) => `${appBaseUrl.replace(/\/+$/, "")}${p}`

/**
 * 結果を webapp に通知する。ネットワークエラーと 5xx は再送、4xx は再送しない。通知の失敗で処理は止めない(false を返す)。
 * @returns {Promise<boolean>} 届いたか
 */
export async function postCallback({ appBaseUrl, secret, payload, fetchImpl = fetch, sleep = defaultSleep }) {
  if (!allowedBase(appBaseUrl)) {
    step("notify skipped bad base")
    return false
  }
  const body = JSON.stringify(payload)
  const headers = { "Content-Type": "application/json", "X-Signature": sign(secret, body) }
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_WAIT_MS * attempt)
    try {
      const res = await fetchImpl(endpoint(appBaseUrl, "/api/webhooks/sswc-self-video"), { method: "POST", headers, body })
      if (res.ok) return true
      if (res.status < 500) {
        step(`notify rejected ${res.status}`)
        return false
      }
      step(`notify failed ${res.status} retry ${attempt + 1}/${RETRIES + 1}`)
    } catch {
      step(`notify failed network retry ${attempt + 1}/${RETRIES + 1}`)
    }
  }
  return false
}

/** ジョブの中身を署名つきで取る。失敗なら { status } */
async function fetchJob({ appBaseUrl, secret, jobId, fetchImpl, now }) {
  if (!allowedBase(appBaseUrl) || !secret || !jobId) return { status: 0 }
  const ts = String(Math.floor(now().getTime() / 1000))
  const url = `${endpoint(appBaseUrl, "/api/sswc-video/job")}?${new URLSearchParams({ jobId, ts })}`
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { "X-Signature": sign(secret, `${jobId}.${ts}`) } })
    if (!res.ok) return { status: res.status }
    const job = await res.json()
    if (!job || typeof job.fileId !== "string" || !Array.isArray(job.scenes) || typeof job.scriptId !== "string") return { status: 422 }
    return { status: 200, job }
  } catch {
    return { status: 0 }
  }
}

/** 日本時間の yyyyMMdd + 台本 ID の末尾 6 文字(タイトルは入れない) */
export const doneBaseName = (scriptId, date = new Date()) => {
  const j = new Date(date.getTime() + 9 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, "0")
  const safeId = String(scriptId).replace(/[^0-9A-Za-z]/g, "").slice(-6)
  return `${j.getUTCFullYear()}${p(j.getUTCMonth() + 1)}${p(j.getUTCDate())}_${safeId}`
}

/** bgm*.mp3 から jobId のハッシュで 1 つ選ぶ(名前順に並べてから選ぶので、一覧の順番に左右されない) */
export const pickBgm = (files, jobId) => {
  const list = files.filter((f) => /^bgm.*\.mp3$/i.test(f.name ?? "")).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (list.length === 0) return null
  const h = crypto.createHash("sha256").update(String(jobId)).digest().readUInt32BE(0)
  return list[h % list.length]
}

const escapeQuery = (v) => String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")

/**
 * 「素材」フォルダから BGM と効果音を取る。無い・取れないものは null(警告を 1 つ返す)。許可切れだけは投げる
 * @returns {Promise<{ assets: { bgm: string|null; hit: string|null; whoosh: string|null }; warning: string|null }>}
 */
async function fetchAssets({ drive, folderId, jobId, dir }) {
  const assets = { bgm: null, hit: null, whoosh: null }
  if (!folderId) return { assets, warning: ASSETS_MISSING_WARNING }
  let files = []
  try {
    files = await drive.listFiles(`'${escapeQuery(folderId)}' in parents and trashed=false`, "id,name")
  } catch (e) {
    if (isAuthError(e)) throw e
    step("assets list failed")
  }
  fs.mkdirSync(dir, { recursive: true })
  const wanted = [
    ["bgm", pickBgm(files, jobId), "bgm.mp3"],
    ["hit", files.find((f) => f.name === "sfx-hit.wav") ?? null, "sfx-hit.wav"],
    ["whoosh", files.find((f) => f.name === "sfx-whoosh.wav") ?? null, "sfx-whoosh.wav"],
  ]
  for (const [key, file, local] of wanted) {
    if (!file) continue
    const dest = path.join(dir, local)
    try {
      await drive.downloadFile(file.id, dest)
      assets[key] = dest
    } catch (e) {
      if (isAuthError(e)) throw e
      step(`asset download failed ${key}`)
    }
  }
  const missing = Object.values(assets).filter((v) => v === null).length
  step(`assets ready ${3 - missing}/3`)
  return { assets, warning: missing > 0 ? ASSETS_MISSING_WARNING : null }
}

const defaultEdit = async (p) => (await import("./edit.mjs")).edit(p)

/**
 * 1 本分の処理。例外は投げない。
 * @param {{ jobId: string; env: Record<string, string|undefined>; deps?: object }} p
 *   deps: fetchImpl / drive / edit / workDir / now / sleep(テスト用の差し替え)
 * @returns {Promise<{ exitCode: number; delivered: boolean; payload?: object }>}
 */
export async function runCi({ jobId, env, deps = {} }) {
  const fetchImpl = deps.fetchImpl ?? fetch
  const drive = deps.drive ?? { listFiles, downloadFile, uploadFile, trashFile, deleteFile }
  const editFn = deps.edit ?? defaultEdit
  const now = deps.now ?? (() => new Date())
  const appBaseUrl = env.APP_BASE_URL ?? ""
  const secret = env.SSWC_VIDEO_SECRET ?? ""

  // 1. ジョブの中身(取れなければ通知もできないので止める)
  const fetched = await fetchJob({ appBaseUrl, secret, jobId, fetchImpl, now })
  if (fetched.status !== 200) {
    step(`job fetch failed ${fetched.status}`)
    return { exitCode: 1, delivered: false }
  }
  const job = fetched.job
  step(`job fetched scenes ${job.scenes.length}`)

  const notify = (payload) => postCallback({ appBaseUrl, secret, payload: { jobId, ...payload }, fetchImpl, sleep: deps.sleep })
  const finish = async (payload) => {
    const delivered = await notify(payload)
    step(`notify ${payload.status} ${delivered ? "delivered" : "not delivered"}`)
    return { exitCode: payload.status === "done" && delivered ? 0 : 1, delivered, payload: { jobId, ...payload } }
  }

  // 2. 編集中(届かないなら結果も届かないので、時間のかかる編集はせずに止める)
  if (!(await notify({ status: "running" }))) {
    step("notify running not delivered")
    return { exitCode: 1, delivered: false }
  }
  step("notify running delivered")

  const work = deps.workDir ?? fs.mkdtempSync(path.join(env.RUNNER_TEMP ?? os.tmpdir(), "sswc-self-video-"))
  const warnings = []
  const failed = (reasons) => finish({ status: "failed", reasons, warnings })
  try {
    // 3. BGM・効果音
    const { assets, warning } = await fetchAssets({ drive, folderId: env.SSWC_SELF_DRIVE_ASSETS_FOLDER_ID, jobId, dir: path.join(work, "assets") })
    if (warning) warnings.push(warning)

    // 4. 元動画 → 編集
    const videoPath = path.join(work, "source-video")
    try {
      await drive.downloadFile(job.fileId, videoPath)
    } catch (e) {
      if (isAuthError(e)) throw e
      step(`source download failed ${isDriveError(e) ? e.status : 0}`)
      return await failed([isDriveError(e) && e.status === 404 ? SOURCE_NOT_FOUND_REASON : GENERIC_REASON])
    }
    step(`source downloaded ${Math.round(fs.statSync(videoPath).size / 1048576)}MB`)

    const editDir = path.join(work, "edit")
    fs.mkdirSync(editDir, { recursive: true })
    const result = await editFn({ job, videoPath, workDir: editDir, assets })
    warnings.push(...(result.warnings ?? []))
    if (result.status !== "done" || !result.finalPath || !result.coverPath) {
      step(`edit failed reasons ${result.reasons?.length ?? 0}`)
      return await failed(result.reasons?.length ? result.reasons : [GENERIC_REASON])
    }
    step(`edit done ${Math.round(result.durationSec ?? 0)}s`)

    // 5. 完成フォルダへ(途中まで上げたものは消す)
    const base = doneBaseName(job.scriptId, now())
    const folder = env.SSWC_SELF_DRIVE_DONE_FOLDER_ID ?? ""
    const uploaded = []
    let video
    let cover
    try {
      if (!folder) throw new Error("no done folder")
      video = await drive.uploadFile(folder, result.finalPath, `${base}.mp4`, "video/mp4")
      uploaded.push(video.id)
      cover = await drive.uploadFile(folder, result.coverPath, `${base}_cover.png`, "image/png")
      uploaded.push(cover.id)
    } catch (e) {
      for (const id of uploaded) {
        try {
          await drive.deleteFile(id)
        } catch {
          step("partial upload cleanup failed")
        }
      }
      if (isAuthError(e)) throw e
      step(`upload failed ${isDriveError(e) ? e.status : 0}`)
      return await failed([isDriveError(e) && e.reason === "storageQuotaExceeded" ? DRIVE_FULL_REASON : UPLOAD_FAILED_REASON])
    }
    step("upload done 2 files")

    // 元動画をゴミ箱へ(持ち主がスタッフだと 403 → 警告。すでに無い 404 は警告なし)
    try {
      await drive.trashFile(job.fileId)
      step("source trashed")
    } catch (e) {
      if (isDriveError(e) && e.status === 404) {
        step("source trash 404")
      } else {
        step(`source trash failed ${isDriveError(e) ? e.status : 0}`)
        warnings.push(SOURCE_TRASH_WARNING)
      }
    }

    // 6. 結果
    return await finish({
      status: "done",
      reasons: [],
      warnings,
      resultFileId: video.id,
      videoUrl: `https://drive.google.com/file/d/${video.id}/view`,
      coverUrl: `https://drive.google.com/file/d/${cover.id}/view`,
      durationSec: result.durationSec,
    })
  } catch (e) {
    if (isAuthError(e)) {
      step("drive auth expired")
      return await failed([AUTH_REASON])
    }
    // 中身(パス・ID を含みうる)は出さない
    step(`unexpected error ${isDriveError(e) ? e.status : "other"}`)
    return await failed([GENERIC_REASON])
  } finally {
    if (!deps.workDir) fs.rmSync(work, { recursive: true, force: true })
  }
}

// 直接実行されたとき(テストから import されたときは動かさない)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const env = process.env
  const { exitCode, delivered } = await runCi({ jobId: env.JOB_ID ?? "", env })
  // 最終の通知が届いたことを Actions に伝える(届いていれば「失敗を通知する」手順は動かさない)
  if (delivered && env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, "notified=true\n")
  process.exit(exitCode)
}
