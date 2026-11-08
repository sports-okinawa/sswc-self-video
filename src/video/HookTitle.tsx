// 冒頭 0〜3 秒のタイトル: 画面上 1/3 に 96px 前後(fitTitle で 2 行まで)、スケール 1.4→1.0 のバネ + whoosh
import { Audio, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion"
import { fitTitle } from "../lib/captionLines.ts"
import { FPS, mediaSrc, WIDTH } from "./props.ts"
import { clamp01, NAVY, ORANGE, Outlined } from "./theme"

export const HOOK_FRAMES = 3 * FPS
export const HOOK_TOP = 240 // Instagram の上の表示を避ける
const MARGIN_X = 90 // 傾いた帯の余白のぶんも入れる
const OUT_FRAMES = 8

export const fitHookTitle = (title: string) =>
  fitTitle(title, { width: WIDTH - MARGIN_X * 2 - 60, maxSize: 104, preferredMinSize: 88, minSize: 64, maxLines: 2 })

export const HookTitle = ({ title, fontFamily, whoosh }: { title: string; fontFamily: string; whoosh: string | null }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  if (frame >= HOOK_FRAMES || title.trim() === "") return null
  const { fontSize, lines } = fitHookTitle(title)
  const s = spring({ frame, fps, config: { damping: 11, stiffness: 160, mass: 0.7 } })
  const scale = 1.4 - 0.4 * s
  const out = clamp01((HOOK_FRAMES - frame) / OUT_FRAMES)
  return (
    <>
      {whoosh !== null && (
        <Sequence from={0} durationInFrames={HOOK_FRAMES} layout="none">
          <Audio src={mediaSrc(whoosh)} volume={0.6} />
        </Sequence>
      )}
      <div
        style={{
          position: "absolute",
          top: HOOK_TOP,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
          transform: `scale(${scale})`,
          transformOrigin: "50% 30%",
          opacity: Math.min(clamp01(frame / 3 + 0.3), out),
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ position: "relative", padding: `${fontSize * 0.14}px ${fontSize * 0.32}px` }}>
            {/* 傾いた紺の帯(オレンジの下線)で、ジムらしい勢いを出す */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: NAVY,
                transform: `skewX(-10deg) rotate(${i % 2 === 0 ? -2 : 1.5}deg)`,
                borderBottom: `${Math.round(fontSize * 0.1)}px solid ${ORANGE}`,
                boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
              }}
            />
            <Outlined
              outline={Math.round(fontSize * 0.08)}
              style={{ fontFamily, fontSize, lineHeight: 1.2, whiteSpace: "nowrap", textAlign: "center" }}
              render={() => line}
            />
          </div>
        ))}
      </div>
    </>
  )
}
