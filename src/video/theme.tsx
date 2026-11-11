// 色・縁取り(白文字+黒の太い縁取り)・タイミングの共通部品
import type React from "react"

export const NAVY = "#0a78b3"
export const SKY = "#5ccdf5"
export const ORANGE = "#ff8a1f"
export const INK = "#000000"
// 字幕の縁(2026-11-11 アスコンの自撮り動画とそろえて紺)と強調の黄色
export const CAPTION_NAVY = "#0b2540"
export const YELLOW = "#ffe600"

/**
 * 白文字+黒の縁取り。-webkit-text-stroke は線の内側にも食い込むので、黒く縁取った写しの上に
 * 色付きの写しを重ねて、縁を外側だけに見せる(athcon-video-self-edit/src/self/OutlineStack.tsx と同じ方法)。
 * render(stroke) は stroke が true のとき黒い写し用の中身(色は付けない)を返す
 */
export const Outlined = ({
  outline,
  render,
  shadow = true,
  style,
  color = INK,
}: {
  /** 縁の色(既定は黒) */
  color?: string
  /** 文字の外に見える縁の太さ(px) */
  outline: number
  render: (stroke: boolean) => React.ReactNode
  shadow?: boolean
  style?: React.CSSProperties
}) => (
  <div style={{ display: "grid", ...style }}>
    <div
      aria-hidden
      style={{
        gridArea: "1 / 1",
        position: "relative",
        color,
        WebkitTextStroke: `${outline * 2}px ${color}`,
        filter: shadow ? `drop-shadow(0 ${outline * 0.6}px ${outline * 0.5}px rgba(0,0,0,0.45))` : undefined,
      }}
    >
      {render(true)}
    </div>
    <div style={{ gridArea: "1 / 1", position: "relative", color: "#ffffff" }}>{render(false)}</div>
  </div>
)

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3
