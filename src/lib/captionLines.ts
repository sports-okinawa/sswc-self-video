// 写し元: athcon-video-self-edit/src/self/captionLines.ts (485d27f)
// 字幕 1 枚を、画面の幅に収まる行に分ける(ブラウザ任せだと「見ろ」の「ろ」だけが次の行に落ちるため)。
// .mjs から直接 import されることもあるので、型の消去だけで動く構文のみ使う。
import { BREAK_AFTER } from "./captionSplit.ts"
import type { Emphasis } from "./emphasis.ts"
import { titleLines } from "./titleLines.ts"

const EMPHASIS_SCALE = 1.3 // 強調は 1.3 倍の大きさ
const NUMBER_BOX = 0.8 // 数字の強調の白い札(余白・縁)のぶん
const KEYWORD_BOX = 0.32 // 文脈で選んだ言葉の白い札(余白)のぶん
// 行の頭に来てはいけない文字(句読点・小さい仮名・長音・閉じかっこ)
const NO_LINE_START = /^[、。,.!?！？ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ）)」』]/

// 数字の強調(白い札)の途中か
const insideNumber = (emphasis: Emphasis[], at: number) =>
  emphasis.some((e) => e.kind === "number" && at > e.start && at < e.end)

// 単語の途中(カタカナどうし・漢字どうし・英数字どうしの間)
const WORD_INTERIOR = /^(?:[ァ-ヶー]{2}|[一-龯々]{2}|[A-Za-z0-9%.]{2})$/
// 助詞の「や」「の」「へ」の後ろ(BREAK_AFTER ほどではないが、切ってもよい)
const SOFT_BREAK = /[やのへ]$/
// 行の頭が助詞だと読みにくい(禁止まではしない)
const PARTICLE_START = /^[やでのかはがをにともへ]/

const charUnits = (ch: string) => (/[\x20-\x7e]/.test(ch) ? 0.62 : 1)

/**
 * text を、1 行が maxUnits(全角 1 文字 = 1)以内になるよう行に分け、各行の範囲 [start, end)(UTF-16 の位置)を返す。
 * 行数は最小にし、その中で行の長さがそろう位置、なるべく助詞・句読点の直後、強調の外で切る。
 */
export function captionLines(text: string, emphasis: Emphasis[], maxUnits: number): [number, number][] {
  // 切れる位置(UTF-16 の位置)と、そこまでの幅
  const positions: number[] = [0]
  const widths: number[] = [0]
  let pos = 0
  let width = 0
  for (const ch of text) {
    const e = emphasis.find((x) => pos >= x.start && pos < x.end)
    // keyword(色だけ変える言葉)は大きさを変えない
    const scaled = e !== undefined && e.kind !== "keyword"
    width += charUnits(ch) * (scaled ? EMPHASIS_SCALE : 1) +(e && pos === e.start ? (e.kind === "number" ? NUMBER_BOX : e.kind === "keyword" ? KEYWORD_BOX : 0) : 0)
    pos += ch.length
    positions.push(pos)
    widths.push(width)
  }

  const total = widths[positions.length - 1]
  const lines: [number, number][] = []
  let from = 0 // positions の番号
  while (total - widths[from] > maxUnits) {
    const rest = total - widths[from]
    const count = Math.ceil(rest / maxUnits)
    const target = rest / count
    let best = -1
    let bestScore = Infinity
    // まず行数が増えない位置から探し、なければ行数が増えてもよい
    for (const keepCount of [true, false]) {
      for (let i = from + 1; i < positions.length - 1; i++) {
        const w = widths[i] - widths[from]
        if (w > maxUnits) break
        if (keepCount && total - widths[i] > (count - 1) * maxUnits) continue
        const at = positions[i]
        if (NO_LINE_START.test(text.slice(at)) || insideNumber(emphasis, at)) continue
        const score =
          Math.abs(w - target) +
          (BREAK_AFTER.test(text.slice(0, at)) ? 0 : SOFT_BREAK.test(text.slice(0, at)) ? 1 : 2.5) +
          (emphasis.some((e) => at > e.start && at < e.end) ? 3 : 0) +
          (WORD_INTERIOR.test(text.slice(at - 1, at + 1)) ? 2 : 0) +
          (PARTICLE_START.test(text.slice(at)) ? 3 : 0)
        if (score < bestScore) {
          bestScore = score
          best = i
        }
      }
      if (best >= 0) break
    }
    if (best < 0) best = from + 1 // 1 文字でも幅を越える(ありえないほど狭い)とき
    lines.push([positions[from], positions[best]])
    from = best
  }
  lines.push([positions[from], text.length])
  return lines
}

/**
 * 字幕を幅 width(px)に maxLines 行以内で収める文字の大きさと行を返す。
 * baseSize で収まらなければ 2px ずつ小さくする(minSize より小さくはしない)。
 * paddingX は札の左右の余白、強調(1.3 倍)は captionLines が幅に入れる。
 */
export function fitCaption(
  text: string,
  emphasis: Emphasis[],
  width: number,
  paddingX: number,
  baseSize: number,
  maxLines: number,
  minSize: number,
): { fontSize: number; lines: [number, number][] } {
  // 0.3 文字ぶんは、字の幅の見積もりの誤差の余裕
  const maxUnits = (size: number) => (width - paddingX * 2) / size - 0.3
  const base = captionLines(text, emphasis, maxUnits(baseSize))
  if (base.length <= maxLines) return { fontSize: baseSize, lines: base }
  // 縮めるときは、行の幅に 1 割ほどゆとりが出る大きさにする(ぎりぎりだと語の途中でしか切れない)
  let fontSize = baseSize
  while (fontSize - 2 >= minSize) {
    fontSize -= 2
    if (captionLines(text, emphasis, maxUnits(fontSize) * 0.88).length <= maxLines) break
  }
  return { fontSize, lines: captionLines(text, emphasis, maxUnits(fontSize)) }
}

export type TitleFit = { fontSize: number; lines: string[] }

type TitleFitOptions = {
  /** 1 行に使える幅(px) */
  width: number
  maxSize: number
  /** 書いた人の区切り(句読点・改行)のまま 1 句 1 行にするのは、この大きさ以上で入るときだけ */
  preferredMinSize: number
  minSize: number
  maxLines: number
}

// いちばん大きく入る分け方から、この割合まで小さくなる分け方は同じくらいとみなし、句読点で切るもの・行の少ないもの・行の長さがそろうものを選ぶ
const SIZE_TOLERANCE = 0.95

/**
 * タイトルを幅 width(px)に maxLines 行以内で収める文字の大きさと行を返す(冒頭のタイトル・サムネイルで使う)。
 * 1. 句読点・改行で分けた句が maxLines 以内で、1 句 1 行のまま preferredMinSize 以上で入るなら、そのまま(書いた人の区切り)
 * 2. そうでなければ、自然な切れ目(句読点・助詞・「の」などの後ろ。単語の途中や、助詞・小さい仮名・閉じかっこが行頭に来る所は不可)
 *    だけで maxLines 行以内に分ける分け方のうち、文字がいちばん大きく入るもの(ほぼ同じ大きさなら、句読点で切るもの・
 *    行の少ないもの・行の長さがそろうもの)
 * 3. 自然な切れ目では minSize 以上で入らないときは、字幕と同じ切り方で収まるまで小さくする(minSize まで)
 */
export function fitTitle(title: string, { width, maxSize, preferredMinSize, minSize, maxLines }: TitleFitOptions): TitleFit {
  const parts = titleLines(title)
  const sizeFor = (widest: number) => Math.min(maxSize, Math.floor(width / (widest + 0.3)))
  if (parts.length > 0 && parts.length <= maxLines) {
    const size = sizeFor(Math.max(...parts.map(lineUnits)))
    if (size >= preferredMinSize) return { fontSize: size, lines: parts }
  }

  const text = parts.join("")
  const chars = [...text]
  // 句の境目(句読点・改行の所)は必ず切ってよい
  const partEnds = new Set<number>()
  let count = 0
  for (const part of parts) partEnds.add((count += [...part].length))
  const breaks: number[] = []
  for (let i = 1; i < chars.length; i++) {
    if (partEnds.has(i) || naturalBreak(chars.slice(0, i).join(""), chars.slice(i).join(""))) breaks.push(i)
  }
  const prefix = [0]
  for (const ch of chars) prefix.push(prefix[prefix.length - 1] + charUnits(ch))

  type Option = { cuts: number[]; size: number; punctuation: number; ragged: number }
  const options: Option[] = []
  const visit = (cuts: number[], from: number) => {
    const ends = [...cuts, chars.length]
    const widths = ends.map((end, i) => prefix[end] - prefix[i === 0 ? 0 : ends[i - 1]])
    options.push({
      cuts,
      size: sizeFor(Math.max(...widths)),
      punctuation: cuts.filter((c) => partEnds.has(c)).length,
      ragged: Math.max(...widths) - Math.min(...widths),
    })
    if (cuts.length + 1 >= maxLines) return
    for (const b of breaks) if (b > from) visit([...cuts, b], b)
  }
  if (chars.length > 0) visit([], 0)
  const biggest = Math.max(0, ...options.map((o) => o.size))
  const chosen = options
    .filter((o) => o.size >= biggest * SIZE_TOLERANCE)
    .sort((a, b) => b.punctuation - a.punctuation || a.cuts.length - b.cuts.length || a.ragged - b.ragged || b.size - a.size)[0]
  if (chosen && chosen.size >= minSize) {
    const ends = [...chosen.cuts, chars.length]
    return { fontSize: chosen.size, lines: ends.map((end, i) => chars.slice(i === 0 ? 0 : ends[i - 1], end).join("")) }
  }

  // 自然な切れ目だけでは入らない(とても長いタイトル): 字幕と同じ切り方で、収まるまで小さくする
  const cut = (size: number) => captionLines(text, [], width / size - 0.3).map(([s, e]) => text.slice(s, e))
  for (let size = maxSize; size > minSize; size -= 2) {
    const lines = cut(size)
    if (lines.length <= maxLines) return { fontSize: size, lines }
  }
  return { fontSize: minSize, lines: cut(minSize) }
}

const lineUnits = (line: string) => [...line].reduce((n, ch) => n + charUnits(ch), 0)

/** タイトルの行の分け方が、すべて自然な切れ目(句読点・助詞のあと等)か。言葉の途中(「ス/プリント」)で切っていれば false */
export function linesBreakNaturally(lines: string[]): boolean {
  for (let i = 1; i < lines.length; i++) {
    const before = lines.slice(0, i).join("")
    if (!naturalBreak(before, lines.slice(i).join("")) && !/[、。，．！？!?s]$/.test(before)) return false
  }
  return true
}

// before と after の間で行を変えるのが自然か
function naturalBreak(before: string, after: string): boolean {
  if (NO_LINE_START.test(after) || PARTICLE_START.test(after) || /^[”’]/.test(after)) return false
  if (/[“‘「『（(]$/.test(before)) return false
  if (WORD_INTERIOR.test(before.slice(-1) + after.slice(0, 1))) return false
  return BREAK_AFTER.test(before) || SOFT_BREAK.test(before) || /[」』）)”’]$/.test(before)
}
