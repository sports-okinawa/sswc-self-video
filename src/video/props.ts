// 本編(SswcSelfVideo)と表紙(SswcCover)の props と時間の計算。
import { staticFile } from "remotion"
import type { buildTimeline } from "../lib/captions.ts"

export type SswcTimeline = ReturnType<typeof buildTimeline>

export type SswcVideoProps = {
  /** 切った後の動画(public/ からの相対パス、または http(s) の URL)。切った後の時刻 = 動画の時刻 */
  video: string
  timeline: SswcTimeline
  title: string
  /** 出典(「根拠」の場面の間だけ上部に出す) */
  citation: string
  endCard: string[]
  /** BGM・効果音(public/ からの相対パス・URL)。無ければ鳴らさない */
  bgm: string | null
  sfx: { hit: string | null; whoosh: string | null }
}

export const FPS = 30
export const WIDTH = 1080
export const HEIGHT = 1920
export const END_CARD_MS = 5000
export const END_CARD_FRAMES = (END_CARD_MS / 1000) * FPS

// 締めの文言(固定)。webapp の libs/sswcPaper/constants.ts と同じ
export const END_CARD_LINES = ["パワーラボ浦添 / 糸満パーク", "初めての方は30日間無料", "プロフィールのリンクから"]

export const msToFrame = (ms: number): number => Math.floor((ms / 1000) * FPS + 1e-6)

/** 本編のコマ数(切った後の動画 + 締め 5 秒) */
export const durationInFrames = (props: SswcVideoProps): number =>
  Math.ceil(((props.timeline.durationMs + END_CARD_MS) / 1000) * FPS - 1e-6)

/** 動画の切った部分のコマ数(この後ろが締め) */
export const mainFrames = (props: SswcVideoProps): number => durationInFrames(props) - END_CARD_FRAMES

/** props の場所を Remotion で読める src にする(URL はそのまま、それ以外は public/ の中) */
export const mediaSrc = (path: string): string => (/^(https?:|data:|blob:)/.test(path) ? path : staticFile(path))
