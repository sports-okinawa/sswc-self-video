// 数字の大写し: 画面中央 220px、紺の帯の上にオレンジ。0 から数え上がり(18 コマ)、着地で hit。表示 1.6 秒
import { Audio, Sequence, useCurrentFrame } from "remotion"
import type { BigNumber as BigNumberMark } from "../lib/captions.ts"
import { activeBigNumber, BIG_NUMBER_FRAMES, COUNT_FRAMES, countUpText } from "./motion.ts"
import { HEIGHT, mediaSrc, msToFrame, WIDTH } from "./props.ts"
import { clamp01, easeOutCubic, NAVY, ORANGE, Outlined, SKY } from "./theme"

export const BIG_NUMBER_SIZE = 220
const BAND_HEIGHT = 320
const MAX_TEXT_WIDTH = WIDTH - 140
const OUT_FRAMES = 6

// 字の幅の見積もり(英数字は 0.62、ほかは 1)
const units = (text: string) => [...text].reduce((n, ch) => n + (/[\x20-\x7e]/.test(ch) ? 0.62 : 1), 0)

export const BigNumber = ({ list, fontFamily }: { list: BigNumberMark[]; fontFamily: string }) => {
  const frame = useCurrentFrame()
  const active = activeBigNumber(list, frame)
  if (!active) return null
  const f = frame - active.startFrame
  const shown = countUpText(active.text, f >= COUNT_FRAMES ? 1 : easeOutCubic(f / COUNT_FRAMES))
  const size = Math.min(BIG_NUMBER_SIZE, Math.floor(MAX_TEXT_WIDTH / (units(active.text) + 0.2)))
  // 帯は 5 コマで横に伸び、数字は着地の瞬間に少し大きく弾む
  const band = easeOutCubic(f / 5)
  const land = f - COUNT_FRAMES
  const punch = land >= 0 && land < 8 ? 1 + 0.14 * (1 - land / 8) : 1
  const out = clamp01((BIG_NUMBER_FRAMES - f) / OUT_FRAMES)
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: (HEIGHT - BAND_HEIGHT) / 2,
        width: WIDTH,
        height: BAND_HEIGHT,
        opacity: out,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: NAVY,
          transform: `skewY(-4deg) scaleX(${band})`,
          boxShadow: `0 -10px 0 ${SKY}, 0 10px 0 ${SKY}, 0 20px 40px rgba(0,0,0,0.35)`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Outlined
          outline={12}
          style={{
            fontFamily,
            fontSize: size,
            lineHeight: 1,
            whiteSpace: "nowrap",
            transform: `rotate(-4deg) scale(${punch})`,
            fontVariantNumeric: "tabular-nums",
          }}
          render={(stroke) => <span style={{ color: stroke ? undefined : ORANGE }}>{shown}</span>}
        />
      </div>
    </div>
  )
}

/** 数え上がりの着地で鳴らす hit */
export const BigNumberHits = ({ list, hit }: { list: BigNumberMark[]; hit: string | null }) =>
  hit === null ? null : (
    <>
      {list.map((n, i) => (
        <Sequence key={i} from={msToFrame(n.atMs) + COUNT_FRAMES - 2} durationInFrames={45} layout="none">
          <Audio src={mediaSrc(hit)} volume={0.55} />
        </Sequence>
      ))}
    </>
  )
