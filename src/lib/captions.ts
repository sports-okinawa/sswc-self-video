// 字幕(1 枚 2 行・1 行 13 字)と演出(数字の大写し・ズーム・場面の頭)の時刻。時刻はすべて「切った後」。
import type { ScriptAlignment } from "./align.ts"
import { captionLines } from "./captionLines.ts"
import type { Segment } from "./cutPlan.ts"
import { toCutTime } from "./cutPlan.ts"
import type { Marked, SswcScene, sentencesOf } from "./markup.ts"

export type Cue = { startMs: number; endMs: number; text: string; emphasis: Marked["emphasis"] }
export type BigNumber = { atMs: number; text: string }
export type SceneMark = { sceneIndex: number; role: SswcScene["role"]; startMs: number }

export const MAX_LINE_UNITS = 13
export const MAX_CUE_LINES = 2
export const ZOOM_DEDUPE_MS = 1500

// 切った部分の時刻は、いちばん近い残った時刻に寄せる
const nearestCutTime = (srcMs: number, segments: Segment[]): number => {
  const exact = toCutTime(srcMs, segments)
  if (exact !== null) return exact
  let offset = 0
  let best = 0
  let bestDist = Infinity
  for (const seg of segments) {
    const len = seg.srcEndMs - seg.srcStartMs
    for (const [src, cut] of [[seg.srcStartMs, offset], [seg.srcEndMs, offset + len]] as const) {
      const d = Math.abs(src - srcMs)
      if (d < bestDist) {
        bestDist = d
        best = cut
      }
    }
    offset += len
  }
  return best
}

export const buildTimeline = (
  sentences: ReturnType<typeof sentencesOf>,
  alignment: ScriptAlignment,
  segments: Segment[],
  scenes: SswcScene[],
): { cues: Cue[]; bigNumbers: BigNumber[]; scenes: SceneMark[]; zoomAtMs: number[]; durationMs: number } => {
  const cues: Cue[] = []
  const bigNumbers: BigNumber[] = []
  const sceneMarks: SceneMark[] = []
  const keywordZooms: number[] = []
  const timingByIndex = new Map(alignment.sentences.map((s) => [s.index, s]))

  sentences.forEach((sentence, i) => {
    const timing = timingByIndex.get(i)
    if (!timing) return
    const chars = Array.from(sentence.text)
    // 文字(コードポイント)ごとの切った後の時刻
    const charCut = chars.map((_, k) => nearestCutTime(timing.charMs[k] ?? timing.startMs, segments))
    const sentenceEnd = Math.max(nearestCutTime(timing.endMs, segments), charCut[charCut.length - 1] ?? 0)
    // UTF-16 の位置 → コードポイントの番号
    const cpIndexAt: number[] = []
    chars.forEach((ch, k) => {
      for (let u = 0; u < ch.length; u++) cpIndexAt.push(k)
    })
    cpIndexAt.push(chars.length)
    const cpToUtf16: number[] = [0]
    chars.forEach((ch) => cpToUtf16.push(cpToUtf16[cpToUtf16.length - 1] + ch.length))

    if (!sceneMarks.some((m) => m.sceneIndex === sentence.sceneIndex)) {
      sceneMarks.push({
        sceneIndex: sentence.sceneIndex,
        role: scenes[sentence.sceneIndex].role,
        startMs: charCut[0] ?? 0,
      })
    }

    // markup の強調は文字単位(コードポイント)。captionLines は UTF-16 の位置
    const emphasis16 = sentence.marked.emphasis.map((e) => ({ start: cpToUtf16[e.start], end: cpToUtf16[e.end], kind: e.kind }))
    for (const e of sentence.marked.emphasis) {
      const at = charCut[e.start] ?? 0
      if (e.kind === "number") bigNumbers.push({ atMs: at, text: chars.slice(e.start, e.end).join("") })
      else keywordZooms.push(at)
    }

    const lines = captionLines(sentence.text, emphasis16, MAX_LINE_UNITS)
    const first = cues.length
    for (let l = 0; l < lines.length; l += MAX_CUE_LINES) {
      const from = lines[l][0]
      const to = lines[Math.min(l + MAX_CUE_LINES, lines.length) - 1][1]
      cues.push({
        startMs: charCut[cpIndexAt[from]] ?? 0,
        endMs: 0,
        text: sentence.text.slice(from, to),
        emphasis: emphasis16
          .filter((e) => e.end > from && e.start < to)
          .map((e) => ({ start: Math.max(e.start, from) - from, end: Math.min(e.end, to) - from, kind: e.kind })),
      })
    }
    // 終わりは次の枚の頭。文の最後の枚は文の終わり
    for (let c = first; c < cues.length; c++) {
      const end = c + 1 < cues.length && c + 1 > first ? cues[c + 1].startMs : sentenceEnd
      cues[c].endMs = Math.max(cues[c].startMs, end)
    }
  })

  // 区間のつなぎ目(最後の区間の終わりは除く)
  const joins: number[] = []
  let total = 0
  segments.forEach((seg, k) => {
    total += seg.srcEndMs - seg.srcStartMs
    if (k < segments.length - 1) joins.push(total)
  })
  const zoomAtMs: number[] = []
  for (const at of [...joins, ...keywordZooms].sort((a, b) => a - b)) {
    if (zoomAtMs.length === 0 || at - zoomAtMs[zoomAtMs.length - 1] >= ZOOM_DEDUPE_MS) zoomAtMs.push(at)
  }

  return {
    cues,
    bigNumbers: bigNumbers.sort((a, b) => a.atMs - b.atMs),
    scenes: sceneMarks.sort((a, b) => a.sceneIndex - b.sceneIndex),
    zoomAtMs,
    durationMs: total,
  }
}
