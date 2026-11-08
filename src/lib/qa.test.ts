import { describe, expect, it } from "vitest"
import { runQa, type QaInput } from "./qa.ts"

const ok: QaInput = {
  srcWidth: 1080,
  srcHeight: 1920,
  srcRotation: 0,
  srcDurationMs: 120000,
  hasAudio: true,
  finalDurationMs: 90000,
  foundRatio: 0.95,
  endCardFrames: 150,
}

describe("runQa", () => {
  it("returns no reasons for a good video", () => {
    expect(runQa(ok)).toEqual([])
  })

  it("portrait check uses displayed orientation", () => {
    // 縦撮りが 90° 回転で保存された動画は縦向き
    expect(runQa({ ...ok, srcWidth: 1920, srcHeight: 1080, srcRotation: 90 })).toEqual([])
    expect(runQa({ ...ok, srcWidth: 1920, srcHeight: 1080, srcRotation: -90 })).toEqual([])
    expect(runQa({ ...ok, srcWidth: 1920, srcHeight: 1080, srcRotation: 270 })).toEqual([])
    // 回転なしの横長、縦長を 90° 回転は横向き
    expect(runQa({ ...ok, srcWidth: 1920, srcHeight: 1080, srcRotation: 0 })).toEqual([
      "横向きで撮影されています。縦向きで撮り直してください",
    ])
    expect(runQa({ ...ok, srcWidth: 1080, srcHeight: 1920, srcRotation: 90 })).toEqual([
      "横向きで撮影されています。縦向きで撮り直してください",
    ])
    expect(runQa({ ...ok, srcWidth: 1080, srcHeight: 1920, srcRotation: 180 })).toEqual([])
  })

  it("reports missing audio", () => {
    expect(runQa({ ...ok, hasAudio: false })).toEqual(["音声が入っていません。マイクを確認して撮り直してください"])
  })

  it("reports source length outside 30 s to 5 min", () => {
    const msg = "撮影した動画の長さが 30 秒〜5 分ではありません"
    expect(runQa({ ...ok, srcDurationMs: 29999 })).toEqual([msg])
    expect(runQa({ ...ok, srcDurationMs: 300001 })).toEqual([msg])
    expect(runQa({ ...ok, srcDurationMs: 30000 })).toEqual([])
    expect(runQa({ ...ok, srcDurationMs: 300000 })).toEqual([])
  })

  it("reports final length outside 60 to 120 s with the seconds", () => {
    expect(runQa({ ...ok, finalDurationMs: 45400 })).toEqual([
      "完成の長さが45秒になりました。台本を最後まで読めているか確認してください",
    ])
    expect(runQa({ ...ok, finalDurationMs: 121000 })).toEqual([
      "完成の長さが121秒になりました。台本を最後まで読めているか確認してください",
    ])
    expect(runQa({ ...ok, finalDurationMs: 60000 })).toEqual([])
    expect(runQa({ ...ok, finalDurationMs: 120000 })).toEqual([])
  })

  it("reports a low found ratio as a percent", () => {
    expect(runQa({ ...ok, foundRatio: 0.62 })).toEqual([
      "台本の文の62%しか読み取れませんでした。台本どおりに読んで撮り直してください",
    ])
    expect(runQa({ ...ok, foundRatio: 0.8 })).toEqual([])
  })

  it("reports a missing end card", () => {
    expect(runQa({ ...ok, endCardFrames: 149 })).toEqual(["締めの画面が付いていません"])
  })

  it("lists several reasons together", () => {
    expect(runQa({ ...ok, hasAudio: false, endCardFrames: 0 })).toHaveLength(2)
  })
})
