import { describe, expect, it } from "vitest"
import { parseMarkup, sentencesOf, type SswcScene } from "./markup.ts"

describe("parseMarkup", () => {
  it("印を外して位置を返す", () => {
    expect(parseMarkup("筋力が##23%##も**上がる**")).toEqual({
      text: "筋力が23%も上がる",
      emphasis: [
        { start: 3, end: 6, kind: "number" },
        { start: 7, end: 10, kind: "keyword" },
      ],
    })
  })
  it("閉じていない印は壊さない", () => {
    expect(parseMarkup("**あ")).toEqual({ text: "**あ", emphasis: [] })
    expect(parseMarkup("##あ")).toEqual({ text: "##あ", emphasis: [] })
  })
  it("印がなければそのまま", () => {
    expect(parseMarkup("こんにちは")).toEqual({ text: "こんにちは", emphasis: [] })
  })
})

describe("sentencesOf", () => {
  it("行を文に分け、印を引き継ぐ", () => {
    const scenes: SswcScene[] = [
      { role: "つかみ", lines: ["**知ってる？**今日は##3回##やる。次です！"] },
      { role: "締め", lines: ["おわり"] },
    ]
    const r = sentencesOf(scenes)
    expect(r.map((s) => s.text)).toEqual(["知ってる？", "今日は3回やる。", "次です！", "おわり"])
    expect(r.map((s) => s.sceneIndex)).toEqual([0, 0, 0, 1])
    expect(r[0].marked.emphasis).toEqual([{ start: 0, end: 5, kind: "keyword" }])
    expect(r[1].marked.emphasis).toEqual([{ start: 3, end: 5, kind: "number" }])
    expect(r[2].marked.emphasis).toEqual([])
  })
  it("閉じ括弧は前の文に付ける", () => {
    const r = sentencesOf([{ role: "つかみ", lines: ["「行こう！」と言った。（本当）"] }])
    expect(r.map((s) => s.text)).toEqual(["「行こう！」", "と言った。", "（本当）"])
  })
})
