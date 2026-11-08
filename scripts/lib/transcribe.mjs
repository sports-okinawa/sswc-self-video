// 写し元: athcon-video-self-edit/scripts/self/transcribe.mjs (485d27f)
// 動画の音声を whisper.cpp(このPC上・外部サービスに送らない)で文字起こしし、文字ごとの時刻を返す
//
// 日本語はトークン単位だと漢字が途中のバイトで切れる(1文字が複数トークンにまたがる)うえ、whisper.cpp が出す
// JSON には不正な UTF-8 が混ざる。そのため Remotion の transcribe() は使わず(読み込み時に文字化けする)、
// whisper を直接動かして JSON をバイト列のまま読み、トークンのバイトを連結し直して文字として完結する単位にまとめる
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { downloadWhisperModel, installWhisperCpp } from "@remotion/install-whisper-cpp"

const run = promisify(execFile)

/** @typedef {{ text: string; startMs: number; endMs: number }} Word */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const WHISPER_DIR = path.join(ROOT, "whisper.cpp")
const WHISPER_VERSION = "1.5.5"

/**
 * モデル(ggml-*.bin)の置き場所。既定は whisper.cpp のフォルダ(手元の PC はこれまでどおり)。
 * CI はモデルだけをキャッシュするため、環境変数 WHISPER_MODEL_DIR(リポジトリからの相対パス可)で別のフォルダにする。
 * whisper.cpp のフォルダがあると installWhisperCpp はビルドを飛ばすので、モデルを先にそこへ置いてはいけない
 */
export const whisperModelDir = (env = process.env) =>
  env.WHISPER_MODEL_DIR ? path.resolve(ROOT, env.WHISPER_MODEL_DIR) : WHISPER_DIR

// [_BEG_] や [_TT_150] のような、文字ではない特別なトークン
const SPECIAL_TOKEN = /^\[_[A-Z_0-9]+\]$/

const decoder = new TextDecoder("utf-8", { fatal: true })

/** バイト列が UTF-8 として文字で終わっていれば文字列を、途中で切れていれば null を返す */
function decodeComplete(bytes) {
  try {
    return decoder.decode(bytes)
  } catch {
    return null
  }
}

/**
 * whisper.cpp の JSON(-ojf)の中身(バイト列)から、文字化けしない単位の単語時刻を作る
 * @param {Buffer} raw
 * @returns {Word[]}
 */
export function wordsFromWhisperJson(raw) {
  // 不正な UTF-8 が混ざるので、1 バイト = 1 文字(latin1)として読み、トークンの文字列から元のバイトを取り戻す
  const json = JSON.parse(raw.toString("latin1"))
  /** @type {Word[]} */
  const words = []
  let bytes = []
  let startMs = 0
  let endMs = 0
  const flush = () => {
    const text = decodeComplete(Uint8Array.from(bytes))
    if (text === null) return false
    if (text.trim() !== "") words.push({ text, startMs, endMs })
    bytes = []
    return true
  }

  for (const segment of json.transcription ?? []) {
    for (const token of segment.tokens ?? []) {
      if (SPECIAL_TOKEN.test(token.text)) continue
      const tokenBytes = Buffer.from(token.text, "latin1")
      // 途中で切れた文字の続きは 10xxxxxx の続きバイトで始まる。そうでなければ前のバイトは壊れているので捨てる
      // (捨てないと、以降のトークンがすべて完結しないバッファに積まれて文字起こしの残りが消える)
      if (bytes.length > 0 && tokenBytes.length > 0 && (tokenBytes[0] & 0xc0) !== 0x80) bytes = []
      if (bytes.length === 0) startMs = token.offsets.from
      bytes.push(...tokenBytes)
      endMs = token.offsets.to
      // 続きバイトだけが並んで 4 バイトを超えても完結しないなら、これも壊れているので捨てる
      if (!flush() && bytes.length >= 4) bytes = []
    }
  }
  // 最後に文字が欠けたまま残ったバイト(壊れた出力)は、文字化けの原因になるので捨てる
  return words
}

function runWhisper({ wavPath, model, modelDir, outBase, prompt, timeoutMs }) {
  const executable = path.join(WHISPER_DIR, os.platform() === "win32" ? "main.exe" : "main")
  const args = [
    "-f", wavPath,
    "-m", path.join(modelDir, `ggml-${model}.bin`),
    "-l", "ja",
    "-ojf", "-of", outBase,
    "--max-len", "1", // トークンごとに時刻を出す
    "--dtw", model, // 単語の時刻を DTW で合わせる(モデル名はそのまま渡せる)
    // 台本の言葉を手がかりに渡すと、「睡眠」を「水民」と書くような誤変換が減る(2026-10-23)
    ...(prompt ? ["--prompt", prompt] : []),
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: WHISPER_DIR, stdio: ["ignore", "ignore", "pipe"] })
    let timedOut = false
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill("SIGKILL")
        }, timeoutMs)
      : null
    child.stderr.on("data", () => {}) // 台本の言葉が混ざりうるので、中身は読まずに捨てる
    child.on("error", reject)
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer)
      if (timedOut) return reject(new Error(`文字起こしが ${Math.round(timeoutMs / 60000)} 分で終わりませんでした(${model})`))
      if (fs.existsSync(`${outBase}.json`)) resolve(`${outBase}.json`)
      else reject(new Error(`文字起こしに失敗しました(終了コード ${code})`))
    })
  })
}

/** モデルの正しい大きさ(byte。Hugging Face の ggml-*.bin と同じ) */
export const MODEL_BYTES = { small: 487601967, medium: 1533763059 }

const sizeOf = (file) => (fs.existsSync(file) ? fs.statSync(file).size : -1)

/**
 * モデルを、正しい大きさになるまで確かめてから使う(2026-10-23 medium で「文字起こしに失敗しました」)。
 * downloadWhisperModel は通信が終わった時点で戻り、ファイルへの書き込みが終わる前に whisper が読み始めて
 * 「not all tensors loaded」で落ちた。また printOutput:false だと、大きさの違う(途中で切れた)ファイルもそのまま通す。
 * そこで、書き込みが追いつくのを待ち、それでも違えば消して取り直す(3 回まで)
 * @returns {Promise<string>} モデルのファイル
 */
export async function ensureWhisperModel(model, modelDir, deps = {}) {
  const download = deps.download ?? downloadWhisperModel
  const wait = deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const file = path.join(modelDir, `ggml-${model}.bin`)
  const expected = MODEL_BYTES[model]
  if (!expected) throw new Error(`whisper のモデル ${model} の正しい大きさが分かりません(MODEL_BYTES に足してください)`)
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (sizeOf(file) === expected) return file
    fs.rmSync(file, { force: true })
    await download({ model, folder: modelDir, printOutput: false })
    // 書き込みが追いつくまで最大 60 秒待つ
    for (let i = 0; i < 120 && sizeOf(file) !== expected; i++) await wait(500)
    if (sizeOf(file) === expected) return file
    console.log(`step: whisper model incomplete ${sizeOf(file)}/${expected} retry ${attempt}/3`)
  }
  fs.rmSync(file, { force: true })
  throw new Error(`whisper のモデル(${model})を正しく取得できませんでした`)
}

/**
 * 正規化した動画の音声を文字起こしし、文字として完結した単位ごとの開始・終了時刻(ms)を返す
 * モデルは opts.model か環境変数 WHISPER_MODEL(既定 small)、置き場所は opts.modelDir か WHISPER_MODEL_DIR。opts.prompt は文字起こしの手がかりにする言葉(台本・タイトルの言葉)。
 * 指定のモデルで失敗したら small で、それでも失敗したら手がかりの言葉なしでやり直す(動画づくりを止めないため)
 * @param {string} normalizedVideo
 * @returns {Promise<Word[]>}
 */
export async function transcribeWords(normalizedVideo, opts = {}) {
  // opts.model / opts.modelDir があればそれを使う(sswc-self-video で追加。無ければ写し元どおり環境変数)
  const model = opts.model ?? process.env.WHISPER_MODEL ?? "small"
  await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput: false })
  const modelDir = opts.modelDir ? path.resolve(ROOT, opts.modelDir) : whisperModelDir()
  fs.mkdirSync(modelDir, { recursive: true })

  const attempts = [{ model, prompt: opts.prompt }]
  if (model !== "small") attempts.push({ model: "small", prompt: opts.prompt })
  if (opts.prompt) attempts.push({ model: "small", prompt: undefined })

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-"))
  try {
    const wavPath = path.join(dir, "audio.16k.wav")
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", normalizedVideo, "-vn", "-ar", "16000", "-ac", "1", wavPath])
    let lastError
    for (const [i, a] of attempts.entries()) {
      try {
        await ensureWhisperModel(a.model, modelDir)
        const jsonPath = await runWhisper({ wavPath, model: a.model, modelDir, outBase: path.join(dir, `out${i}`), prompt: a.prompt,
          // small 以外は時間がかかるので、20 分で打ち切って small でやり直す(全体の制限は 90 分)
          timeoutMs: a.model === "small" ? undefined : 20 * 60 * 1000,
        })
        if (i > 0) console.log(`step: transcribe fallback ok attempt ${i + 1}`)
        return wordsFromWhisperJson(fs.readFileSync(jsonPath))
      } catch (e) {
        lastError = e
        console.log(`step: transcribe attempt ${i + 1} failed`)
      }
    }
    throw lastError
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
