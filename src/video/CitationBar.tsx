// 出典: 「根拠」の場面の間、画面上部に小さく(28px、2 行まで)
import { useCurrentFrame } from "remotion"
import type { SceneMark } from "../lib/captions.ts"
import { msToFrame } from "./props.ts"
import { NAVY } from "./theme"

export const CITATION_SIZE = 28
const TOP = 130 // 進み具合のバーと Instagram の上の表示の下

/** 「根拠」の場面の範囲(コマ)。次の場面の頭か、本編の終わりまで */
export const evidenceRanges = (scenes: SceneMark[], mainFrames: number): [number, number][] =>
  scenes
    .map((s, i) => ({ s, next: scenes[i + 1] }))
    .filter(({ s }) => s.role === "根拠")
    .map(({ s, next }) => [msToFrame(s.startMs), next ? msToFrame(next.startMs) : mainFrames])

export const CitationBar = ({
  citation,
  scenes,
  mainFrames,
  fontFamily,
}: {
  citation: string
  scenes: SceneMark[]
  mainFrames: number
  fontFamily: string
}) => {
  const frame = useCurrentFrame()
  const range = evidenceRanges(scenes, mainFrames).find(([a, b]) => frame >= a && frame < b)
  if (!range || citation.trim() === "") return null
  const fade = Math.min(1, (frame - range[0]) / 6, (range[1] - frame) / 6)
  return (
    <div style={{ position: "absolute", top: TOP, left: 48, right: 48, display: "flex", justifyContent: "center", opacity: fade }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          background: "rgba(0,0,0,0.62)",
          borderRadius: 14,
          padding: "10px 18px",
          fontFamily,
          fontWeight: 900,
          fontSize: CITATION_SIZE,
          lineHeight: 1.4,
          color: "#ffffff",
        }}
      >
        <span style={{ flexShrink: 0, background: NAVY, borderRadius: 8, padding: "0 10px" }}>出典</span>
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            fontWeight: 700,
          }}
        >
          {citation}
        </span>
      </div>
    </div>
  )
}
