// 写し元: athcon-video-self-edit/scripts/self/normalize.test.mjs (485d27f)
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { HDR_WARNING, isHdr, normalizeVideo, videoFilter } from "./normalize.mjs"

const ffmpeg = (...args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { maxBuffer: 1 << 26 })
const probe = (file, entries, stream) =>
  execFileSync("ffprobe", [
    "-v", "error", ...(stream ? ["-select_streams", stream] : []),
    "-show_entries", entries, "-of", "csv=p=0:s=,", file,
  ]).toString().trim()

// ビープ音の開始位置(無音が終わる位置)を秒で返す
function beepStarts(file) {
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=noise=-30dB:d=0.3", "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 1 << 26 })
  return [...r.stderr.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => Number(m[1]))
}

describe("normalizeVideo", () => {
  let dir
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-test-"))
  })
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("normalizes rotated 60fps", async () => {
    const src = path.join(dir, "rot.mp4")
    const out = path.join(dir, "rot-out.mp4")
    // 1920×1080・60fps の映像に回転情報 90° を付け、無音を足した 5 秒の動画
    const plain = path.join(dir, "plain.mp4")
    ffmpeg(
      "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=60:duration=5",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=44100",
      "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", plain,
    )
    // 回転情報(display matrix)は入力オプションなので、できた動画を付け替えて作る
    ffmpeg("-display_rotation", "90", "-i", plain, "-c", "copy", src)
    const { durationMs } = await normalizeVideo(src, out)
    expect(probe(out, "stream=width,height,r_frame_rate", "v:0")).toBe("1080,1920,30/1")
    expect(probe(out, "stream=sample_rate,channels", "a:0")).toBe("48000,2")
    expect(Math.abs(durationMs - 5000)).toBeLessThanOrEqual(100)
    // 回転が反映されていれば画面いっぱいに映り、白い余白(横のまま縮めたときの余白)は出ない
    const top = execFileSync("ffmpeg", [
      "-v", "error", "-i", out, "-vf", "crop=100:20:490:300,format=gray", "-frames:v", "1", "-f", "rawvideo", "-",
    ])
    expect(Math.min(...top)).toBeLessThan(250)
    expect(top.reduce((a, b) => a + b, 0) / top.length).toBeLessThan(240)
  }, 60_000)

  it("adds silence when there is no audio", async () => {
    const src = path.join(dir, "noaudio.mp4")
    const out = path.join(dir, "noaudio-out.mp4")
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=640x360:rate=24:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", src)
    const { durationMs } = await normalizeVideo(src, out)
    expect(probe(out, "stream=codec_type", "a")).toBe("audio")
    expect(Math.abs(durationMs - 2000)).toBeLessThanOrEqual(100)
  }, 60_000)

  it("keeps audio sync", async () => {
    const src = path.join(dir, "vfr.mp4")
    const out = path.join(dir, "vfr-out.mp4")
    // 1 秒ごとに 0.2 秒のビープ音(1〜5 秒目の頭)。映像は途中のコマを間引いた可変フレームレート
    ffmpeg(
      "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=6",
      "-f", "lavfi", "-i", "aevalsrc='sin(2*PI*880*t)*lt(mod(t,1),0.2)':s=48000:d=6",
      "-vf", "select='lt(mod(n,7),3)+lt(n,30)'",
      "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src,
    )
    // 最後の silence_end は音声の終わり(長さが映像にそろう分だけ動く)なので、ビープの 5 つだけを比べる
    const before = beepStarts(src).slice(0, 5)
    await normalizeVideo(src, out)
    const after = beepStarts(out).slice(0, 5)
    expect(before.length).toBe(5)
    expect(after.length).toBe(before.length)
    before.forEach((t, i) => expect(Math.abs(after[i] - t)).toBeLessThanOrEqual(0.04))
  }, 60_000)

  it("tone-maps HDR (HLG) input to SDR bt709", async () => {
    const src = path.join(dir, "hlg.mp4")
    const out = path.join(dir, "hlg-out.mp4")
    // iPhone の HDR(HLG・BT.2020・10bit)と同じ色の情報を付けた動画
    ffmpeg(
      "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=1",
      "-vf", "setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc",
      "-c:v", "libx264", "-pix_fmt", "yuv420p10le", src,
    )
    expect(probe(src, "stream=color_transfer,color_primaries", "v:0")).toBe("arib-std-b67,bt2020")
    const { warnings } = await normalizeVideo(src, out)
    expect(warnings).toEqual([])
    expect(probe(out, "stream=color_primaries,color_transfer,color_space,pix_fmt", "v:0")).toBe("yuv420p,bt709,bt709,bt709")
  }, 60_000)

  it("converts HDR without tone-mapping and warns when zscale is missing", async () => {
    const src = path.join(dir, "hlg.mp4")
    const out = path.join(dir, "hlg-nozscale-out.mp4")
    const { warnings } = await normalizeVideo(src, out, { hasZscale: async () => false })
    expect(warnings).toEqual([{ sceneIndex: -1, reason: HDR_WARNING }])
    expect(probe(out, "stream=width,height,pix_fmt", "v:0")).toBe("1080,1920,yuv420p")
  }, 60_000)

  it("does not warn for SDR input", async () => {
    const src = path.join(dir, "sdr.mp4")
    const out = path.join(dir, "sdr-out.mp4")
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", src)
    const { warnings } = await normalizeVideo(src, out, { hasZscale: async () => false })
    expect(warnings).toEqual([])
  }, 60_000)
})

describe("isHdr", () => {
  it("detects HLG, PQ and BT.2020 primaries", () => {
    expect(isHdr({ transfer: "arib-std-b67", primaries: "bt2020" })).toBe(true)
    expect(isHdr({ transfer: "smpte2084", primaries: "bt2020" })).toBe(true)
    expect(isHdr({ transfer: "bt2020-10", primaries: "bt2020" })).toBe(true)
    expect(isHdr({ transfer: "bt709", primaries: "bt709" })).toBe(false)
    expect(isHdr({ transfer: "", primaries: "" })).toBe(false)
  })
})

describe("videoFilter", () => {
  it("adds tone-mapping before fitting when zscale is available", () => {
    const { filter, warning } = videoFilter({ hdr: true, transfer: "arib-std-b67", zscale: true })
    expect(filter).toMatch(/zscale=.*tin=arib-std-b67.*tonemap=.*zscale=.*t=bt709/)
    expect(filter.indexOf("tonemap")).toBeLessThan(filter.indexOf("scale=1080:1920"))
    expect(warning).toBeNull()
  })

  it("falls back to colorspace conversion with a warning", () => {
    const { filter, warning } = videoFilter({ hdr: true, transfer: "arib-std-b67", zscale: false })
    expect(filter).toMatch(/colorspace=all=bt709/)
    expect(filter).not.toMatch(/tonemap/)
    expect(warning).toBe(HDR_WARNING)
  })

  it("leaves SDR as is", () => {
    const { filter, warning } = videoFilter({ hdr: false, transfer: "bt709", zscale: true })
    expect(filter).not.toMatch(/tonemap|colorspace/)
    expect(warning).toBeNull()
  })
})
