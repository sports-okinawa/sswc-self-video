// 写し元: athcon-video-self-edit/scripts/self/drive.mjs (485d27f)
// Google ドライブの操作(オーナー本人の OAuth 再発行用トークンで REST を直接呼ぶ。依存なし)。
// 認証情報: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN(環境変数 → .env)
// 動画は数百MBになりうるので、ダウンロード・アップロードともメモリに載せずストリームで流す。
import fs from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const FILES_URL = "https://www.googleapis.com/drive/v3/files"
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
const EXPIRY_MARGIN_MS = 60_000
const MAX_LIST_PAGES = 50

export class DriveAuthError extends Error {
  constructor(message = "Googleドライブの許可が切れています。設定手順の『許可し直す』を行ってください") {
    super(message)
    this.name = "DriveAuthError"
  }
}

export const readEnv = (name) => {
  const file = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : ""
  const fromFile = file.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
  return (process.env[name] ?? fromFile ?? "").trim().replace(/^"|"$/g, "")
}

let cache = null // { token, expiresAt }
/** テスト用: キャッシュしたアクセストークンを捨てる */
export const resetTokenCache = () => {
  cache = null
}

const refreshAccessToken = async () => {
  const clientId = readEnv("GOOGLE_OAUTH_CLIENT_ID")
  const clientSecret = readEnv("GOOGLE_OAUTH_CLIENT_SECRET")
  const refreshToken = readEnv("GOOGLE_OAUTH_REFRESH_TOKEN")
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN が設定されていません")
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (body.error === "invalid_grant") throw new DriveAuthError()
    throw new Error(`Googleのトークン取得に失敗しました(${res.status} ${body.error ?? ""})`)
  }
  cache = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - EXPIRY_MARGIN_MS }
  return cache.token
}

export async function getAccessToken() {
  if (cache && Date.now() < cache.expiresAt) return cache.token
  return refreshAccessToken()
}

/** makeRequest() -> [url, init]。401 なら一度だけトークンを取り直してやり直す(それでも 401 なら DriveAuthError) */
const authedFetch = async (makeRequest) => {
  for (let attempt = 0; ; attempt++) {
    const token = attempt === 0 ? await getAccessToken() : await refreshAccessToken()
    const [url, init] = makeRequest()
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
    if (res.status !== 401) return res
    if (attempt === 1) throw new DriveAuthError()
  }
}

/**
 * ドライブの API がエラーを返した。status は HTTP の状態、reason はドライブの理由(storageQuotaExceeded など。読めなければ空)。
 * 画面に出る文章に JSON の中身が混ざらないよう、message には本文を入れない(本文はファイル ID などを含みうるので持たない)
 */
export class DriveRequestError extends Error {
  constructor(what, status, reason = "") {
    super(`ドライブの${what}に失敗しました(HTTP ${status})`)
    this.name = "DriveRequestError"
    this.status = status
    this.reason = reason
  }
}

const fail = async (what, res) => {
  const text = await res.text().catch(() => "")
  let reason = ""
  try {
    const error = JSON.parse(text)?.error
    reason = error?.errors?.[0]?.reason ?? error?.status ?? ""
  } catch {
    // JSON でない本文(HTML など)
  }
  return new DriveRequestError(what, res.status, typeof reason === "string" ? reason : "")
}

export async function downloadFile(fileId, dest) {
  const res = await authedFetch(() => [`${FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {}])
  if (!res.ok) throw await fail("ダウンロード", res)
  // 途中で切れても壊れたファイルを残さない: .part に書いて、成功したときだけ本来の名前にする
  const part = `${dest}.part`
  try {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part))
    fs.renameSync(part, dest)
  } catch (e) {
    fs.rmSync(part, { force: true })
    throw e
  }
}

/** appProperties: 後から探すための印(文字列だけの { キー: 値 })。省略可 */
export async function uploadFile(folderId, localPath, name, mimeType, appProperties) {
  const size = fs.statSync(localPath).size
  // 1段階目: アップロード枠を作る(Location に送り先が返る)
  const start = await authedFetch(() => [
    `${UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify({ name, parents: [folderId], ...(appProperties ? { appProperties } : {}) }),
    },
  ])
  if (!start.ok) throw await fail("アップロード開始", start)
  const location = start.headers.get("location")
  if (!location) throw new Error("ドライブのアップロード先が返ってきませんでした")

  // 2段階目: 中身をストリームで PUT(再試行のたびにストリームを作り直す)
  const put = await authedFetch(() => [
    location,
    {
      method: "PUT",
      headers: { "Content-Type": mimeType, "Content-Length": String(size) },
      body: Readable.toWeb(fs.createReadStream(localPath)),
      duplex: "half",
    },
  ])
  if (!put.ok) throw await fail("アップロード", put)
  const { id, webViewLink } = await put.json()
  return { id, webViewLink }
}

/** 404(すでに無い)は成功扱い */
export async function deleteFile(fileId) {
  const res = await authedFetch(() => [`${FILES_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: "DELETE" }])
  if (res.ok || res.status === 404) return
  throw await fail("削除", res)
}

/** query に合うファイルを全ページぶん集める。呼ぶ側が trashed=false を付ける。fields 例: "id,name,appProperties" */
export async function listFiles(query, fields = "id,name") {
  const files = []
  let pageToken = ""
  for (let page = 0; ; page++) {
    if (page >= MAX_LIST_PAGES) throw new Error(`ドライブの一覧が ${MAX_LIST_PAGES} ページを超えたため、途中で止めました`)
    const params = new URLSearchParams({
      q: query,
      fields: `nextPageToken,files(${fields})`,
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    })
    if (pageToken) params.set("pageToken", pageToken)
    const res = await authedFetch(() => [`${FILES_URL}?${params}`, {}])
    if (!res.ok) throw await fail("一覧の取得", res)
    const body = await res.json()
    files.push(...(body.files ?? []))
    pageToken = body.nextPageToken ?? ""
    if (!pageToken) return files
  }
}
