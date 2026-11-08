// 表紙(縦 1080×1920): 冒頭 0.5 秒の映像 + タイトル。
// Instagram の一覧では中央 4:5 が見えるので、タイトルは画面の中ほどに置く
import { AbsoluteFill, OffthreadVideo, useVideoConfig } from "remotion"
import { fitTitle } from "../lib/captionLines.ts"
import { useFonts } from "./fonts"
import { mediaSrc, WIDTH, type SswcVideoProps } from "./props.ts"
import { NAVY, ORANGE, Outlined } from "./theme"

// 冒頭 0.5 秒。Still は fps が 1 なので、trimBefore は Still の fps で数える
const COVER_AT_SEC = 0.5
const MARGIN_X = 90

export const Cover = (props: SswcVideoProps) => {
  const { display } = useFonts()
  const { fps } = useVideoConfig()
  const { fontSize, lines } = fitTitle(props.title, {
    width: WIDTH - MARGIN_X * 2 - 60,
    maxSize: 128,
    preferredMinSize: 100,
    minSize: 72,
    maxLines: 3,
  })
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <AbsoluteFill>
        <OffthreadVideo
          src={mediaSrc(props.video)}
          trimBefore={COVER_AT_SEC * fps}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
      {/* タイトルの所を少し暗くして浮かせる */}
      <AbsoluteFill
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 20%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 75%)" }}
      />
      <div
        style={{
          position: "absolute",
          top: 560,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ position: "relative", padding: `${fontSize * 0.14}px ${fontSize * 0.32}px` }}>
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
              style={{ fontFamily: display, fontSize, lineHeight: 1.2, whiteSpace: "nowrap", textAlign: "center" }}
              render={() => line}
            />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}
