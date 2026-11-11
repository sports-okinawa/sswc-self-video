// 本編: 切った後の動画にズーム・冒頭タイトル・字幕・数字の大写し・出典・進み具合・場面の切り替えの払いを重ね、
// 最後に締め 5 秒(動画は止めて紺の背景)を付ける。主役は話す人の顔なので、飾りは短く・顔にかからない位置に置く
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, useCurrentFrame } from "remotion"
import { BigNumber, BigNumberHits } from "./BigNumber"
import { Captions } from "./Captions"
import { CitationBar } from "./CitationBar"
import { EndCard } from "./EndCard"
import { useFonts } from "./fonts"
import { HookTitle } from "./HookTitle"
import { zoomScaleAt } from "./motion.ts"
import { ProgressBar } from "./ProgressBar"
import { durationInFrames, END_CARD_FRAMES, mainFrames, mediaSrc, msToFrame, WIDTH, type SswcVideoProps } from "./props.ts"
import { NAVY, SKY } from "./theme"

export const BGM_VOLUME = 0.1
export const BGM_END_VOLUME = 0.35
const SWIPE_FRAMES = 8

// 寄るときの中心(顔はふつう画面の上寄りにある)
const ZOOM_ORIGIN = "50% 38%"

const VideoLayer = ({ props, main }: { props: SswcVideoProps; main: number }) => {
  const frame = useCurrentFrame()
  const zoomFrames = props.timeline.zoomAtMs.map(msToFrame)
  const scale = zoomScaleAt(frame, zoomFrames)
  return (
    <Sequence from={0} durationInFrames={main}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: ZOOM_ORIGIN }}>
        <OffthreadVideo src={mediaSrc(props.video)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    </Sequence>
  )
}

// 場面が変わる所(最初の場面以外)で、斜めの帯が 8 コマで横切る
const SceneSwipe = ({ startFrames }: { startFrames: number[] }) => {
  const frame = useCurrentFrame()
  const start = startFrames.find((s) => frame >= s && frame < s + SWIPE_FRAMES)
  if (start === undefined) return null
  const t = (frame - start) / SWIPE_FRAMES
  const x = interpolate(t, [0, 1], [-WIDTH * 1.4, WIDTH * 1.4])
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: -400,
          bottom: -400,
          left: x,
          width: 260,
          background: `linear-gradient(90deg, ${SKY}00, ${SKY}cc 30%, ${NAVY}dd 60%, ${NAVY}00)`,
          transform: "rotate(14deg)",
        }}
      />
    </AbsoluteFill>
  )
}

export const SswcSelfVideo = (props: SswcVideoProps) => {
  const { body, display } = useFonts()
  const total = durationInFrames(props)
  const main = mainFrames(props)
  const sceneStarts = props.timeline.scenes.slice(1).map((s) => msToFrame(s.startMs))
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <VideoLayer props={props} main={main} />
      <Sequence from={0} durationInFrames={main} layout="none">
        <SceneSwipe startFrames={sceneStarts} />
        <BigNumber list={props.timeline.bigNumbers} fontFamily={display} />
        <Captions cues={props.timeline.cues} fontFamily={display} />
        <CitationBar citation={props.citation} scenes={props.timeline.scenes} mainFrames={main} fontFamily={body} />
        <HookTitle title={props.title} fontFamily={display} whoosh={props.sfx.whoosh} />
        <ProgressBar totalFrames={main} />
        <BigNumberHits list={props.timeline.bigNumbers} hit={props.sfx.hit} />
        {props.sfx.whoosh !== null &&
          sceneStarts.map((s, i) => (
            <Sequence key={i} from={s} durationInFrames={30} layout="none">
              <Audio src={mediaSrc(props.sfx.whoosh as string)} volume={0.3} />
            </Sequence>
          ))}
      </Sequence>
      <Sequence from={main} durationInFrames={END_CARD_FRAMES}>
        <EndCard lines={props.endCard} fontFamily={display} />
      </Sequence>
      {props.bgm !== null && (
        <Audio
          src={mediaSrc(props.bgm)}
          loop
          // 全体に 0.10 で敷き、締めで 0.35 に上げ、最後の 0.5 秒で消す
          volume={(f) =>
            f < main
              ? BGM_VOLUME
              : interpolate(f, [main, main + 10, total - 15, total], [BGM_VOLUME, BGM_END_VOLUME, BGM_END_VOLUME, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
          }
        />
      )}
    </AbsoluteFill>
  )
}
