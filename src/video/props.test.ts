import { describe, expect, it } from "vitest"
import { durationInFrames, END_CARD_FRAMES, END_CARD_LINES, msToFrame, type SswcVideoProps } from "./props.ts"

const withDuration = (durationMs: number): SswcVideoProps => ({
  video: "sample.mp4",
  timeline: { cues: [], bigNumbers: [], scenes: [], zoomAtMs: [], durationMs },
  title: "t",
  citation: "c",
  endCard: END_CARD_LINES,
  bgm: null,
  sfx: { hit: null, whoosh: null },
})

describe("props", () => {
  it("adds the 5 s end card to the duration", () => {
    expect(durationInFrames(withDuration(90000))).toBe(2850)
    expect(durationInFrames(withDuration(90010))).toBe(2851)
    expect(END_CARD_FRAMES).toBe(150)
  })

  it("converts ms to frames", () => {
    expect(msToFrame(1000)).toBe(30)
    expect(msToFrame(1010)).toBe(30)
  })

  it("has the fixed end card lines", () => {
    expect(END_CARD_LINES).toEqual(["パワーラボ浦添 / 糸満パーク", "初めての方は30日間無料", "プロフィールのリンクから"])
  })
})
