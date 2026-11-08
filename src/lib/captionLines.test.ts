// 写し元: athcon-video-self-edit/src/self/captionLines.test.ts (485d27f)
import { describe, expect, it } from "vitest"

import { captionLines, fitCaption, fitTitle } from "./captionLines.ts"
import type { Emphasis } from "./emphasis.ts"

const split = (text: string, emphasis: Emphasis[], max: number) =>
  captionLines(text, emphasis, max).map(([s, e]) => text.slice(s, e))

describe("captionLines", () => {
  it("keeps a caption that fits on one line", () => {
    expect(split("対象選手の76%はプロ。", [{ start: 5, end: 8, kind: "number" }], 14)).toEqual(["対象選手の76%はプロ。"])
  })

  it("counts emphasis as 1.3 times wider and never cuts inside a number", () => {
    expect(split("対象選手の76%はプロ。", [{ start: 5, end: 8, kind: "number" }], 9)).toEqual(["対象選手の", "76%はプロ。"])
    expect(split("ユースアカデミーは10%、", [{ start: 9, end: 12, kind: "number" }], 9)).toEqual([
      "ユースアカデミーは",
      "10%、",
    ])
  })

  it("does not enlarge a keyword (only its small white box counts)", () => {
    // 「スポーツ研究」を 1.3 倍に数えると全角 17 文字ぶんに収まらないが、keyword は大きさを変えないので 1 行のまま
    const text = "AIのスポーツ研究は実はプロばかり"
    expect(split(text, [{ start: 3, end: 9, kind: "keyword" }], 17)).toEqual([text])
    expect(split(text, [{ start: 3, end: 9, kind: "quote" }], 17)).toHaveLength(2)
  })

  it("uses the fewest lines, cutting inside a quote rather than adding a line", () => {
    expect(split("AIの前に自分のチームのデータを見ろ", [{ start: 5, end: 15, kind: "quote" }], 14)).toEqual([
      "AIの前に自分の",
      "チームのデータを見ろ",
    ])
  })

  it("prefers cutting after a particle, not inside a word, and never before punctuation", () => {
    expect(split("データから作られたのか、気にしたことは", [], 14)).toEqual(["データから作られたのか、", "気にしたことは"])
    expect(split("AIのスポーツ研究、", [], 9)).toEqual(["AIの", "スポーツ研究、"])
    expect(split("まずは自分のチームの測定や練習の記録を、", [], 12)).toEqual(["まずは自分のチームの", "測定や練習の記録を、"])
  })

  it("returns UTF-16 ranges that cover the whole text", () => {
    const text = "𠮷野家で76%"
    const lines = captionLines(text, [{ start: 5, end: 8, kind: "number" }], 3)
    expect(lines[0][0]).toBe(0)
    expect(lines[lines.length - 1][1]).toBe(text.length)
    expect(lines.map(([s, e]) => text.slice(s, e)).join("")).toBe(text)
  })
})

describe("fitCaption", () => {
  const long = "まずは自分のチームの測定や練習の記録を同じ方法で続けて貯めること"
  it("keeps the base size when the caption fits in the line limit", () => {
    const r = fitCaption("女性はわずか3%。", [{ start: 6, end: 8, kind: "number" }], 576, 26, 52, 3, 36)
    expect(r.fontSize).toBe(52)
    expect(r.lines).toHaveLength(1)
  })
  it("shrinks the font until a long caption fits in 3 lines", () => {
    const base = captionLines(long, [], (576 - 52) / 52 - 0.3)
    expect(base.length).toBeGreaterThan(3)
    const r = fitCaption(long, [], 576, 26, 52, 3, 36)
    expect(r.lines.length).toBeLessThanOrEqual(3)
    expect(r.fontSize).toBeLessThan(52)
    expect(r.fontSize).toBeGreaterThanOrEqual(36)
  })
  it("stops at the minimum size even if it still needs more lines", () => {
    const r = fitCaption(long + long, [], 576, 26, 52, 3, 36)
    expect(r.fontSize).toBe(36)
    expect(r.lines.length).toBeGreaterThan(3)
  })
})

describe("fitTitle", () => {
  const opts = { width: 860, maxSize: 96, preferredMinSize: 72, minSize: 48, maxLines: 3 }

  it("keeps the author's phrases (split after punctuation) one per line when they fit large enough", () => {
    const r = fitTitle("AIのスポーツ研究、実は“プロ”ばっかり？", opts)
    expect(r.lines).toEqual(["AIのスポーツ研究、", "実は“プロ”ばっかり？"])
    expect(r.fontSize).toBeGreaterThanOrEqual(72)
    expect(r.fontSize).toBeLessThanOrEqual(96)
  })

  it("breaks a long phrase at a natural point so a particle or small kana never starts a line", () => {
    const r = fitTitle("練習前の静的ストレッチはパフォーマンスを下げるのか", opts)
    expect(r.lines.length).toBeGreaterThan(1)
    expect(r.lines.length).toBeLessThanOrEqual(3)
    expect(r.lines.join("")).toBe("練習前の静的ストレッチはパフォーマンスを下げるのか")
    for (const line of r.lines.slice(1)) expect(line).not.toMatch(/^[やでのかはがをにともへ、。ーぁぃぅぇぉっゃゅょ]/)
    expect(r.lines).toEqual(["練習前の静的ストレッチは", "パフォーマンスを", "下げるのか"]) // 「スト|レッチ」のように単語の途中では切らない
  })

  it("never ends a line with an opening quote or starts one with a closing quote", () => {
    const r = fitTitle("AIのスポーツ研究、実は“プロ”ばっかり？", { width: 840, maxSize: 150, preferredMinSize: 110, minSize: 48, maxLines: 3 })
    expect(r.lines).toEqual(["AIのスポーツ研究、", "実は“プロ”", "ばっかり？"])
  })

  it("shrinks (not below minSize) to stay within maxLines", () => {
    const long = "睡眠不足の選手は、反応が遅れて、ケガも増える、という研究を、わかりやすく解説します"
    const r = fitTitle(long, opts)
    expect(r.lines.length).toBeLessThanOrEqual(3)
    expect(r.fontSize).toBeGreaterThanOrEqual(48)
    expect(r.fontSize).toBeLessThan(96)
    expect(r.lines.join("")).toBe(long.replace(/\s/g, ""))
  })
})
