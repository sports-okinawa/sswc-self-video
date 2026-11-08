// 写し元: athcon-video-self-edit/src/self/props.ts の titleLines だけ (485d27f)
// props.ts 全体は ATHCON 固有の型に依存するため、この関数だけを写した。
/** タイトルを行に分ける。改行があればそれで、なければ句読点(、。!?)の後ろで分ける */
export function titleLines(title: string): string[] {
  const parts = title.includes("\n") ? title.split("\n") : title.split(/(?<=[、。!?！？])/)
  return parts.map((s) => s.trim()).filter(Boolean)
}
