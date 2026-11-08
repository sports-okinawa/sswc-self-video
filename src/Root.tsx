// 本編(SswcSelfVideo)と表紙(SswcCover)の登録。見本の props は src/video/fixtures/sample.json(仮の動画は public/sample.mp4、リポジトリには入れない)
import { Composition, Still } from "remotion"
import { Cover } from "./video/Cover"
import sampleJson from "./video/fixtures/sample.json"
import { durationInFrames, FPS, HEIGHT, WIDTH, type SswcVideoProps } from "./video/props.ts"
import { SswcSelfVideo } from "./video/SswcSelfVideo"

const sample = sampleJson as SswcVideoProps

export const Root = () => (
  <>
    <Composition
      id="SswcSelfVideo"
      component={SswcSelfVideo}
      durationInFrames={durationInFrames(sample)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={sample}
      calculateMetadata={({ props }) => ({ durationInFrames: durationInFrames(props) })}
    />
    <Still id="SswcCover" component={Cover} width={WIDTH} height={HEIGHT} defaultProps={sample} />
  </>
)
