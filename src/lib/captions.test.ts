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

describe("buildTimeline (split cues, surrogate pairs, snapping)", () => {
  const one = (text: string, role: SswcScene["role"] = "根拠") => {
    const sc: SswcScene[] = [{ role, lines: [text] }]
    const ss = sentencesOf(sc)
    const al: ScriptAlignment = { sentences: [sent(0, ss[0].text, 1000)], missing: [], heard: [] }
    return { ss, al, sc }
  }
  const whole: Segment[] = [{ srcStartMs: 0, srcEndMs: 20000 }]

  it("keeps a keyword in the 2nd cue at the right offset", () => {
    const { ss, al, sc } = one("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも**重要語**です。")
    const t = buildTimeline(ss, al, whole, sc)
    expect(t.cues.length).toBeGreaterThan(1)
    const hit = t.cues.filter((c) => c.emphasis.length > 0)
    expect(hit.length).toBe(1)
    expect(hit[0]).not.toBe(t.cues[0])
    const e = hit[0].emphasis[0]
    expect(hit[0].text.slice(e.start, e.end)).toBe("重要語")
  })

  it("never splits an emphasis across cues, or clips it consistently", () => {
    const { ss, al, sc } = one("あいうえおかきくけこさしすせそたちつてとなにぬねのはひ**ふへほまみむめもやゆよ**らりるれろ。")
    const t = buildTimeline(ss, al, whole, sc)
    expect(t.cues.length).toBeGreaterThan(1)
    const parts = t.cues.flatMap((c) => c.emphasis.map((e) => c.text.slice(e.start, e.end)))
    // 分かれても、つなぐと強調の全文字になる(欠けも重複もない)
    expect(parts.join("")).toBe("ふへほまみむめもやゆよ")
    for (const c of t.cues) for (const e of c.emphasis) expect(e.end).toBeLessThanOrEqual(c.text.length)
  })

  it("handles surrogate pairs in emphasis and times", () => {
    const { ss, al, sc } = one("💪**強い**筋肉と##3倍##です。")
    const t = buildTimeline(ss, al, whole, sc)
    const c = t.cues[0]
    const kw = c.emphasis.find((e) => e.kind === "keyword")!
    expect(c.text.slice(kw.start, kw.end)).toBe("強い")
    const nm = c.emphasis.find((e) => e.kind === "number")!
    expect(c.text.slice(nm.start, nm.end)).toBe("3倍")
    // コードポイント: 💪0 強1 い2 筋3 肉4 と5 3(6) → 1000+600
    expect(t.bigNumbers).toEqual([{ atMs: 1600, text: "3倍" }])
    expect(t.zoomAtMs).toEqual([1100])
  })

  it("snaps chars in a cut region to the nearest kept time", () => {
    const { ss, al, sc } = one("あいうえお。")
    // 「う」(1200)と「え」(1300)が切った区間。残るのは 1000-1150 と 1350-2000
    const segs: Segment[] = [
      { srcStartMs: 1000, srcEndMs: 1150 },
      { srcStartMs: 1350, srcEndMs: 2000 },
    ]
    const t = buildTimeline(ss, al, segs, sc)
    expect(t.cues[0].startMs).toBe(0)
    // 1200 は 1150 に近い → 150、1300 は 1350 に近い → 150
    const sc2: SswcScene[] = [{ role: "根拠", lines: ["あい**うえ**お。"] }]
    const ss2 = sentencesOf(sc2)
    const t2 = buildTimeline(ss2, { sentences: [sent(0, ss2[0].text, 1000)], missing: [], heard: [] }, segs, sc2)
    expect(t2.zoomAtMs).toEqual([150])
    expect(t2.cues[0].endMs).toBeGreaterThanOrEqual(t2.cues[0].startMs)
  })
})
