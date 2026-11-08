import { describe, expect, it } from "vitest"
import type { ScriptAlignment } from "./align.ts"
import { buildTimeline } from "./captions.ts"
import type { Segment } from "./cutPlan.ts"
import { sentencesOf, type SswcScene } from "./markup.ts"

// 1 文字 100ms ごとに読む文の alignment(元動画の時刻)
const sent = (index: number, text: string, startMs: number) => {
  const chars = Array.from(text)
  return { index, startMs, endMs: startMs + chars.length * 100, charMs: chars.map((_, i) => startMs + i * 100) }
}

const scenes: SswcScene[] = [
  { role: "つかみ", lines: ["あいうえおかきくけこさしすせそたちつてと。"] },
  { role: "根拠", lines: ["見つからない文です。", "筋肉は##3倍##に**増える**。"] },
]

describe("buildTimeline", () => {
  const sentences = sentencesOf(scenes)
  const second = "筋肉は3倍に増える。"
  const alignment: ScriptAlignment = {
    sentences: [sent(0, sentences[0].text, 1000), sent(2, sentences[2].text, 10000)],
    missing: [1],
    heard: [],
  }
  const segments: Segment[] = [
    { srcStartMs: 880, srcEndMs: 3180 },
    { srcStartMs: 9880, srcEndMs: 11180 },
  ]
  const t = buildTimeline(sentences, alignment, segments, scenes)

  it("limits each cue to 2 lines of 13 units", () => {
    expect(t.cues.length).toBeGreaterThan(1)
    for (const c of t.cues) {
      expect(c.text.length).toBeLessThanOrEqual(26)
      expect(c.endMs).toBeGreaterThanOrEqual(c.startMs)
    }
    expect(t.cues.map((c) => c.text).join("")).toContain(sentences[0].text.slice(0, 5))
  })

  it("keeps emphasis positions inside the split cue", () => {
    const cue = t.cues.find((c) => c.text.includes("増える"))!
    for (const e of cue.emphasis) expect(cue.text.slice(e.start, e.end)).toMatch(/3倍|増える/)
    expect(cue.emphasis.map((e) => cue.text.slice(e.start, e.end)).sort()).toEqual(["3倍", "増える"].sort())
  })

  it("has no captions for missing sentences", () => {
    expect(t.cues.some((c) => c.text.includes("見つからない"))).toBe(false)
  })

  it("bigNumbers time is the first char read time after cutting", () => {
    expect(second).toBe(sentences[2].text)
    // 「3」は 3 文字目(index 3)。src 10000+300=10300 → 付け替え 2300 + (10300-9880)
    expect(t.bigNumbers).toEqual([{ atMs: 2300 + 420, text: "3倍" }])
  })

  it("marks scenes, zoom points and duration", () => {
    expect(t.scenes).toEqual([
      { sceneIndex: 0, role: "つかみ", startMs: 120 },
      { sceneIndex: 1, role: "根拠", startMs: 2300 + 120 },
    ])
    expect(t.durationMs).toBe(2300 + 1300)
    expect(t.zoomAtMs).toContain(2300)
    expect(t.zoomAtMs).toEqual([...t.zoomAtMs].sort((a, b) => a - b))
  })

  it("dedupes zoom points within 1500ms keeping the earlier", () => {
    // 「増える」(index 6)= src 10600 → 2300+720=3020。つなぎ目 2300 と 720ms 差なので 2300 だけ残る
    expect(t.zoomAtMs).toEqual([2300])
  })
})
