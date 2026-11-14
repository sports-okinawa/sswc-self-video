// 書き出し前後の自動確認。理由の文はスタッフが読んで分かる日本語(画面・メールにそのまま出す)。
// .mjs から直接 import されるので、型の消去だけで動く構文のみ使う。

export type QaInput = {
  /** 撮影した動画の保存上の幅・高さ(回転メタデータを当てる前) */
  srcWidth: number
  srcHeight: number
  /** 回転メタデータ(度。-90・90・180・270 など) */
  srcRotation: number
  srcDurationMs: number
  hasAudio: boolean
  finalDurationMs: number
  /** 台本の文のうち、読み取れた文の割合(0〜1) */
  foundRatio: number
  /** 書き出した締めの画面のコマ数 */
  endCardFrames: number
}

export const MIN_SRC_MS = 30_000
export const MAX_SRC_MS = 300_000
export const MIN_FINAL_MS = 35_000
export const MAX_FINAL_MS = 120_000
export const MIN_FOUND_RATIO = 0.8
export const MIN_END_CARD_FRAMES = 150

/** 表示上の縦横で横向きか(90°・270° の回転は幅と高さを入れ替えて見る) */
export const isLandscape = (width: number, height: number, rotation: number): boolean => {
  const quarter = ((Math.round(rotation / 90) % 4) + 4) % 4
  const [w, h] = quarter % 2 === 1 ? [height, width] : [width, height]
  return w > h
}

export const runQa = (input: QaInput): string[] => {
  const reasons: string[] = []
  if (isLandscape(input.srcWidth, input.srcHeight, input.srcRotation)) {
    reasons.push("横向きで撮影されています。縦向きで撮り直してください")
  }
  if (!input.hasAudio) reasons.push("音声が入っていません。マイクを確認して撮り直してください")
  if (input.srcDurationMs < MIN_SRC_MS || input.srcDurationMs > MAX_SRC_MS) {
    reasons.push("撮影した動画の長さが 30 秒〜5 分ではありません")
  }
  if (input.finalDurationMs < MIN_FINAL_MS || input.finalDurationMs > MAX_FINAL_MS) {
    const n = Math.round(input.finalDurationMs / 1000)
    reasons.push(`完成の長さが${n}秒になりました。台本を最後まで読めているか確認してください`)
  }
  if (input.foundRatio < MIN_FOUND_RATIO) {
    const p = Math.round(input.foundRatio * 100)
    reasons.push(`台本の文の${p}%しか読み取れませんでした。台本どおりに読んで撮り直してください`)
  }
  if (input.endCardFrames < MIN_END_CARD_FRAMES) reasons.push("締めの画面が付いていません")
  return reasons
}
