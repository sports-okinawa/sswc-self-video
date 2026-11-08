import { describe, expect, it } from "vitest"
import type { ScriptAlignment } from "./align.ts"
import { foundRatio, planCuts, toCutTime } from "./cutPlan.ts"

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
    const t = toCutTime(6000, segs)!
    expect(Math.abs(t - ((3180 - 880) + 200 + 120))).toBeLessThanOrEqual(20)
    expect(toCutTime(4000, segs)).toBeNull()
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
