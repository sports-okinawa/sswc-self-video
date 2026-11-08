// 写し元: athcon-video-self-edit/src/self/emphasis.ts (485d27f)
import { MAX_CHARS } from "./captionSplit.ts";

// keyword は字幕の動き(captionStyles.ts)で Gemini が選んだ言葉。大きさは変えず、色だけ変える
export type Emphasis = { start: number; end: number; kind: "quote" | "number" | "keyword" };

const QUOTE = /「([^」]*)」/g;
/** 強調する数字(単位つき)。差し込みの裏付け確認(inserts.ts)も同じ定義を使う */
export const NUMBER_PATTERN = /\d+(?:\.\d+)?(?:%|％|本|年|人|種類|倍|回|秒|分|kg|cm)/g;
const NUMBER = NUMBER_PATTERN;

/** 強調する範囲を返す。start は含む・end は含まない(text.slice(start, end) で取り出せる)。位置順。 */
export function findEmphasis(text: string): Emphasis[] {
  const result: Emphasis[] = [];

  for (const m of text.matchAll(QUOTE)) {
    // 字幕1行(MAX_CHARS 文字)より長い引用は、キーフレーズではなく引用した発言なので強調しない
    if (m[1].length === 0 || [...m[1]].length > MAX_CHARS) continue;
    const start = m.index + 1;
    result.push({ start, end: start + m[1].length, kind: "quote" });
  }
  const quotes = result.slice();

  for (const m of text.matchAll(NUMBER)) {
    const start = m.index;
    const end = start + m[0].length;
    if (text.startsWith("つ目", end)) continue;
    // かっこ(中身)と重なる数字は quote を優先して捨てる
    if (quotes.some((q) => start < q.end && end > q.start)) continue;
    result.push({ start, end, kind: "number" });
  }

  return result.sort((a, b) => a.start - b.start);
}
