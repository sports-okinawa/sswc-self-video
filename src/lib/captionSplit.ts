// 写し元: athcon-video-self-edit/src/captionSplit.ts (485d27f)
// 字幕を、スマホで読める長さ(MAX_CHARS 文字前後)の区切りに分ける。
// scripts/captions.mjs と src/self/captions.ts の両方から使う。
// .mjs から直接 import されるので、型の消去だけで動く構文のみ使う。
export const MAX_CHARS = 16
export const BREAK_AFTER = /(?:[、。!?!?]|は|が|を|に|で|と|も|て|か|より|から|なら|けど|ので)$/

/** text の中の区切りの範囲 [start, end) を返す。空白は区切りの境目で、範囲には含めない。
 * isInside(pos) が true の位置(強調の内側など)では切らない。 */
export function splitPhraseRanges(
  text: string,
  isInside: (pos: number) => boolean = () => false
): [number, number][] {
  const ranges: [number, number][] = []
  for (const m of text.matchAll(/\S+/g)) {
    const base = m.index
    let rest = m[0]
    let offset = 0
    while (rest.length > MAX_CHARS) {
      const ok = (i: number) => !isInside(base + offset + i)
      // MAX_CHARS 以内で、助詞・句読点の直後のいちばん後ろで切る(なければ MAX_CHARS で切る)
      let cut = 0
      for (let i = MAX_CHARS; i >= 5; i--) {
        // 「見なが|ら」のような語の途中を避けるため、次の文字がひらがな以外のときだけ切る
        if (BREAK_AFTER.test(rest.slice(0, i)) && !/[ぁ-ゖー]/.test(rest[i]) && ok(i)) {
          cut = i
          break
        }
      }
      if (!cut) {
        // 切ってよい位置のうち MAX_CHARS に近い所。カタカナ・英数字の単語の途中(「メ|タ分析」)はなるべく避ける
        // (2026-11-01 「…まとめたメ」で検査に止められた)
        const midWord = (i: number) =>
          /[ァ-ヶー]/.test(rest[i - 1]) && /[ァ-ヶー]/.test(rest[i]) ||
          /[A-Za-z0-9]/.test(rest[i - 1]) && /[A-Za-z0-9]/.test(rest[i])
        for (let i = MAX_CHARS; i >= 5 && !cut; i--) if (ok(i) && !midWord(i)) cut = i
        // それでもなければ単語の途中でも切る(手前になければ後ろへ探す)
        for (let i = MAX_CHARS; i >= 1 && !cut; i--) if (ok(i)) cut = i
        for (let i = MAX_CHARS + 1; i < rest.length && !cut; i++) if (ok(i)) cut = i
        if (!cut) cut = rest.length
      }
      ranges.push([base + offset, base + offset + cut])
      rest = rest.slice(cut)
      offset += cut
    }
    if (rest) ranges.push([base + offset, base + offset + rest.length])
  }
  return ranges
}

export function splitPhrases(text: string): string[] {
  return splitPhraseRanges(text).map(([s, e]) => text.slice(s, e))
}
