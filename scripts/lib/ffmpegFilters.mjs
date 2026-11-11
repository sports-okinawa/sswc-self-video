// 写し元: athcon-video-self-edit/scripts/self/ffmpegFilters.mjs (485d27f)
// 本人撮影動画を 1080×1920・30fps・48kHz ステレオにそろえる ffmpeg フィルター文字列
// (append-common-outro.mjs と本人動画の自動編集で共有する)

// 縦横比が違う動画は、はみ出さないように縮めて白い余白を足す
export const fit =
  "scale=1080:1920:force_original_aspect_ratio=decrease," +
  "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=30,format=yuv420p"

// 本人撮影の映像の仕上げ(2026-11-11 ユーザー依頼「FFmpeg で質を上げて」・athcon-video-self-edit と同じ)。
// スマホの細かいノイズを軽く減らし(hqdn3d)、輪郭を少しくっきりさせ(unsharp)、コントラストと色を少しだけ上げる(eq)
export const selfEnhance = "hqdn3d=1.5:1.2:4:3,unsharp=5:5:0.55:5:5:0,eq=contrast=1.04:saturation=1.08:gamma=0.98"

export const audio = "aresample=48000,aformat=channel_layouts=stereo"

// 本人の声を聞き取りやすくする(2026-10-23 ユーザーの依頼「声をもう少しクリアに」)。
// 低いノイズ(空調・振動)を切り、雑音を抑え、こもり(250Hz)を少し下げて声の輪郭(3.5kHz)を少し上げ、大小の差をならす。
// 音量は loudnorm を使わない(自動で細かく調整するため映像と 0.1 秒ずれた)。normalize.mjs で全体の音量を測り、
// 一定の量(voiceGain)で VOICE_TARGET_LUFS にそろえる
export const voiceClean =
  "highpass=f=80,anlmdn=s=4:p=0.002:r=0.006,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=3500:t=q:w=1.2:g=3," +
  "acompressor=threshold=-20dB:ratio=3:attack=10:release=150:makeup=2"

/** SNS 向けの音量の目安 */
export const VOICE_TARGET_LUFS = -14 // Instagram・TikTok の基準に合わせる(2026-11-11。以前は -16)

/** 測った音量(LUFS)から、目標にそろえる一定の音量調整と、割れ防止のリミッター */
export const voiceGain = (measuredLufs) => {
  const gain = Number.isFinite(measuredLufs) ? Math.max(-10, Math.min(20, VOICE_TARGET_LUFS - measuredLufs)) : 0
  return `volume=${gain.toFixed(1)}dB,alimiter=limit=0.89:level=disabled`
}
