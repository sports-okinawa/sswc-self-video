// 画面最上部 8px の進み具合(水色)
import { useCurrentFrame } from "remotion"
import { SKY } from "./theme"

export const PROGRESS_HEIGHT = 8

export const ProgressBar = ({ totalFrames }: { totalFrames: number }) => {
  const frame = useCurrentFrame()
  const p = Math.min(1, frame / Math.max(1, totalFrames - 1))
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: PROGRESS_HEIGHT, background: "rgba(0,0,0,0.25)" }}>
      <div style={{ width: `${p * 100}%`, height: "100%", background: SKY, boxShadow: `0 0 12px ${SKY}` }} />
    </div>
  )
}
