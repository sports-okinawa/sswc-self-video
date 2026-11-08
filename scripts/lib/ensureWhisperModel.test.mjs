// 写し元: athcon-video-self-edit/scripts/self/ensureWhisperModel.test.mjs (485d27f)
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ensureWhisperModel, MODEL_BYTES } from "./transcribe.mjs"

// 大きさだけ見るので、本物の 470MB は書かずに truncate で大きさを作る
const writeSized = (file, bytes) => {
  fs.writeFileSync(file, "")
  fs.truncateSync(file, bytes)
}

describe("ensureWhisperModel", () => {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-"))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = () => path.join(dir, "ggml-small.bin")
  const wait = async () => {}

  it("uses a model that already has the right size without downloading", async () => {
    writeSized(file(), MODEL_BYTES.small)
    const download = vi.fn()
    expect(await ensureWhisperModel("small", dir, { download, wait })).toBe(file())
    expect(download).not.toHaveBeenCalled()
  })

  it("deletes a cut-off model and downloads it again", async () => {
    writeSized(file(), 1000)
    const download = vi.fn(async () => writeSized(file(), MODEL_BYTES.small))
    await ensureWhisperModel("small", dir, { download, wait })
    expect(download).toHaveBeenCalledTimes(1)
    expect(fs.statSync(file()).size).toBe(MODEL_BYTES.small)
  })

  it("waits for the file to finish writing after the download returns", async () => {
    let ticks = 0
    const download = vi.fn(async () => writeSized(file(), 1000))
    const slowWait = async () => {
      if (++ticks === 3) writeSized(file(), MODEL_BYTES.small)
    }
    await ensureWhisperModel("small", dir, { download, wait: slowWait })
    expect(download).toHaveBeenCalledTimes(1)
  })

  it("gives up after 3 bad downloads and removes the broken file", async () => {
    const download = vi.fn(async () => writeSized(file(), 1000))
    await expect(ensureWhisperModel("small", dir, { download, wait })).rejects.toThrow(/正しく取得できませんでした/)
    expect(download).toHaveBeenCalledTimes(3)
    expect(fs.existsSync(file())).toBe(false)
  })
})
