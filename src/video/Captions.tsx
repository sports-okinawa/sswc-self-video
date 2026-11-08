// 字幕: 下から 420px、64px、白+黒 10px 縁取り。強調 keyword は水色・number はオレンジ。出だしにスケール 0.85→1.0(6 コマ)
import { useCurrentFrame } from "remotion"
import type { Cue } from "../lib/captions.ts"
import { MAX_CUE_LINES, MAX_LINE_UNITS } from "../lib/captions.ts"
import { captionLines } from "../lib/captionLines.ts"
import { msToFrame, WIDTH } from "./props.ts"
import { easeOutCubic, ORANGE, Outlined, SKY } from "./theme"

export const CAPTION_BOTTOM = 420
export const CAPTION_SIZE = 64
export const CAPTION_OUTLINE = 10
const LINE_HEIGHT = 1.3
const ENTER_FRAMES = 6
const NUMBER_SCALE = 1.2 // 数字の強調は少し大きく(captionLines は 1.3 倍で幅を見ている)

/** frame で出している字幕(切った後の時刻) */
export const activeCue = (cues: Cue[], frame: number): Cue | null =>
  cues.find((c) => frame >= msToFrame(c.startMs) && frame < msToFrame(c.endMs)) ?? null

const Line = ({
  text,
  offset,
  emphasis,
  stroke,
}: {
  text: string
  offset: number
  emphasis: Cue["emphasis"]
  stroke: boolean
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
        const color = stroke ? undefined : e?.kind === "number" ? ORANGE : e?.kind === "keyword" ? SKY : undefined
        return (
          <span key={from} style={{ color, fontSize: e?.kind === "number" ? `${NUMBER_SCALE}em` : undefined }}>
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
  const t = easeOutCubic((frame - msToFrame(cue.startMs)) / ENTER_FRAMES)
  const scale = 0.85 + 0.15 * t
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        width: WIDTH,
        bottom: CAPTION_BOTTOM,
        display: "flex",
        justifyContent: "center",
        transform: `scale(${scale})`,
        transformOrigin: "50% 100%",
        opacity: Math.min(1, 0.4 + t),
      }}
    >
      <Outlined
        outline={CAPTION_OUTLINE}
        style={{ fontFamily, fontWeight: 900, fontSize: CAPTION_SIZE, textAlign: "center", letterSpacing: "0.02em" }}
        render={(stroke) =>
          lines.map(([s, e]) => <Line key={s} text={cue.text.slice(s, e)} offset={s} emphasis={cue.emphasis} stroke={stroke} />)
        }
      />
    </div>
  )
}
