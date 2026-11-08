import { describe, expect, it } from "vitest"
import { activeBigNumber, countUpText, zoomScaleAt } from "./motion.ts"

describe("zoomScaleAt", () => {
  it("alternates 1.0 and 1.18, easing in over 8 frames", () => {
    const at = [30, 90]
    expect(zoomScaleAt(0, at)).toBe(1)
    expect(zoomScaleAt(30, at)).toBe(1)
    expect(zoomScaleAt(38, at)).toBeCloseTo(1.18)
    expect(zoomScaleAt(34, at)).toBeGreaterThan(1)
    expect(zoomScaleAt(34, at)).toBeLessThan(1.18)
    expect(zoomScaleAt(98, at)).toBeCloseTo(1)
  })
})

describe("countUpText", () => {
  it("counts the number up from 0 keeping the unit", () => {
    expect(countUpText("3倍", 0)).toBe("0倍")
    expect(countUpText("3倍", 1)).toBe("3倍")
    expect(countUpText("120回", 0.5)).toBe("60回")
    expect(countUpText("1.5kg", 0.5)).toBe("0.8kg")
    expect(countUpText("1.5kg", 1)).toBe("1.5kg")
    expect(countUpText("約20%", 1)).toBe("約20%")
  })
  it("leaves text without digits as is", () => {
    expect(countUpText("三倍", 0.3)).toBe("三倍")
  })
})

describe("activeBigNumber", () => {
  it("shows the latest number for 1.6 s", () => {
    const list = [{ atMs: 1000, text: "3倍" }, { atMs: 2000, text: "5回" }]
    expect(activeBigNumber(list, 29)).toBeNull()
    expect(activeBigNumber(list, 30)?.text).toBe("3倍")
    expect(activeBigNumber(list, 60)?.text).toBe("5回")
    expect(activeBigNumber(list, 60 + 48)).toBeNull()
  })
})
