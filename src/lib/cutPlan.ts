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
// (余白を削って 200ms に合わせると、語頭の余白が 20ms まで減るため採らない)。
export const planCuts = (alignment: ScriptAlignment, videoDurationMs: number): Segment[] => {
  const heard = alignment.heard
  const padded = alignment.sentences
    .map((s) => {
      let start = Math.max(0, s.startMs - PAD_BEFORE_MS)
      let end = Math.min(videoDurationMs, s.endMs + PAD_AFTER_MS)
      // 余白は聞き取り区間(言い直す前のテイク・雑談)に食い込ませない。文そのものの [startMs, endMs] は削らない
      for (const h of heard) {
        if (h.startMs < s.startMs && h.endMs > start) start = Math.max(start, Math.min(h.endMs, s.startMs))
        if (h.endMs > s.endMs && h.startMs < end) end = Math.min(end, Math.max(h.startMs, s.endMs))
      }
      return { srcStartMs: start, srcEndMs: end }
    })
    .filter((s) => s.srcEndMs > s.srcStartMs)
    .sort((a, b) => a.srcStartMs - b.srcStartMs || a.srcEndMs - b.srcEndMs)

  const merged: Segment[] = []
  for (const seg of padded) {
    const last = merged[merged.length - 1]
    // 隙間に聞き取り区間があるときは、近くてもまとめない(前のテイクの声が残るため)
    const heardInGap = !!last && heard.some((h) => h.startMs < seg.srcStartMs && h.endMs > last.srcEndMs)
    if (last && seg.srcStartMs - last.srcEndMs <= MAX_GAP_MS && !heardInGap) {
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

export type Silence = { startMs: number; endMs: number }

export const SILENCE_KEEP_MS = 150 // 長い無音を詰めたとき、無音の前後に残す長さ(合わせて約 300ms の間になる)
export const MIN_SEGMENT_MS = 100 // これより短い区間は捨てる

// 音から測った無音(silencedetect)で区間を詰める。文字起こしの時刻は無音の上にも伸びるので、
// MAX_GAP_MS を超える無音は、前後に keepMs ずつ残して中を切る(区間の端にかかる無音は、その端を keepMs まで詰める)
export const trimSilences = (segments: Segment[], silences: Silence[], keepMs = SILENCE_KEEP_MS): Segment[] => {
  const cuts = silences
    .filter((s) => s.endMs - s.startMs > MAX_GAP_MS)
    .map((s) => ({ from: s.startMs + keepMs, to: s.endMs - keepMs }))
    .filter((c) => c.to > c.from)
  let result = segments.map((s) => ({ ...s }))
  for (const c of cuts) {
    const next: Segment[] = []
    for (const seg of result) {
      if (c.to <= seg.srcStartMs || c.from >= seg.srcEndMs) {
        next.push(seg)
        continue
      }
      if (c.from > seg.srcStartMs) next.push({ srcStartMs: seg.srcStartMs, srcEndMs: c.from })
      if (c.to < seg.srcEndMs) next.push({ srcStartMs: c.to, srcEndMs: seg.srcEndMs })
    }
    result = next
  }
  return result.filter((s) => s.srcEndMs - s.srcStartMs >= MIN_SEGMENT_MS)
}
