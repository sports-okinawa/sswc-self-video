// 締め 5 秒: 紺の背景に 3 行(2 行目はオレンジで大きく)。行ごとに少しずつずらして飛び込む
import { spring, useCurrentFrame, useVideoConfig } from "remotion"
import { fitTitle } from "../lib/captionLines.ts"
import { HEIGHT, WIDTH } from "./props.ts"
import { NAVY, ORANGE, Outlined, SKY } from "./theme"

const MARGIN_X = 80
const STAGGER = 6
const fit = (text: string, maxSize: number, maxLines: number) =>
  fitTitle(text, { width: WIDTH - MARGIN_X * 2, maxSize, preferredMinSize: maxSize * 0.8, minSize: 44, maxLines })

export const EndCard = ({ lines, fontFamily }: { lines: string[]; fontFamily: string }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = (i: number) => spring({ frame: frame - i * STAGGER, fps, config: { damping: 12, stiffness: 140 } })
  return (
    <div style={{ position: "absolute", inset: 0, background: NAVY, overflow: "hidden" }}>
      {/* 斜めの水色の帯(背景の飾り) */}
      <div
        style={{
          position: "absolute",
          left: -200,
          right: -200,
          top: HEIGHT * 0.66,
          height: 70,
          background: SKY,
          opacity: 0.35,
          transform: "rotate(-8deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -200,
          right: -200,
          top: HEIGHT * 0.25,
          height: 26,
          background: SKY,
          opacity: 0.25,
          transform: "rotate(-8deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 56,
        }}
      >
        {lines.map((line, i) => {
          const big = i === 1
          const { fontSize, lines: rows } = big ? fit(line, 140, 2) : fit(line, 64, 2)
          const s = enter(i)
          return (
            <div
              key={i}
              style={{
                transform: `translateX(${(1 - s) * (i % 2 === 0 ? -WIDTH : WIDTH)}px) rotate(${big ? -3 : 0}deg)`,
              }}
            >
              <Outlined
                outline={big ? 12 : 8}
                style={{ fontFamily, fontSize, lineHeight: 1.25, textAlign: "center", whiteSpace: "nowrap" }}
                render={(stroke) =>
                  rows.map((r, k) => (
                    <div key={k} style={{ color: stroke || !big ? undefined : ORANGE }}>
                      {r}
                    </div>
                  ))
                }
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
