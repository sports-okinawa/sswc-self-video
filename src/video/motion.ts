// 演出の時間の計算(描画から切り離してテストする)
import { FPS, msToFrame } from "./props.ts"

export const ZOOM_IN = 1.18
export const ZOOM_FRAMES = 8
export const COUNT_FRAMES = 18
export const BIG_NUMBER_FRAMES = Math.round(1.6 * FPS)

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** zoomFrames(コマ)ごとに 1.0 と 1.18 を交互に。8 コマで寄る・戻る */
export const zoomScaleAt = (frame: number, zoomFrames: number[]): number => {
  let k = -1
  for (let i = 0; i < zoomFrames.length; i++) if (frame >= zoomFrames[i]) k = i
  if (k < 0) return 1
  const target = k % 2 === 0 ? ZOOM_IN : 1
  const from = k % 2 === 0 ? 1 : ZOOM_IN
  const t = Math.min(1, (frame - zoomFrames[k]) / ZOOM_FRAMES)
  return from + (target - from) * easeInOut(t)
}

/** 数字の部分だけ 0 から数え上げる(単位・前後の字はそのまま。小数の桁数も元に合わせる) */
export const countUpText = (text: string, progress: number): string => {
  const m = /\d+(?:\.\d+)?/.exec(text)
  if (!m) return text
  const target = Number(m[0])
  const decimals = m[0].includes(".") ? m[0].split(".")[1].length : 0
  const p = Math.min(1, Math.max(0, progress))
  const value = p >= 1 ? m[0] : (target * p).toFixed(decimals)
  return text.slice(0, m.index) + value + text.slice(m.index + m[0].length)
}

/** frame で出している数字(1.6 秒の間。重なれば後の数字) */
export const activeBigNumber = <T extends { atMs: number }>(list: T[], frame: number): (T & { startFrame: number }) | null => {
  let found: (T & { startFrame: number }) | null = null
  for (const n of list) {
    const start = msToFrame(n.atMs)
    if (frame >= start && frame < start + BIG_NUMBER_FRAMES) found = { ...n, startFrame: start }
  }
  return found
}
