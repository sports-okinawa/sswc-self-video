import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GENERIC_REASON, cutFilter, edit, snapSegments } from "./edit.mjs"

describe("snapSegments", () => {
  it("rounds to 30fps frame boundaries and merges overlaps", () => {
    const f = snapSegments([
      { srcStartMs: 110, srcEndMs: 1020 },
      { srcStartMs: 1030, srcEndMs: 2000 },
      { srcStartMs: 3000, srcEndMs: 3010 },
    ])
    expect(f).toEqual([
      { startFrame: 3, endFrame: 60, srcStartMs: 100, srcEndMs: 2000 },
    ])
  })
})

describe("cutFilter", () => {
  it("trims by frame/sample and fades audio only at joins", () => {
    const s = cutFilter([
      { startFrame: 0, endFrame: 30 },
      { startFrame: 60, endFrame: 120 },
    ])
    expect(s).toContain("[0:v]trim=start_frame=0:end_frame=30,setpts=PTS-STARTPTS[v0]")
    expect(s).toContain("atrim=start_sample=96000:end_sample=192000")
    const [a0, a1] = s.split(";").filter((p) => p.startsWith("[0:a]"))
    expect(a0).not.toContain("t=in")
    expect(a0).toContain("afade=t=out:st=0.9333:d=0.0667")
    expect(a1).toContain("afade=t=in:st=0:d=0.0667")
    expect(a1).not.toContain("t=out")
    expect(s.endsWith("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]")).toBe(true)
  })
})

describe("edit", () => {
  let tmp
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edit-test-"))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmp, { recursive: true, force: true })
  })
  const job = { title: "題", scenes: [{ role: "つかみ", lines: ["こんにちは。"] }], citation: "", endCard: [] }

  it("stops before normalizing when the source is landscape", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const normalizeVideo = vi.fn()
    const r = await edit({
      job,
      videoPath: "x",
      workDir: tmp,
      deps: {
        probeSource: async () => ({ srcWidth: 1920, srcHeight: 1080, srcRotation: 0, srcDurationMs: 90000, hasAudio: true }),
        normalizeVideo,
      },
    })
    expect(r.status).toBe("failed")
    expect(r.reasons).toEqual(["横向きで撮影されています。縦向きで撮り直してください"])
    expect(normalizeVideo).not.toHaveBeenCalled()
  })

  it("maps unexpected errors to the fixed reason and keeps details out of the log", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {})
    const r = await edit({
      job,
      videoPath: "x",
      workDir: tmp,
      deps: {
        probeSource: async () => {
          throw new Error("ffprobe C:\\secret\\path.mp4")
        },
      },
    })
    expect(r).toMatchObject({ status: "failed", reasons: [GENERIC_REASON] })
    expect(logs.mock.calls.flat().join("\n")).not.toContain("secret")
    expect(fs.readFileSync(path.join(tmp, "debug.log"), "utf8")).toContain("ffprobe")
  })
})
