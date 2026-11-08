// 編集本体(手元でも Actions でも同じ): 撮影動画 + ジョブ JSON → final.mp4・cover.png・report.json
//   正規化 → 文字起こし(whisper medium)→ 台本と照合 → 残す区間を決める → ffmpeg で切ってつなぐ
//   → 字幕などの時刻 → Remotion で本編・表紙 → 自動確認
// 写し元の考え方: athcon-video-self-edit/scripts/self-edit.mjs (485d27f)
//
// 手元: node scripts/edit.mjs --job <job.json> --video <撮影動画> [--out <出力フォルダ>] [--assets <bgm*.mp3・sfx-hit.wav・sfx-whoosh.wav のフォルダ>]
//
// ログは「step: 固定の文 数値」だけ(公開リポジトリの Actions のログに台本・タイトル・パスを出さない)。
// エラーの中身は作業フォルダの debug.log にだけ書く(CI では作業フォルダごと消える)。
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"

import { alignScript } from "../src/lib/align.ts"
import { buildTimeline } from "../src/lib/captions.ts"
import { foundRatio as calcFoundRatio, planCuts } from "../src/lib/cutPlan.ts"
import { sentencesOf } from "../src/lib/markup.ts"
import { MIN_END_CARD_FRAMES, MIN_FINAL_MS, MIN_FOUND_RATIO, runQa } from "../src/lib/qa.ts"
import { END_CARD_LINES, END_CARD_MS, FPS } from "../src/video/props.ts"
import { normalizeVideo } from "./lib/normalize.mjs"
import { transcribeWords } from "./lib/transcribe.mjs"

const run = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REMOTION_CLI = path.join(ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js")

export const GENERIC_REASON = "動画の編集中にエラーが起きました。もう一度「動画を編集」を押してください"
const SAMPLE_RATE = 48000
const SAMPLES_PER_FRAME = SAMPLE_RATE / FPS // 1600
const FADE_FRAMES = 2 // つなぎ目の音のフェード
const PROMPT_MAX_CHARS = 120 // whisper の手がかりの言葉(長すぎると手がかりの文をそのまま書くことがある)

const step = (msg) => console.log(`step: ${msg}`)

/** 区間をコマの境目にそろえる(映像はコマ単位でしか切れないので、音と映像の長さを一致させる) */
export const snapSegments = (segments, fps = FPS) => {
  const out = []
  for (const s of segments) {
    const startFrame = Math.round((s.srcStartMs * fps) / 1000)
    const endFrame = Math.round((s.srcEndMs * fps) / 1000)
    if (endFrame <= startFrame) continue
    const last = out[out.length - 1]
    if (last && startFrame <= last.endFrame) {
      last.endFrame = Math.max(last.endFrame, endFrame)
      last.srcEndMs = (last.endFrame * 1000) / fps
      continue
    }
    out.push({ startFrame, endFrame, srcStartMs: (startFrame * 1000) / fps, srcEndMs: (endFrame * 1000) / fps })
  }
  return out
}

/** 区間を切ってつなぐ filter_complex(つなぎ目に 2 コマの音のフェード) */
export const cutFilter = (frames, fps = FPS) => {
  const fade = FADE_FRAMES / fps
  const parts = []
  const labels = []
  frames.forEach((f, i) => {
    const len = (f.endFrame - f.startFrame) / fps
    const audio = [
      `atrim=start_sample=${f.startFrame * SAMPLES_PER_FRAME}:end_sample=${f.endFrame * SAMPLES_PER_FRAME}`,
      "asetpts=PTS-STARTPTS",
    ]
    if (i > 0) audio.push(`afade=t=in:st=0:d=${fade.toFixed(4)}`)
    if (i < frames.length - 1) audio.push(`afade=t=out:st=${Math.max(0, len - fade).toFixed(4)}:d=${fade.toFixed(4)}`)
    parts.push(`[0:v]trim=start_frame=${f.startFrame}:end_frame=${f.endFrame},setpts=PTS-STARTPTS[v${i}]`)
    parts.push(`[0:a]${audio.join(",")}[a${i}]`)
    labels.push(`[v${i}][a${i}]`)
  })
  parts.push(`${labels.join("")}concat=n=${frames.length}:v=1:a=1[v][a]`)
  return parts.join(";")
}

/** 撮影した動画の保存上の縦横・回転・長さ・音声の有無 */
async function probeSource(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation:format=duration",
    "-of", "json", file,
  ])
  const info = JSON.parse(stdout)
  const streams = info.streams ?? []
  const v = streams.find((s) => s.codec_type === "video")
  if (!v) throw new Error("no video stream")
  const sideRotation = (v.side_data_list ?? []).find((d) => d.rotation !== undefined)?.rotation
  const rotation = Number(sideRotation ?? v.tags?.rotate ?? 0) || 0
  return {
    srcWidth: Number(v.width),
    srcHeight: Number(v.height),
    srcRotation: rotation,
    srcDurationMs: Math.round(Number(info.format?.duration ?? 0) * 1000),
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  }
}

async function probeOutput(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", file])
  const info = JSON.parse(stdout)
  return {
    durationMs: Math.round(Number(info.format?.duration ?? 0) * 1000),
    hasAudio: (info.streams ?? []).some((s) => s.codec_type === "audio"),
  }
}

/** Remotion の CLI。出力は表に出さず、作業フォルダの debug.log にだけ残す */
function remotion(args, debugLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [REMOTION_CLI, ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
    let tail = ""
    const collect = (d) => {
      tail = (tail + d.toString("utf8")).slice(-20000)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code !== 0) fs.appendFileSync(debugLog, `remotion ${args[0]} exit ${code}\n${tail}\n`)
      resolve(code ?? 1)
    })
  })
}

/** 失敗したら 1 回だけやり直す(コマの取り出しや描画が時々失敗するため) */
async function remotionWithRetry(args, debugLog, what) {
  if ((await remotion(args, debugLog)) === 0) return
  step(`${what} retry`)
  if ((await remotion(args, debugLog)) !== 0) throw new Error(`${what} failed`)
}

/** Windows の ffmpeg が音量の測定中に時々落ちる(0xC0000374)ので、正規化は 1 回だけやり直す */
async function normalizeWithRetry(input, output, normalize) {
  try {
    return await normalize(input, output)
  } catch {
    step("normalize retry")
    return normalize(input, output)
  }
}

const defaultDeps = { normalizeVideo, transcribeWords, probeSource, probeOutput }

/**
 * @param {{ job: object; videoPath: string; workDir: string; assets?: { bgm?: string|null; hit?: string|null; whoosh?: string|null }; deps?: object }} p
 * @returns {Promise<{ status: "done"|"failed"; reasons: string[]; warnings: string[]; finalPath?: string; coverPath?: string; durationSec?: number; foundRatio?: number }>}
 */
export async function edit({ job, videoPath, workDir, assets = {}, deps = {} }) {
  const d = { ...defaultDeps, ...deps }
  process.env.WHISPER_MODEL ??= "medium"
  process.env.WHISPER_MODEL_DIR ??= "whisper-models"
  fs.mkdirSync(workDir, { recursive: true })
  const debugLog = path.join(workDir, "debug.log")
  const warnings = []
  const failed = (reasons, extra = {}) => ({ status: "failed", reasons, warnings, ...extra })
  let stage = "probe"
  try {
    // 撮影した動画の確認(横向き・音声なし・長さ)。ここで分かるものは時間のかかる処理の前に止める
    const src = await d.probeSource(videoPath)
    step(`probe done ${Math.round(src.srcDurationMs / 1000)}s`)
    const early = runQa({ ...src, finalDurationMs: MIN_FINAL_MS, foundRatio: 1, endCardFrames: MIN_END_CARD_FRAMES })
    if (early.length > 0) {
      step(`source check failed ${early.length}`)
      return failed(early)
    }

    stage = "normalize"
    const normalized = path.join(workDir, "normalized.mp4")
    const norm = await normalizeWithRetry(videoPath, normalized, d.normalizeVideo)
    for (const w of norm.warnings ?? []) warnings.push(typeof w === "string" ? w : w.reason)
    step(`normalize done ${Math.round(norm.durationMs / 1000)}s`)

    stage = "transcribe"
    const sentences = sentencesOf(job.scenes ?? [])
    if (sentences.length === 0) return failed(["台本が空です。台本を確認してください"])
    const prompt = [job.title ?? "", ...sentences.map((s) => s.text)].join(" ").slice(0, PROMPT_MAX_CHARS)
    const words = await d.transcribeWords(normalized, { prompt })
    step(`transcribe done words ${words.length}`)

    stage = "align"
    const alignment = alignScript(
      sentences.map((s) => s.text),
      words,
    )
    const ratio = calcFoundRatio(alignment, sentences.length)
    step(`align found ${alignment.sentences.length}/${sentences.length}`)
    if (alignment.missing.length > 0 && ratio >= MIN_FOUND_RATIO) {
      warnings.push(`台本の文のうち${alignment.missing.length}文が読み取れなかったため、動画に入っていません`)
    }

    const frames = snapSegments(planCuts(alignment, norm.durationMs))
    const segments = frames.map((f) => ({ srcStartMs: f.srcStartMs, srcEndMs: f.srcEndMs }))
    const timeline = buildTimeline(sentences, alignment, segments, job.scenes)
    step(`cut plan segments ${segments.length} ${Math.round(timeline.durationMs / 1000)}s`)

    // 書き出す前に、長さと読み取れた割合を確かめる(通らないなら書き出さない)
    const before = runQa({ ...src, finalDurationMs: timeline.durationMs + END_CARD_MS, foundRatio: ratio, endCardFrames: MIN_END_CARD_FRAMES })
    if (before.length > 0 || segments.length === 0) {
      step(`qa before render failed ${before.length}`)
      return failed(before.length ? before : [GENERIC_REASON], { foundRatio: ratio })
    }

    stage = "cut"
    const publicDir = path.join(workDir, "public")
    fs.mkdirSync(publicDir, { recursive: true })
    await run(
      "ffmpeg",
      [
        "-y", "-loglevel", "error", "-i", normalized,
        "-filter_complex", cutFilter(frames),
        "-map", "[v]", "-map", "[a]",
        "-fps_mode", "cfr", "-r", String(FPS),
        "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", String(SAMPLE_RATE), "-ac", "2",
        "-movflags", "+faststart",
        path.join(publicDir, "cut.mp4"),
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    step("cut done")

    // BGM・効果音は public/ に置いて、相対パスで渡す
    const placeAsset = (file, name) => {
      if (!file || !fs.existsSync(file)) return null
      fs.copyFileSync(file, path.join(publicDir, name))
      return name
    }
    const props = {
      video: "cut.mp4",
      timeline,
      title: job.title ?? "",
      citation: job.citation ?? "",
      endCard: Array.isArray(job.endCard) && job.endCard.length ? [...job.endCard] : END_CARD_LINES,
      bgm: placeAsset(assets.bgm, `bgm${path.extname(assets.bgm ?? "") || ".mp3"}`),
      sfx: {
        hit: placeAsset(assets.hit, `sfx-hit${path.extname(assets.hit ?? "") || ".wav"}`),
        whoosh: placeAsset(assets.whoosh, `sfx-whoosh${path.extname(assets.whoosh ?? "") || ".wav"}`),
      },
    }
    const propsFile = path.join(workDir, "props.json")
    fs.writeFileSync(propsFile, JSON.stringify(props))

    stage = "render"
    const concurrency = Math.max(1, Number.parseInt(process.env.RENDER_CONCURRENCY ?? "", 10) || 2)
    const finalPath = path.join(workDir, "final.mp4")
    const coverPath = path.join(workDir, "cover.png")
    const common = [`--props=${propsFile}`, `--public-dir=${publicDir}`, "--log=error"]
    await (d.remotionWithRetry ?? remotionWithRetry)(
      ["render", "src/index.ts", "SswcSelfVideo", finalPath, ...common, `--concurrency=${concurrency}`, "--codec=h264", "--audio-codec=aac"],
      debugLog,
      "render",
    )
    step("render done")
    await (d.remotionWithRetry ?? remotionWithRetry)(["still", "src/index.ts", "SswcCover", coverPath, ...common], debugLog, "cover")
    step("cover done")

    stage = "qa"
    const out = await d.probeOutput(finalPath)
    const endCardFrames = Math.round(((out.durationMs - timeline.durationMs) * FPS) / 1000)
    const reasons = runQa({ ...src, hasAudio: src.hasAudio && out.hasAudio, finalDurationMs: out.durationMs, foundRatio: ratio, endCardFrames })
    const durationSec = Math.round(out.durationMs / 100) / 10
    step(`qa reasons ${reasons.length} ${durationSec}s`)
    if (reasons.length > 0) return failed(reasons, { foundRatio: ratio, durationSec })
    return { status: "done", reasons: [], warnings, finalPath, coverPath, durationSec, foundRatio: ratio }
  } catch (e) {
    // 中身(パス・台本の文字を含みうる)はログに出さず、作業フォルダにだけ残す
    fs.appendFileSync(debugLog, `stage ${stage}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
    step(`edit error at ${stage}`)
    return failed([GENERIC_REASON])
  }
}

const parseArgs = (argv) => {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(job|video|out|assets)$/.exec(argv[i])
    if (m && argv[i + 1] !== undefined) args[m[1]] = argv[++i]
  }
  return args
}

/** 素材フォルダから bgm*.mp3(名前順の最初)・sfx-hit.wav・sfx-whoosh.wav を探す */
const localAssets = (dir) => {
  if (!dir || !fs.existsSync(dir)) return { bgm: null, hit: null, whoosh: null }
  const names = fs.readdirSync(dir).sort()
  const find = (re) => {
    const n = names.find((x) => re.test(x))
    return n ? path.join(dir, n) : null
  }
  return { bgm: find(/^bgm.*\.mp3$/i), hit: find(/^sfx-hit\.wav$/i), whoosh: find(/^sfx-whoosh\.wav$/i) }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.job || !args.video) {
    console.error("使い方: node scripts/edit.mjs --job <job.json> --video <撮影動画> [--out <出力フォルダ>] [--assets <素材フォルダ>]")
    process.exit(1)
  }
  const outDir = path.resolve(args.out ?? "out")
  const job = JSON.parse(fs.readFileSync(path.resolve(args.job), "utf8"))
  const videoPath = path.resolve(args.video)
  const assets = localAssets(args.assets ? path.resolve(args.assets) : undefined)
  process.chdir(ROOT)
  fs.mkdirSync(outDir, { recursive: true })
  // 前回の結果が残っていると、失敗したのに完成品があるように見えるので先に消す
  for (const f of ["final.mp4", "cover.png", "report.json"]) fs.rmSync(path.join(outDir, f), { force: true })
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sswc-edit-"))
  const result = await edit({ job, videoPath, workDir, assets })
  if (result.status === "done") {
    fs.copyFileSync(result.finalPath, path.join(outDir, "final.mp4"))
    fs.copyFileSync(result.coverPath, path.join(outDir, "cover.png"))
  }
  // report には台本の文字を入れない
  const report = {
    status: result.status,
    reasons: result.reasons,
    warnings: result.warnings,
    durationSec: result.durationSec ?? null,
    foundRatio: result.foundRatio ?? null,
  }
  fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`)
  if (fs.existsSync(path.join(workDir, "debug.log"))) fs.copyFileSync(path.join(workDir, "debug.log"), path.join(outDir, "debug.log"))
  if (!process.env.KEEP_WORK) fs.rmSync(workDir, { recursive: true, force: true })
  step(`finished ${result.status}`)
  process.exit(result.status === "done" ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
