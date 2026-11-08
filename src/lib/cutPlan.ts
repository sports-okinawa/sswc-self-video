// カットの計画。見つかった文(最後のテイク)だけを残し、文と文の間を詰める。
// 見つからない文・heard 区間(言い直す前のテイクや雑談)は残さない。
import type { ScriptAlignment } from "./align.ts"

export type Segment = { srcStartMs: number; srcEndMs: number }

export const PAD_BEFORE_MS = 120 // 語頭が切れないための余白
export const PAD_AFTER_MS = 180 // 語尾が切れないための余白
export const MAX_GAP_MS = 600 // 余白をつけた区間どうしの隙間がこれ以下なら 1 区間にまとめる
// 切ったあとに区間と区間のあいだに残る間は、余白どうしの合計 PAD_AFTER_MS + PAD_BEFORE_MS = 300ms になる
// (ffmpeg の trim+concat で単純に連結する。間を足さないので字幕の時刻と一致する)

// 余白は常に前 120ms・後 180ms のままにして、語頭・語尾を守る。
// つなぎの間は toCutTime が区間のあいだに KEPT_GAP_MS をはさむ形で表す
// (余白を削って 200ms に合わせると、語頭の余白が 20ms まで減るため採らない)。
export const planCuts = (alignment: ScriptAlignment, videoDurationMs: number): Segment[] => {
  const padded = alignment.sentences
    .map((s) => ({
      srcStartMs: Math.max(0, s.startMs - PAD_BEFORE_MS),
      srcEndMs: Math.min(videoDurationMs, s.endMs + PAD_AFTER_MS),
    }))
    .filter((s) => s.srcEndMs > s.srcStartMs)
    .sort((a, b) => a.srcStartMs - b.srcStartMs || a.srcEndMs - b.srcEndMs)

  const merged: Segment[] = []
  for (const seg of padded) {
    const last = merged[merged.length - 1]
    if (last && seg.srcStartMs - last.srcEndMs <= MAX_GAP_MS) {
      last.srcEndMs = Math.max(last.srcEndMs, seg.srcEndMs)
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}

// 切った後の時刻。切った部分なら null。区間は間を足さずに連結する(ffmpeg の trim+concat と同じ)
export const toCutTime = (srcMs: number, segments: Segment[]): number | null => {
  let offset = 0
  for (const seg of segments) {
    if (srcMs >= seg.srcStartMs && srcMs <= seg.srcEndMs) return offset + (srcMs - seg.srcStartMs)
    offset += seg.srcEndMs - seg.srcStartMs
  }
  return null
}

// 台本の文のうち見つかった割合
export const foundRatio = (alignment: ScriptAlignment, sentenceCount: number): number =>
  sentenceCount <= 0 ? 0 : (sentenceCount - alignment.missing.length) / sentenceCount
