// 書体(@remotion/google-fonts・OFL)。字幕は Noto Sans JP 900、タイトル・数字・締めは極太の Dela Gothic One。
// @remotion/google-fonts の loadFont は取得に失敗すると delayRender を解除しないまま例外を投げ、書き出し全体が
// タイムアウトする(athcon-video-self-edit/src/self/captionFont.ts と同じ理由)。そのため自前の FontFace で読み込み、
// 失敗・遅延しても必ず continueRender して、予備の書体で続ける
import { getInfo as delaInfo } from "@remotion/google-fonts/DelaGothicOne"
import { getInfo as notoInfo } from "@remotion/google-fonts/NotoSansJP"
import { continueRender, delayRender } from "remotion"

const LOAD_TIMEOUT_MS = 20000
const FALLBACK = `"Hiragino Sans", "Yu Gothic", sans-serif`

type Info = { fontFamily: string; fonts: { normal: Record<string, Record<string, string>> }; unicodeRanges: Record<string, string> }

const loadSafely = (info: Info, weight: string): string => {
  const family = info.fontFamily
  const files = info.fonts.normal[weight]
  const ranges = info.unicodeRanges
  // 日本語は「[数字]」の細切れ、英数字は latin
  const keys = Object.keys(files).filter((k) => /^\[\d+\]$/.test(k) || k === "latin")
  const handle = delayRender(`Loading font ${family}`, { timeoutInMilliseconds: LOAD_TIMEOUT_MS + 15000 })
  let timer: ReturnType<typeof setTimeout> | undefined
  Promise.race([
    Promise.all(
      keys.map(async (k) => {
        const face = new FontFace(family, `url(${files[k]}) format("woff2")`, {
          weight,
          style: "normal",
          unicodeRange: ranges[k],
        })
        await face.load()
        document.fonts.add(face)
      }),
    ),
    new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error("font timeout")), LOAD_TIMEOUT_MS)
    }),
  ])
    .catch(() => console.warn("font unavailable, using fallback"))
    .finally(() => {
      if (timer) clearTimeout(timer)
      continueRender(handle)
    })
  return `"${family}", ${FALLBACK}`
}

let fonts: { body: string; display: string } | null = null

/** 書体を読み込み始め(2 回目からは何もしない)、CSS の font-family を返す */
export const useFonts = (): { body: string; display: string } => {
  if (fonts === null) {
    const body = loadSafely(notoInfo() as unknown as Info, "900")
    fonts = { body, display: `${loadSafely(delaInfo() as unknown as Info, "400")}, ${body}` }
  }
  return fonts
}
