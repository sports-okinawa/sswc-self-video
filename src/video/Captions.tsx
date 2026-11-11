// 字幕(2026-11-11 アスコンの自撮り動画とそろえて一新): 下から 420px、Dela Gothic One 72px、白文字+紺の太い縁取り。
// 1 行ずつ少し遅れて下からはずんで出る。強調 keyword は黄色・number はオレンジで、行より少し遅れてポンと大きくなる
import { useCurrentFrame } from "remotion"
import type { Cue } from "../lib/captions.ts"
import { MAX_CUE_LINES, MAX_LINE_UNITS } from "../lib/captions.ts"
import { captionLines } from "../lib/captionLines.ts"
import { msToFrame, WIDTH } from "./props.ts"
import { CAPTION_NAVY, clamp01, easeOutCubic, ORANGE, Outlined, YELLOW } from "./theme"

export const CAPTION_BOTTOM = 420
export const CAPTION_SIZE = 72 // 13 文字 × 72px = 936px(縁を足しても画面の幅に収まる)
export const CAPTION_OUTLINE = 13
const LINE_HEIGHT = 1.3
const LINE_DELAY = 3 // 2 行目以降の遅れ(コマ)
const LINE_FRAMES = 7
const NUMBER_SCALE = 1.2 // 数字の強調は少し大きく(captionLines は 1.3 倍で幅を見ている)

/** frame で出している字幕(切った後の時刻) */
export const activeCue = (cues: Cue[], frame: number): Cue | null =>
  cues.find((c) => frame >= msToFrame(c.startMs) && frame < msToFrame(c.endMs)) ?? null

/** 強調の言葉の大きさ: 5 コマ目から 1.6 倍ではずんで 1 倍に戻る */
const emphasisScale = (local: number) => {
  const p = clamp01((local - 5) / 8)
  return p >= 1 ? 1 : Math.max(0.6, 1 + 0.6 * (1 - p) * Math.cos(p * Math.PI * 1.5))
}

const Line = ({
  text,
  offset,
  emphasis,
  stroke,
  local,
}: {
  text: string
  offset: number
  emphasis: Cue["emphasis"]
  stroke: boolean
  local: number
}) => {
  // 強調の境目で区切る(位置は字幕の text の UTF-16)
  const cuts = new Set<number>([0, text.length])
  for (const e of emphasis) {
    for (const p of [e.start - offset, e.end - offset]) if (p > 0 && p < text.length) cuts.add(p)
  }
  const points = [...cuts].sort((a, b) => a - b)
  return (
    <div style={{ whiteSpace: "nowrap", lineHeight: LINE_HEIGHT }}>
      {points.slice(0, -1).map((from, i) => {
        const to = points[i + 1]
        const e = emphasis.find((x) => from + offset >= x.start && from + offset < x.end)
        const color = stroke ? undefined : e?.kind === "number" ? ORANGE : e?.kind === "keyword" ? YELLOW : undefined
        return (
          <span
            key={from}
            style={{
              color,
              fontSize: e?.kind === "number" ? `${NUMBER_SCALE}em` : undefined,
              display: e ? "inline-block" : undefined,
              transform: e ? `scale(${emphasisScale(local)}) rotate(-2deg)` : undefined,
              transformOrigin: "50% 70%",
            }}
          >
            {text.slice(from, to)}
          </span>
        )
      })}
    </div>
  )
}

export const Captions = ({ cues, fontFamily }: { cues: Cue[]; fontFamily: string }) => {
  const frame = useCurrentFrame()
  const cue = activeCue(cues, frame)
  if (!cue) return null
  const lines = captionLines(cue.text, cue.emphasis, MAX_LINE_UNITS).slice(0, MAX_CUE_LINES)
  const local = frame - msToFrame(cue.startMs)
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        width: WIDTH,
        bottom: CAPTION_BOTTOM,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {lines.map(([s, e], i) => {
        const t = clamp01((local - i * LINE_DELAY) / LINE_FRAMES)
        const pop = easeOutCubic(t)
        const over = Math.sin(t * Math.PI) * 0.06
        return (
          <div
            key={s}
            style={{
              opacity: Math.min(1, t * 2.5),
              transform: `translateY(${(1 - pop) * 18}px) scale(${0.85 + 0.15 * pop + over})`,
              transformOrigin: "50% 100%",
            }}
          >
            <Outlined
              outline={CAPTION_OUTLINE}
              color={CAPTION_NAVY}
              style={{ fontFamily, fontWeight: 400, fontSize: CAPTION_SIZE, textAlign: "center", letterSpacing: "0.02em" }}
              render={(stroke) => (
                <Line text={cue.text.slice(s, e)} offset={s} emphasis={cue.emphasis} stroke={stroke} local={local} />
              )}
            />
          </div>
        )
      })}
    </div>
  )
}
