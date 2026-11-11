// 写し元: athcon-video-self-edit/scripts/self/normalize.mjs (485d27f)
// 本人が撮影した動画を、1080×1920・30fps固定・yuv420p・H.264・48kHzステレオにそろえる
// スマホの動画は回転情報つき・HEVC・可変フレームレート・60fps などまちまちなので、最初にここでそろえる。
// 回転情報(ffmpeg が読み込み時に自動で反映する)を反映してから縦にそろえ、縦横比が違えば白い余白を足す。
// 音声のない動画には、映像と同じ長さの無音を足す。
// iPhone の HDR 動画(HLG / PQ・BT.2020)は、そのままだと白っぽく色あせるので SDR(BT.709)へトーンマッピングする
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { audio, fit, selfEnhance, voiceClean, voiceGain } from "./ffmpegFilters.mjs"

const run = promisify(execFile)

async function probe(file, args) {
  const { stdout } = await run("ffprobe", ["-v", "error", ...args, "-of", "csv=p=0", file])
  return stdout.trim()
}

export const HDR_WARNING =
  "HDRの動画を色の補正なしで変換しました。iPhoneの設定で『HDRビデオ』をオフにすると色が自然になります"

const HDR_TRANSFERS = ["smpte2084", "arib-std-b67"]

/** HDR(PQ / HLG)か、BT.2020 の色域で撮られた動画か */
export const isHdr = ({ transfer, primaries }) => HDR_TRANSFERS.includes(transfer) || primaries === "bt2020"

/** この ffmpeg に zscale(トーンマッピングに使う)が入っているか */
export async function ffmpegHasZscale() {
  try {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-filters"], { maxBuffer: 8 * 1024 * 1024 })
    return /^\s*\S+\s+zscale\s/m.test(stdout)
  } catch {
    return false
  }
}

/**
 * 映像のフィルター。HDR なら、縦にそろえる前に SDR(BT.709)へ変換する。
 * zscale があれば linear → tonemap(hable)→ BT.709、なければ colorspace で色域だけ変換して warning を返す
 * fitFilter は縦にそろえる部分(既定は白い余白つきの 1080×1920。エクササイズ動画の実演素材は縦横比を保つものを渡す)
 * @returns {{ filter: string; warning: string | null }}
 */
export function videoFilter({ hdr, transfer, zscale }, fitFilter = fit) {
  if (!hdr) return { filter: fitFilter, warning: null }
  if (zscale) {
    const tin = HDR_TRANSFERS.includes(transfer) ? `:tin=${transfer}` : ""
    const tonemap =
      `zscale=t=linear:npl=100${tin}:pin=bt2020:min=bt2020nc,format=gbrpf32le,zscale=p=bt709,` +
      "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
    return { filter: `${tonemap},${fitFilter}`, warning: null }
  }
  return { filter: `colorspace=all=bt709:iall=bt2020:fast=1:format=yuv420p,${fitFilter}`, warning: HDR_WARNING }
}

/**
 * @param {string} input 撮影した動画
 * @param {string} output 書き出し先(.mp4)
 * @param {{ hasZscale?: () => Promise<boolean> }} [deps] テスト用の差し替え
 * @returns {Promise<{ durationMs: number; warnings: { sceneIndex: number; reason: string }[] }>}
 */
export async function normalizeVideo(input, output, deps = {}) {
  const hasAudio = (await probe(input, ["-select_streams", "a", "-show_entries", "stream=index"])) !== ""
  // 色の情報(key=value の行)。付いていない動画は unknown か空
  const { stdout: colorLines } = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer,color_primaries",
    "-of", "default=nw=1", input,
  ])
  const colorValue = (key) => colorLines.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() ?? ""
  const color = { transfer: colorValue("color_transfer"), primaries: colorValue("color_primaries") }
  const hdr = isHdr(color)
  const { filter, warning } = videoFilter({
    hdr,
    transfer: color.transfer,
    zscale: hdr ? await (deps.hasZscale ?? ffmpegHasZscale)() : false,
  }, `${selfEnhance},${fit}`)

  const args = ["-y", "-loglevel", "error", "-i", input]
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000")
  // 音声は async=1 で、可変フレームレート動画の途中の欠け・ずれを詰めて映像に合わせる
  // 声は聞き取りやすく整え(voiceClean)、全体の音量を測ってから一定の量でそろえ、48kHz ステレオにする
  let gain = ""
  if (hasAudio) {
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", input, "-vn", "-af", `${voiceClean},ebur128`, "-f", "null", "-"], {
      maxBuffer: 64 * 1024 * 1024,
    })
    // 最後の「Integrated loudness」の I: を読む(途中経過の行にも I: があるので、Threshold が続くものを優先)
    const lufs = Number(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(stderr)?.[1] ?? /I:\s+(-?[\d.]+) LUFS/.exec(stderr)?.[1])
    gain = voiceGain(lufs)
  }
  const audioFilter = hasAudio ? `aresample=async=1:first_pts=0,${voiceClean},${gain},${audio}` : `${audio}`
  args.push(
    "-filter_complex",
    `[0:v]${filter}[v];[${hasAudio ? "0" : "1"}:a]${audioFilter}[a]`,
    "-map", "[v]", "-map", "[a]",
    "-fps_mode", "cfr", "-r", "30",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium",
    // HDR から変換したときは、色の情報も SDR(BT.709)として書く
    ...(hdr ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"] : []),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    // 無音を足したときは映像の長さで止める
    "-shortest",
    output,
  )
  await run("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 })

  const durationMs = Math.round(Number(await probe(output, ["-show_entries", "format=duration"])) * 1000)
  return { durationMs, warnings: warning ? [{ sceneIndex: -1, reason: warning }] : [] }
}
