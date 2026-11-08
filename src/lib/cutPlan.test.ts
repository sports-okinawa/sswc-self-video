import { describe, expect, it } from "vitest"
import type { ScriptAlignment } from "./align.ts"
import { foundRatio, planCuts, toCutTime, trimSilences } from "./cutPlan.ts"

const al = (spans: [number, number][], missing: number[] = [], heard: ScriptAlignment["heard"] = []): ScriptAlignment => ({
  sentences: spans.map(([startMs, endMs], index) => ({ index, startMs, endMs, charMs: [] })),
  missing,
  heard,
})

describe("planCuts", () => {
  it("keeps only the last complete take", () => {
    // 文 0 は 1000-3000 と 3500-5500 の 2 テイク。alignment は後者
    const segs = planCuts(al([[3500, 5500]], [], [{ sentenceIndices: [], startMs: 1000, endMs: 3000, text: "あ", charMs: [1000] }]), 20000)
    expect(segs).toEqual([{ srcStartMs: 3380, srcEndMs: 5680 }])
    expect(segs.some((s) => s.srcStartMs < 3000)).toBe(false)
  })

  it("pads and compresses gaps", () => {
    expect(planCuts(al([[1000, 3000], [3300, 5000]]), 20000)).toEqual([{ srcStartMs: 880, srcEndMs: 5180 }])
    // 文 1 が 6000-8000 のとき
    const segs = planCuts(al([[1000, 3000], [6000, 8000]]), 20000)
    expect(segs).toEqual([{ srcStartMs: 880, srcEndMs: 3180 }, { srcStartMs: 5880, srcEndMs: 8180 }])
    expect(toCutTime(6000, segs)).toBe(3180 - 880 + (6000 - 5880))
    expect(toCutTime(4000, segs)).toBeNull()
  })

  it("maps cut regions to null and the last end to total duration", () => {
    const segs = planCuts(al([[1000, 3000], [6000, 8000]]), 20000)
    expect(toCutTime(4000, segs)).toBeNull()
    expect(toCutTime(8180, segs)).toBe(2300 + 2300)
  })

  const hs = (...r: [number, number][]): ScriptAlignment["heard"] => r.map(([startMs, endMs]) => ({ sentenceIndices: [], startMs, endMs, text: "あ", charMs: [startMs] }))

  it("does not merge across a failed take", () => {
    const segs = planCuts(al([[1000, 3000], [3900, 5500]], [], hs([3250, 3700])), 20000)
    expect(segs).toHaveLength(2)
    expect(segs.some((s) => s.srcStartMs < 3700 && s.srcEndMs > 3250)).toBe(false)
  })

  it("clips the lead pad after a failed take that ends just before", () => {
    const segs = planCuts(al([[2050, 4000]], [], hs([1000, 2000])), 20000)
    expect(segs[0].srcStartMs).toBeGreaterThanOrEqual(2000)
    expect(segs[0].srcStartMs).toBeLessThanOrEqual(2050)
  })

  it("keeps only the final of three takes", () => {
    const segs = planCuts(al([[3600, 5600]], [], hs([1000, 2000], [2300, 3300])), 20000)
    expect(segs).toEqual([{ srcStartMs: 3480, srcEndMs: 5780 }])
  })

  it("clamps to the video range", () => {
    expect(planCuts(al([[50, 1000]]), 1100)).toEqual([{ srcStartMs: 0, srcEndMs: 1100 }])
  })

  it("sorts out-of-order sentences and merges overlaps", () => {
    const segs = planCuts(al([[6000, 8000], [1000, 3000]]), 20000)
    expect(segs.map((s) => s.srcStartMs)).toEqual([880, 5880])
  })

  it("returns no segments when nothing is found", () => {
    expect(planCuts(al([], [0, 1]), 5000)).toEqual([])
  })
})

describe("foundRatio", () => {
  it("missing 2/10 -> 0.8", () => {
    expect(foundRatio(al([], [1, 2]), 10)).toBeCloseTo(0.8)
  })
  it("0 sentences -> 0", () => {
    expect(foundRatio(al([]), 0)).toBe(0)
  })
})

describe("trimSilences", () => {
  it("splits a segment at a 2 s pause and keeps ~300 ms of silence", () => {
    const segs = trimSilences([{ srcStartMs: 1000, srcEndMs: 10000 }], [{ startMs: 4000, endMs: 6000 }])
    expect(segs).toEqual([
      { srcStartMs: 1000, srcEndMs: 4150 },
      { srcStartMs: 5850, srcEndMs: 10000 },
    ])
    const keptSilence = 4150 - 4000 + (6000 - 5850)
    expect(keptSilence).toBe(300)
  })

  it("leaves silences of 0.6 s or less untouched", () => {
    const segs = [{ srcStartMs: 1000, srcEndMs: 10000 }]
    expect(trimSilences(segs, [{ startMs: 4000, endMs: 4500 }, { startMs: 5000, endMs: 5600 }])).toEqual(segs)
  })

  it("trims a silence at the segment start to keepMs", () => {
    // 区間の頭 1000-2000 が無音 → 音の前 150ms だけ残す
    expect(trimSilences([{ srcStartMs: 1000, srcEndMs: 5000 }], [{ startMs: 500, endMs: 2000 }])).toEqual([
      { srcStartMs: 1850, srcEndMs: 5000 },
    ])
  })

  it("trims a silence at the segment end and drops pieces shorter than 100 ms", () => {
    expect(
      trimSilences(
        [
          { srcStartMs: 1000, srcEndMs: 5000 },
          { srcStartMs: 6000, srcEndMs: 7000 },
          // 無音の中身を除くと 7750-7800 の 50ms しか残らない → 捨てる
          { srcStartMs: 7700, srcEndMs: 7800 },
        ],
        [
          { startMs: 4000, endMs: 5500 },
          { startMs: 6060, endMs: 7900 },
        ],
      ),
    ).toEqual([
      { srcStartMs: 1000, srcEndMs: 4150 },
      { srcStartMs: 6000, srcEndMs: 6210 },
    ])
  })
})
