// 写し元: athcon-video-self-edit/scripts/self/transcribe.test.mjs (485d27f)
import { describe, expect, it } from "vitest"

import path from "node:path"

import { whisperModelDir, wordsFromWhisperJson } from "./transcribe.mjs"

// whisper.cpp は 1 文字(3 バイト)をトークンの途中で切ることがあり、その JSON には不正な UTF-8 が混ざる
function whisperJson(tokens) {
  const parts = tokens.map(([bytes, from, to]) =>
    JSON.stringify({ text: "", offsets: { from, to } }).replace('"text":""', `"text":"${Buffer.from(bytes).toString("latin1")}"`),
  )
  return Buffer.from(`{"transcription":[{"tokens":[${parts.join(",")}]}]}`, "latin1")
}

describe("wordsFromWhisperJson", () => {
  it("joins bytes of a character split across tokens", () => {
    const sys = Buffer.from("究") // 3 バイト
    const raw = whisperJson([
      [Buffer.from("[_BEG_]"), 0, 0],
      [sys.subarray(0, 1), 100, 120],
      [sys.subarray(1), 120, 200],
      [Buffer.from("は"), 200, 300],
    ])
    expect(wordsFromWhisperJson(raw)).toEqual([
      { text: "究", startMs: 100, endMs: 200 },
      { text: "は", startMs: 200, endMs: 300 },
    ])
  })

  it("recovers after a stray invalid byte", () => {
    const raw = whisperJson([
      [Buffer.from("あ"), 0, 100],
      [Buffer.from([0xe7]), 100, 120], // 続きのない先頭バイト
      [Buffer.from("い"), 200, 300],
      [Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80]), 300, 320], // 続きバイトだけの壊れた並び
      [Buffer.from("う"), 400, 500],
    ])
    expect(wordsFromWhisperJson(raw)).toEqual([
      { text: "あ", startMs: 0, endMs: 100 },
      { text: "い", startMs: 200, endMs: 300 },
      { text: "う", startMs: 400, endMs: 500 },
    ])
  })
})

describe("whisperModelDir", () => {
  it("uses the whisper.cpp folder by default (local runs keep their downloaded model)", () => {
    expect(path.basename(whisperModelDir({}))).toBe("whisper.cpp")
  })

  it("uses WHISPER_MODEL_DIR relative to the repository root (CI caches only the model there)", () => {
    const dir = whisperModelDir({ WHISPER_MODEL_DIR: "whisper-models" })
    expect(path.basename(dir)).toBe("whisper-models")
    expect(path.dirname(dir)).toBe(path.dirname(whisperModelDir({})))
  })
})
