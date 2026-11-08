// 写し元: athcon-video-self-edit/src/self/align.ts (485d27f)
// 台本の文と文字起こしを照合し、字幕の時刻を決める。撮影した動画は一切カットしない(ここでは残す所を決めない)。
// .mjs から直接 import されるので、型の消去だけで動く構文のみ使う。
//
// 文字起こしの単語は実際には 1 文字(または短い断片)ずつで、長さ 0 のものもある。
// 日本語には空白が無いので、照合は単語列をつなげた文字列に対して文字単位で行い、
// 文字の位置を単語の時刻に戻す。
// 読み方の違い(漢数字と数字・パーセントと%・「4〜7.5」と「4から7.5」など)は比較用の文字でそろえる。
// 台本の文が見つかったら、最後のテイクに台本の文字で字幕を付ける。
// それ以外で話した所(言い直す前のテイク・台本と違う言い方をした文・前置きや締めの雑談)は、
// すべて聞き取った文字で字幕にする(heard)。

export type Word = { text: string; startMs: number; endMs: number }

export type SentenceTiming = {
  index: number
  startMs: number
  endMs: number
  charMs: number[]
} // 元動画の時刻。charMs は文の各文字(元の文字列の 1 文字ずつ)の読み上げ時刻

export type HeardSpan = {
  sentenceIndices: number[]
  startMs: number
  endMs: number
  text: string
  charMs: number[]
} // 聞き取った文字で字幕にする区間(元動画の時刻)。charMs は text の 1 文字ずつの時刻。
// sentenceIndices はこの区間で読んだとみなす見つからなかった文(言い直す前のテイクや雑談なら空)

export type ScriptAlignment = {
  sentences: SentenceTiming[]
  missing: number[]
  heard: HeardSpan[] // 時刻順
}

type RawChar = { ch: string; startMs: number; endMs: number } // 文字起こしの 1 文字(記号も含む)
type Char = { ch: string; startMs: number; endMs: number; from: number; to: number } // 比較用の文字。from..to は元の文字の位置
type Candidate = { start: number; end: number; dist: number } // 文字起こしの文字位置 [start, end)
type Norm = { ch: string; from: number; to: number }

const LETTER_OR_NUMBER = /^[\p{L}\p{N}]$/u

// これより短い文(比較用の文字数)は言い直しの間の雑談などにも偶然現れるため、
// 前の文のテイクを選ぶ区切りには使わない(その文自体の照合には使う)。
const MIN_LIMIT_SENTENCE_LENGTH = 4

// これより短い文(比較用の文字数)は、ゆるく照合すると別の言葉に偶然当たる(「つまり」と「あまり」)ので、
// 類似度を SHORT_MIN_SIMILARITY 以上にする(3 文字以下は完全一致になる)。
const SHORT_SENTENCE_LENGTH = 8
const SHORT_MIN_SIMILARITY = 0.75

// 最初に見つかった文より前・最後に見つかった文より後で、見つからなかった文に結びつけるのは続けて話している所だけ。
// この長さ以上の無音で止め、見つからない文を読む時間(比較用の文字数 ÷ EDGE_CHARS_PER_SEC)の 2 倍 + EDGE_EXTRA_MS までにする。
const EDGE_MAX_SILENCE_MS = 1500
const EDGE_CHARS_PER_SEC = 7
const EDGE_EXTRA_MS = 1000

// 聞き取った文字の区間は、この長さ以上の無音で分ける(字幕が無音の間に出たままにならないように)
const SPLIT_SILENCE_MS = 1000

const KANJI_DIGIT: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const KANJI_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
const isDigit = (c: string | undefined) => c !== undefined && /^[0-9]$/.test(c)
const isNumeral = (c: string | undefined) =>
  c !== undefined && (isDigit(c) || c in KANJI_DIGIT || c in KANJI_UNIT || c === "万")
const PERCENT = "ぱーせんと"
const RANGE_MARK = /^[〜~\-−–—]$/
const LEADING_JUNK = /^[\s、。,，.．!?！？…・]$/u

/** 全角英数 → 半角、カタカナ → ひらがな、小文字にする。 */
function widen(ch: string): string {
  let code = ch.codePointAt(0)
  if (code === undefined) return ch
  if (code >= 0xff01 && code <= 0xff5e) code -= 0xfee0
  if (code >= 0x30a1 && code <= 0x30f6) code -= 0x60
  return String.fromCodePoint(code).toLowerCase()
}

const isSpoken = (ch: string) => {
  const w = widen(ch)
  return w === "%" || LETTER_OR_NUMBER.test(w)
}

/** 漢数字・数字の並びを数字の文字列にする(「二十五」→「25」、「三百」→「300」、「七五」→「75」)。 */
function numeralText(run: string[]): string {
  if (!run.some((c) => c in KANJI_UNIT || c === "万")) {
    return run.map((c) => (c in KANJI_DIGIT ? String(KANJI_DIGIT[c]) : c)).join("")
  }
  let total = 0
  let section = 0
  let num = 0
  for (const c of run) {
    if (isDigit(c)) num = num * 10 + Number(c)
    else if (c in KANJI_DIGIT) num = num * 10 + KANJI_DIGIT[c]
    else if (c === "万") {
      total += (section + num || 1) * 10000
      section = 0
      num = 0
    } else {
      section += (num || 1) * KANJI_UNIT[c]
      num = 0
    }
  }
  return String(total + section + num)
}

/**
 * 文字の並びを比較用の文字に直す。各文字は元の何文字目(from..to)から来たかを持つ。
 * 記号・空白・かっこなど比べない文字は落とす。数字の間の「.・」は「.」、「〜・から」は「-」にそろえる。
 */
function normalizeChars(raw: string[]): Norm[] {
  const w = raw.map(widen)
  const n = w.length
  const out: Norm[] = []
  let i = 0
  while (i < n) {
    const c = w[i]
    if (w.slice(i, i + PERCENT.length).join("") === PERCENT) {
      out.push({ ch: "%", from: i, to: i + PERCENT.length - 1 })
      i += PERCENT.length
      continue
    }
    if (isNumeral(c)) {
      let j = i
      while (j < n && isNumeral(w[j])) j++
      const text = [...numeralText(w.slice(i, j))]
      const len = j - i
      text.forEach((ch, k) => {
        const from = i + Math.floor((k * len) / text.length)
        const to = Math.max(from, i + Math.ceil(((k + 1) * len) / text.length) - 1)
        out.push({ ch, from, to })
      })
      i = j
      continue
    }
    if (isDigit(out[out.length - 1]?.ch)) {
      if ((c === "." || c === "・") && isNumeral(w[i + 1])) {
        out.push({ ch: ".", from: i, to: i })
        i++
        continue
      }
      if (RANGE_MARK.test(c) && isNumeral(w[i + 1])) {
        out.push({ ch: "-", from: i, to: i })
        i++
        continue
      }
      if (c === "か" && w[i + 1] === "ら" && isNumeral(w[i + 2])) {
        out.push({ ch: "-", from: i, to: i + 1 })
        i += 2
        continue
      }
    }
    if (c === "%" || LETTER_OR_NUMBER.test(c)) out.push({ ch: c, from: i, to: i })
    i++
  }
  return out
}

/** 文を比較用の文字に分け、各文字が元の文字列の何文字目かを持たせる。 */
function normalizeSentence(sentence: string): { chars: string[]; origIndex: number[]; origLength: number } {
  const orig = [...sentence]
  const norm = normalizeChars(orig)
  return { chars: norm.map((x) => x.ch), origIndex: norm.map((x) => x.from), origLength: orig.length }
}

/** 単語列を 1 文字ずつに分ける。複数文字の単語は時刻を文字数で割り振る。 */
function rawTranscriptChars(words: Word[]): RawChar[] {
  const result: RawChar[] = []
  for (const w of words) {
    const chars = [...w.text]
    const dur = w.endMs - w.startMs
    chars.forEach((ch, k) => {
      result.push({
        ch,
        startMs: w.startMs + (dur * k) / chars.length,
        endMs: w.startMs + (dur * (k + 1)) / chars.length,
      })
    })
  }
  return result
}

/** 文字起こしを比較用の文字列にする。 */
function transcriptChars(raw: RawChar[]): Char[] {
  return normalizeChars(raw.map((r) => r.ch)).map(({ ch, from, to }) => {
    let endMs = raw[from].endMs
    for (let k = from + 1; k <= to; k++) endMs = Math.max(endMs, raw[k].endMs)
    return { ch, startMs: raw[from].startMs, endMs, from, to }
  })
}

/**
 * 文字起こしの中で文に似ている区間を探す(始まりと終わりを自由にした編集距離)。
 * 編集距離が maxDist 以下の区間を、重なるものは距離の小さい方だけ残して返す(始まり順)。
 */
function findCandidates(s: string[], t: Char[], maxDist: number): Candidate[] {
  const n = t.length
  let prev = new Array<number>(n + 1).fill(0)
  let prevStart = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= s.length; i++) {
    const cur = new Array<number>(n + 1)
    const curStart = new Array<number>(n + 1)
    cur[0] = i
    curStart[0] = 0
    for (let j = 1; j <= n; j++) {
      const diag = prev[j - 1] + (s[i - 1] === t[j - 1].ch ? 0 : 1)
      const up = prev[j] + 1 // 文の文字を読み飛ばした
      const left = cur[j - 1] + 1 // 文に無い文字を読んだ
      if (diag <= up && diag <= left) {
        cur[j] = diag
        curStart[j] = prevStart[j - 1]
      } else if (up <= left) {
        cur[j] = up
        curStart[j] = prevStart[j]
      } else {
        cur[j] = left
        curStart[j] = curStart[j - 1]
      }
    }
    prev = cur
    prevStart = curStart
  }

  const all: Candidate[] = []
  for (let j = 1; j <= n; j++) {
    if (prev[j] <= maxDist && prevStart[j] < j) {
      all.push({ start: prevStart[j], end: j, dist: prev[j] })
    }
  }
  all.sort((a, b) => a.dist - b.dist || a.start - b.start || a.end - b.end)
  const chosen: Candidate[] = []
  for (const c of all) {
    if (chosen.every((o) => c.end <= o.start || o.end <= c.start)) chosen.push(c)
  }
  return chosen.sort((a, b) => a.start - b.start)
}

/** 文と選んだ区間を端から端まで照合し、文の各文字(比較用)に対応する文字起こしの位置を返す。 */
function alignWithin(s: string[], t: Char[]): (number | null)[] {
  const m = s.length
  const n = t.length
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j - 1] + (s[i - 1] === t[j - 1].ch ? 0 : 1),
        d[i - 1][j] + 1,
        d[i][j - 1] + 1
      )
    }
  }
  const result: (number | null)[] = new Array(m).fill(null)
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (d[i][j] === d[i - 1][j - 1] + (s[i - 1] === t[j - 1].ch ? 0 : 1)) {
      result[i - 1] = j - 1
      i--
      j--
    } else if (d[i][j] === d[i - 1][j] + 1) {
      i--
    } else {
      j--
    }
  }
  return result
}

/** 時刻の分かっている文字から、分からない文字(記号など)の時刻を前後から補う。 */
function fillTimes(known: (number | null)[], startMs: number): number[] {
  const result = new Array<number>(known.length)
  let lastIdx = -1
  let lastMs = startMs
  for (let i = 0; i < known.length; i++) {
    const k = known[i]
    if (k === null) continue
    for (let g = lastIdx + 1; g < i; g++) {
      result[g] = lastIdx < 0 ? k : lastMs + ((k - lastMs) * (g - lastIdx)) / (i - lastIdx)
    }
    result[i] = k
    lastIdx = i
    lastMs = k
  }
  for (let g = lastIdx + 1; g < known.length; g++) result[g] = lastMs
  return result
}

export function alignScript(sentences: string[], words: Word[], opts?: { minSimilarity?: number }): ScriptAlignment {
  const minSimilarity = opts?.minSimilarity ?? 0.6

  const raw = rawTranscriptChars(words)
  const t = transcriptChars(raw)
  const norm = sentences.map(normalizeSentence)
  const cands = norm.map(({ chars }) => {
    if (chars.length === 0) return []
    const sim = chars.length < SHORT_SENTENCE_LENGTH ? Math.max(minSimilarity, SHORT_MIN_SIMILARITY) : minSimilarity
    return findCandidates(chars, t, (1 - sim) * chars.length + 1e-9)
  })

  const timings: SentenceTiming[] = []
  const rawSpans: RawSpan[] = [] // 見つかった文の、文字起こしの元の文字の範囲
  const missing: number[] = []
  let prevEnd = 0
  for (let i = 0; i < sentences.length; i++) {
    const avail = cands[i].filter((c) => c.start >= prevEnd)
    if (avail.length === 0) {
      missing.push(i)
      continue
    }
    // 次に読まれた文(短すぎる文は除く)の最初の候補が始まるまでに、この文が最後に始まったもの(=最後のテイク)を選ぶ
    const firstEnd = avail[0].end
    let limit = Infinity
    for (let k = i + 1; k < sentences.length; k++) {
      if (norm[k].chars.length < MIN_LIMIT_SENTENCE_LENGTH) continue
      const next = cands[k].find((c) => c.start >= firstEnd)
      if (next) {
        limit = next.start
        break
      }
    }
    let chosen = avail[0]
    for (const c of avail) if (c.start < limit) chosen = c
    prevEnd = chosen.end

    const span = t.slice(chosen.start, chosen.end)
    const startMs = span[0].startMs
    const endMs = Math.max(...span.map((c) => c.endMs))
    const { chars, origIndex, origLength } = norm[i]
    const known: (number | null)[] = new Array(origLength).fill(null)
    alignWithin(chars, span).forEach((pos, k) => {
      if (pos !== null && known[origIndex[k]] === null) known[origIndex[k]] = span[pos].startMs
    })
    timings.push({ index: i, startMs, endMs, charMs: fillTimes(known, startMs) })
    rawSpans.push({ index: i, firstFrom: t[avail[0].start].from, from: span[0].from, to: span[span.length - 1].to })
  }

  const heard = heardRegions(sentences.length, rawSpans, raw, norm.map((x) => x.chars.length)).flatMap((r) =>
    splitAtSilence(r, raw)
  )
  return { sentences: timings, missing, heard }
}

// 見つかった文の、文字起こしの元の文字の位置。firstFrom は最初の候補(言い直す前のテイク)の始まり、from..to は選んだテイク
type RawSpan = { index: number; firstFrom: number; from: number; to: number }

// 選んだテイクの外の、文字起こしの元の文字の範囲 [from, to]。sentenceIndices はその範囲で読んだとみなす見つからなかった文
type Region = { from: number; to: number; sentenceIndices: number[] }

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k)

/**
 * 選んだテイクの外を、すべて区間に分ける(どこも捨てない)。
 * - 前後の見つかった文の間で、次の文の最初の候補より前 → その間の見つからなかった文を読んだ所
 * - 次の文の最初の候補から選んだテイクの前まで → 言い直す前のテイク(どの文にも結びつけない)
 * - 先頭・末尾 → 見つかった文から続けて話している所だけを見つからなかった文に結びつけ、残り(前置き・締めの雑談)は結びつけない
 */
function heardRegions(count: number, rawSpans: RawSpan[], raw: RawChar[], normLengths: number[]): Region[] {
  if (rawSpans.length === 0) return [{ from: 0, to: raw.length - 1, sentenceIndices: range(0, count) }]
  const maxMs = (indices: number[]) =>
    (2 * indices.reduce((n, i) => n + normLengths[i], 0) * 1000) / EDGE_CHARS_PER_SEC + EDGE_EXTRA_MS
  const regions: Region[] = []

  const first = rawSpans[0]
  const lead = range(0, first.index)
  const leadTo = first.firstFrom - 1
  const leadStart = lead.length > 0 ? edgeStart(raw, 0, leadTo, raw[first.firstFrom].startMs, maxMs(lead)) : leadTo + 1
  regions.push({ from: 0, to: leadStart - 1, sentenceIndices: [] })
  regions.push({ from: leadStart, to: leadTo, sentenceIndices: lead })

  rawSpans.forEach((span, k) => {
    const prev = rawSpans[k - 1]
    if (prev) regions.push({ from: prev.to + 1, to: span.firstFrom - 1, sentenceIndices: range(prev.index + 1, span.index) })
    regions.push({ from: span.firstFrom, to: span.from - 1, sentenceIndices: [] })
  })

  const last = rawSpans[rawSpans.length - 1]
  const trail = range(last.index + 1, count)
  const trailFrom = last.to + 1
  const trailEnd = trail.length > 0 ? edgeEnd(raw, trailFrom, raw.length - 1, raw[last.to].endMs, maxMs(trail)) : trailFrom - 1
  regions.push({ from: trailFrom, to: trailEnd, sentenceIndices: trail })
  regions.push({ from: trailEnd + 1, to: raw.length - 1, sentenceIndices: [] })
  return regions
}

/** 区間を長い無音で分け、話した文字のある所だけを聞き取った区間にする(字幕が無音の間に残らないように) */
function splitAtSilence(region: Region, raw: RawChar[]): HeardSpan[] {
  const out: HeardSpan[] = []
  const flush = (from: number, to: number) => {
    while (from <= to && LEADING_JUNK.test(raw[from].ch)) from++
    while (from <= to && /^\s$/u.test(raw[to].ch)) to--
    const chars = raw.slice(from, to + 1)
    if (!chars.some((c) => isSpoken(c.ch))) return
    out.push({
      sentenceIndices: region.sentenceIndices,
      startMs: chars[0].startMs,
      endMs: Math.max(...chars.map((c) => c.endMs)),
      text: chars.map((c) => c.ch).join(""),
      charMs: chars.map((c) => c.startMs),
    })
  }
  let start = region.from
  let lastSpokenEnd: number | null = null
  for (let k = region.from; k <= region.to; k++) {
    const c = raw[k]
    if (!isSpoken(c.ch)) continue
    if (lastSpokenEnd !== null && c.startMs - lastSpokenEnd >= SPLIT_SILENCE_MS) {
      flush(start, k - 1)
      start = k
    }
    lastSpokenEnd = c.endMs
  }
  flush(start, region.to)
  return out
}

/** 先頭の区間: anchorMs(最初に見つかった文の始まり)から前へ、続けて話している所の始まりの位置。無ければ to + 1 */
function edgeStart(raw: RawChar[], from: number, to: number, anchorMs: number, maxMs: number): number {
  let start = to + 1
  let boundary = anchorMs
  let spanEnd: number | null = null
  for (let k = to; k >= from; k--) {
    const c = raw[k]
    if (!isSpoken(c.ch)) continue
    if (boundary - c.endMs >= EDGE_MAX_SILENCE_MS) break
    if (spanEnd === null) spanEnd = c.endMs
    if (spanEnd - c.startMs > maxMs) break
    boundary = c.startMs
    start = k
  }
  return start
}

/** 末尾の区間: anchorMs(最後に見つかった文の終わり)から後へ、続けて話している所の終わりの位置。無ければ from - 1 */
function edgeEnd(raw: RawChar[], from: number, to: number, anchorMs: number, maxMs: number): number {
  let end = from - 1
  let boundary = anchorMs
  let spanStart: number | null = null
  for (let k = from; k <= to; k++) {
    const c = raw[k]
    if (!isSpoken(c.ch)) continue
    if (c.startMs - boundary >= EDGE_MAX_SILENCE_MS) break
    if (spanStart === null) spanStart = c.startMs
    if (c.endMs - spanStart > maxMs) break
    boundary = c.endMs
    end = k
  }
  return end
}
