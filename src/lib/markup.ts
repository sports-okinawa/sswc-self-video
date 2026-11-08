// 台本の印(**強調**・##数字##)の解析。webapp の libs/sswcPaper/script.ts の SswcScene と同じ形。

export type SswcScene = {
  role: "つかみ" | "驚きの事実" | "根拠" | "明日からできること" | "締め"
  lines: string[]
}

export type Emphasis = { start: number; end: number; kind: "keyword" | "number" }
export type Marked = { text: string; emphasis: Emphasis[] }

// 位置は text の文字(コードポイント)単位
export const parseMarkup = (line: string): Marked => {
  const chars = Array.from(line)
  const out: string[] = []
  const emphasis: Emphasis[] = []
  let i = 0
  while (i < chars.length) {
    const mark = chars[i] === "*" && chars[i + 1] === "*" ? "**" : chars[i] === "#" && chars[i + 1] === "#" ? "##" : null
    if (mark) {
      // 閉じる印を探す(中身が空のものは印として扱わない)
      let close = -1
      for (let j = i + 3; j < chars.length - 1; j++) {
        if (chars[j] === mark[0] && chars[j + 1] === mark[1]) {
          close = j
          break
        }
      }
      if (close !== -1) {
        const start = out.length
        for (let k = i + 2; k < close; k++) out.push(chars[k])
        emphasis.push({ start, end: out.length, kind: mark === "**" ? "keyword" : "number" })
        i = close + 2
        continue
      }
    }
    out.push(chars[i])
    i++
  }
  return { text: out.join(""), emphasis }
}

const TERMINATORS = new Set(["。", "!", "?", "！", "？"])

// 各 line を「。!?」で文に分ける(句点は前の文に残す)。印は分けた後の文に引き継ぐ
export const sentencesOf = (scenes: SswcScene[]): { text: string; sceneIndex: number; marked: Marked }[] => {
  const result: { text: string; sceneIndex: number; marked: Marked }[] = []
  scenes.forEach((scene, sceneIndex) => {
    for (const line of scene.lines) {
      const marked = parseMarkup(line)
      const chars = Array.from(marked.text)
      let from = 0
      const flush = (to: number) => {
        if (to <= from) return
        const text = chars.slice(from, to).join("")
        if (text.trim() === "") {
          from = to
          return
        }
        const base = from
        const emphasis = marked.emphasis
          .filter((e) => e.end > base && e.start < to)
          .map((e) => ({ start: Math.max(e.start, base) - base, end: Math.min(e.end, to) - base, kind: e.kind }))
        result.push({ text, sceneIndex, marked: { text, emphasis } })
        from = to
      }
      for (let i = 0; i < chars.length; i++) {
        if (TERMINATORS.has(chars[i])) {
          // 連続する句点・記号は同じ文にまとめる
          while (i + 1 < chars.length && TERMINATORS.has(chars[i + 1])) i++
          flush(i + 1)
        }
      }
      flush(chars.length)
    }
  })
  return result
}
