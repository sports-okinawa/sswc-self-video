// ci-run が最終の通知を届けられなかったとき(準備の失敗・時間切れ・取り消しなど)に、Actions の最後の手順から「失敗」を通知する
// 写し元の考え方: athcon-video-self-edit/scripts/self/ci-notify-failed.mjs (485d27f)
import { postCallback } from "./ci-run.mjs"

export const STOPPED_REASON = "動画の編集が途中で止まりました(時間切れ・取り消しなど)。もう一度「動画を編集」を押してください"

const env = process.env
const ok = await postCallback({
  appBaseUrl: env.APP_BASE_URL ?? "",
  secret: env.SSWC_VIDEO_SECRET ?? "",
  payload: { jobId: env.JOB_ID ?? "", status: "failed", reasons: [STOPPED_REASON], warnings: [] },
})
console.log(`step: notify failed ${ok ? "delivered" : "not delivered"}`)
process.exit(ok ? 0 : 1)
