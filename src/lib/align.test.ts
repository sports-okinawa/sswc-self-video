// 写し元: athcon-video-self-edit/src/self/align.test.ts (485d27f)
import { describe, expect, it } from "vitest"
import { alignScript, type ScriptAlignment, type Word } from "./align.ts"

// 1 文字 = 1 単語、1 文字 100ms で読み上げた単語列を手で組み立てる。
class Recording {
  words: Word[] = []
  t = 0
  say(text: string, perCharMs = 100): { startMs: number; endMs: number } {
    const startMs = this.t
    for (const ch of text) {
      this.words.push({ text: ch, startMs: this.t, endMs: this.t + perCharMs })
      this.t += perCharMs
    }
    return { startMs, endMs: this.t }
  }
  pause(ms: number): void {
    this.t += ms
  }
}

/** 聞き取った文字で字幕にする区間を [文の番号, 文字, 始まり, 終わり] で */
const heardOf = (a: ScriptAlignment) => a.heard.map((h) => [h.sentenceIndices, h.text, h.startMs, h.endMs])

/** 時刻 ms が、台本の文か聞き取った区間のどれかに入っているか(字幕が付くか) */
function captioned(a: ScriptAlignment, ms: number): boolean {
  return [...a.sentences, ...a.heard].some((x) => x.startMs <= ms && ms < x.endMs)
}

/** 台本の文と聞き取った区間が時間で重ならない */
function expectNoOverlap(a: ScriptAlignment): void {
  const spans = [...a.sentences, ...a.heard].sort((x, y) => x.startMs - y.startMs)
  for (let i = 1; i < spans.length; i++) expect(spans[i].startMs).toBeGreaterThanOrEqual(spans[i - 1].endMs)
}

/** 話した文字はすべて、台本の文か聞き取った区間に入っている */
function expectEverySpokenCharCaptioned(a: ScriptAlignment, words: Word[]): void {
  for (const w of words) if (/[\p{L}\p{N}]/u.test(w.text)) expect(captioned(a, w.startMs)).toBe(true)
}

const A = "2019年、チームは大会で優勝しました。"
const B = "その理由を3つ解説します。"

describe("alignScript: takes", () => {
  it("captions the last take with the script and the earlier take with the transcript", () => {
    const r = new Recording()
    const take1 = r.say("2019年チーム")
    r.pause(1000)
    const take2 = r.say("2019年チームは大会で優勝しました")
    r.pause(300)
    r.say("その理由を3つ解説します")
    const a = alignScript([A, B], r.words)
    expect(a.missing).toEqual([])
    expect(a.sentences[0].startMs).toBe(take2.startMs)
    expect(heardOf(a)).toEqual([[[], "2019年チーム", take1.startMs, take1.endMs]])
    expectNoOverlap(a)
    expectEverySpokenCharCaptioned(a, r.words)
  })

  it("captions a complete earlier take from the transcript too", () => {
    const r = new Recording()
    const take1 = r.say("2019年チームは大会で優勝しました")
    r.pause(1000)
    const take2 = r.say("2019年チームは大会で優勝しました")
    r.pause(300)
    r.say("その理由を3つ解説します")
    const a = alignScript([A, B], r.words)
    expect(a.sentences[0].startMs).toBe(take2.startMs)
    expect(heardOf(a)).toEqual([[[], "2019年チームは大会で優勝しました", take1.startMs, take1.endMs]])
    expectNoOverlap(a)
  })

  it("keeps last take when off-script talk contains a short next sentence", () => {
    const r = new Recording()
    const take1 = r.say("2019年チームは大会で優勝しました")
    r.pause(500)
    const offScript = r.say("はい、もう一回")
    r.pause(500)
    const take2 = r.say("2019年チームは大会で優勝しました")
    r.pause(500)
    const short = r.say("はい")
    const a = alignScript([A, "はい。"], r.words)
    expect(a.missing).toEqual([])
    expect(a.sentences[0].startMs).toBe(take2.startMs)
    expect(a.sentences[1].startMs).toBe(short.startMs)
    expect(heardOf(a)).toEqual([[[], "2019年チームは大会で優勝しましたはい、もう一回", take1.startMs, offScript.endMs]])
    expectNoOverlap(a)
    expectEverySpokenCharCaptioned(a, r.words)
  })

  it("captions off-script talk between sentences from the transcript", () => {
    const r = new Recording()
    r.say("2019年チームは大会で優勝しました")
    r.pause(300)
    const offScript = r.say("えっと、もう一回")
    r.pause(300)
    r.say("その理由を3つ解説します")
    const a = alignScript([A, B], r.words)
    expect(a.missing).toEqual([])
    expect(heardOf(a)).toEqual([[[], "えっと、もう一回", offScript.startMs, offScript.endMs]])
    expectNoOverlap(a)
  })

  it("light paraphrase passes", () => {
    const s = "このトレーニングは週に三回行うのが効果的です。"
    const r = new Recording()
    r.say("このトレーニングは週三回やるのが効果的です")
    const a = alignScript([s], r.words)
    expect(a.missing).toEqual([])
    expect(a.sentences.length).toBe(1)
    expect(a.heard).toEqual([])
  })

  it("skipped sentence is missing", () => {
    const C = "最後にまとめを見ていきましょう。"
    const r = new Recording()
    r.say("2019年チームは大会で優勝しました")
    r.pause(300)
    r.say("最後にまとめを見ていきましょう")
    const a = alignScript([A, B, C], r.words)
    expect(a.missing).toEqual([1])
    expect(a.sentences.map((s) => s.index)).toEqual([0, 2])
    expect(a.heard).toEqual([])
  })

  it("gives one time per original character", () => {
    const r = new Recording()
    r.pause(1000)
    const spoken = r.say("その理由を3つ解説します")
    const a = alignScript([B], r.words)
    const { charMs } = a.sentences[0]
    expect(charMs.length).toBe([...B].length)
    expect(charMs[0]).toBe(spoken.startMs)
    for (let i = 1; i < charMs.length; i++) {
      expect(charMs[i]).toBeGreaterThanOrEqual(charMs[i - 1])
    }
  })

  it("handles zero-duration words and punctuation tokens", () => {
    const words: Word[] = []
    let t = 500
    for (const ch of "2019年、チームは大会で優勝しました。") {
      if (ch === "、" || ch === "。") {
        words.push({ text: ch, startMs: t, endMs: t })
        continue
      }
      // 2 文字に 1 つは長さ 0 の単語
      const dur = words.length % 2 === 0 ? 0 : 150
      words.push({ text: ch, startMs: t, endMs: t + dur })
      t += dur
    }
    const a = alignScript([A], words)
    expect(a.missing).toEqual([])
    expect(a.heard).toEqual([])
    const s = a.sentences[0]
    expect(s.startMs).toBe(500)
    expect(s.endMs).toBe(t)
    expect(s.endMs).toBeGreaterThan(s.startMs)
    expect(s.charMs.length).toBe([...A].length)
    expect(s.charMs.every((ms) => Number.isFinite(ms))).toBe(true)
    for (let i = 1; i < s.charMs.length; i++) {
      expect(s.charMs[i]).toBeGreaterThanOrEqual(s.charMs[i - 1])
    }
  })

  it("matches katakana/hiragana and full-width/half-width differences", () => {
    const r = new Recording()
    r.say("2019年ちーむは大会で優勝しました")
    const a = alignScript(["２０１９年、チームは大会で優勝しました。"], r.words)
    expect(a.missing).toEqual([])
  })
})

describe("alignScript: reading differences", () => {
  it("matches kanji numerals with digits", () => {
    const r = new Recording()
    r.say("選手は二十五人で、練習は三百回でした")
    const plan = alignScript(["選手は25人で、練習は300回でした。"], r.words, { minSimilarity: 1 })
    expect(plan.missing).toEqual([])
  })

  it("matches 一つ目 with 1つ目", () => {
    const r = new Recording()
    r.say("1つ目のポイントです")
    expect(alignScript(["一つ目のポイントです。"], r.words, { minSimilarity: 1 }).missing).toEqual([])
  })

  it("matches パーセント with %", () => {
    const r = new Recording()
    r.say("記録が7.5パーセント伸びました")
    expect(alignScript(["記録が7.5%伸びました。"], r.words, { minSimilarity: 1 }).missing).toEqual([])
    const r2 = new Recording()
    r2.say("記録が七・五パーセント伸びました")
    expect(alignScript(["記録が7.5%伸びました。"], r2.words, { minSimilarity: 1 }).missing).toEqual([])
  })

  it("matches 〜 and から between numbers", () => {
    const r = new Recording()
    r.say("記録が4から7.5パーセント伸びました")
    expect(alignScript(["記録が4〜7.5%伸びました。"], r.words, { minSimilarity: 1 }).missing).toEqual([])
    const r2 = new Recording()
    r2.say("記録が四～七・五％伸びました")
    expect(alignScript(["記録が4〜7.5%伸びました。"], r2.words, { minSimilarity: 1 }).missing).toEqual([])
  })

  it("ignores ・ and spaces", () => {
    const r = new Recording()
    r.say("スクワット ジャンプを行います")
    expect(alignScript(["スクワット・ジャンプを行います。"], r.words, { minSimilarity: 1 }).missing).toEqual([])
  })

  it("keeps one time per original character after numeral conversion", () => {
    const s = "選手は二十五人でした。"
    const r = new Recording()
    const spoken = r.say("選手は25人でした")
    const plan = alignScript([s], r.words)
    const { charMs } = plan.sentences[0]
    expect(charMs.length).toBe([...s].length)
    expect(charMs[0]).toBe(spoken.startMs)
    for (let i = 1; i < charMs.length; i++) expect(charMs[i]).toBeGreaterThanOrEqual(charMs[i - 1])
  })

  it("default similarity accepts a looser paraphrase (0.6)", () => {
    // 15 文字中 5 文字違い(類似度 0.67)
    const r = new Recording()
    r.say("これは本当に大事な点なんだよね")
    expect(alignScript(["これは本当に大事なポイントです。"], r.words).missing).toEqual([])
    expect(alignScript(["これは本当に大事なポイントです。"], r.words, { minSimilarity: 0.75 }).missing).toEqual([0])
  })
})

describe("alignScript: short sentences", () => {
  it("does not chance-match a short sentence to a similar word in an NG take", () => {
    const r = new Recording()
    r.say("跳躍力が大きく伸びました")
    r.pause(200)
    const tsumari = r.say("つまり")
    r.pause(200)
    r.say("この方法はあまりよくな")
    r.pause(500)
    r.say("この方法は効果があるということです")
    const plan = alignScript(["跳躍力が大きく伸びました。", "つまり。", "この方法は効果があるということです。"], r.words)
    expect(plan.missing).toEqual([])
    expect(plan.sentences.find((s) => s.index === 1)?.startMs).toBe(tsumari.startMs)
  })

  it("needs 0.75 similarity below 8 characters and exact match up to 3", () => {
    const r = new Recording()
    r.say("あまり")
    expect(alignScript(["つまり。"], r.words).missing).toEqual([0])
    const r2 = new Recording()
    r2.say("大事なのはあれ") // 7 文字中 2 文字違い(0.71)
    expect(alignScript(["大事なのはそこ。"], r2.words).missing).toEqual([0])
    const r3 = new Recording()
    r3.say("大事なのはそれ") // 7 文字中 1 文字違い(0.86)
    expect(alignScript(["大事なのはそこ。"], r3.words).missing).toEqual([])
  })
})

describe("alignScript: speech outside the matched sentences", () => {
  const S0 = "最初にこの研究の結論をお話しします。"
  const S1 = "Chaabeneらの研究では跳躍力が伸びました。"
  const S2 = "では具体的な方法を見ていきましょう。"

  it("captions an unmatched sentence between matched neighbours from the transcript", () => {
    const r = new Recording()
    r.say("最初にこの研究の結論をお話しします")
    r.pause(200)
    const gap = r.say("チャベネさんたちの調べだとジャンプが良くなった")
    r.pause(200)
    r.say("では具体的な方法を見ていきましょう")
    const a = alignScript([S0, S1, S2], r.words)
    expect(a.missing).toEqual([1])
    expect(a.heard).toEqual([
      {
        sentenceIndices: [1],
        startMs: gap.startMs,
        endMs: gap.endMs,
        text: "チャベネさんたちの調べだとジャンプが良くなった",
        charMs: expect.any(Array),
      },
    ])
    expect(a.heard[0].charMs[0]).toBe(gap.startMs)
    expect(a.heard[0].charMs.length).toBe([...a.heard[0].text].length)
    expectNoOverlap(a)
  })

  it("splits heard speech at a long silence so no caption stays up through it", () => {
    const r = new Recording()
    r.say("最初にこの研究の結論をお話しします")
    r.pause(200)
    const first = r.say("チャベネさんたちの")
    r.pause(2000)
    const second = r.say("調べだとジャンプが良くなった")
    r.pause(200)
    r.say("では具体的な方法を見ていきましょう")
    const a = alignScript([S0, S1, S2], r.words)
    expect(heardOf(a)).toEqual([
      [[1], "チャベネさんたちの", first.startMs, first.endMs],
      [[1], "調べだとジャンプが良くなった", second.startMs, second.endMs],
    ])
    expect(captioned(a, first.endMs + 1000)).toBe(false)
  })

  it("captions speech before the first and after the last matched sentence", () => {
    const r = new Recording()
    const head = r.say("チャベネさんたちの調べ")
    r.pause(200)
    r.say("では具体的な方法を見ていきましょう")
    r.pause(200)
    const tail = r.say("おしまい")
    const a = alignScript([S1, S2, "最後にもう一度まとめましょう。"], r.words)
    expect(a.missing).toEqual([0, 2])
    expect(heardOf(a)).toEqual([
      [[0], "チャベネさんたちの調べ", head.startMs, head.endMs],
      [[2], "おしまい", tail.startMs, tail.endMs],
    ])
  })

  it("groups consecutive unmatched sentences and leaves silent gaps out", () => {
    const r = new Recording()
    r.say("最初にこの研究の結論をお話しします")
    r.pause(200)
    r.say("あれこれ違う言い方で二文ぶん話しました")
    r.pause(200)
    r.say("では具体的な方法を見ていきましょう")
    const a = alignScript([S0, S1, "跳躍力は大きく伸びたそうです。", S2, "最後にもう一度まとめましょう。"], r.words)
    expect(a.missing).toEqual([1, 2, 4])
    expect(a.heard.map((b) => b.sentenceIndices)).toEqual([[1, 2]])
  })

  it("captions an NG take of the next sentence from the transcript without tying it to the unmatched sentence", () => {
    const S3 = "最後にもう一度まとめましょう。"
    const r = new Recording()
    r.say("最初にこの研究の結論をお話しします")
    r.pause(200)
    const gap = r.say("チャベネさんたちの調べだとジャンプが良くなった")
    r.pause(200)
    const ng = r.say("では具体的な方法を見てきまっしょ")
    r.pause(500)
    const ok = r.say("では具体的な方法を見ていきましょう")
    r.pause(200)
    r.say("最後にもう一度まとめましょう")
    const a = alignScript([S0, S1, S2, S3], r.words)
    expect(a.missing).toEqual([1])
    expect(a.sentences.find((s) => s.index === 2)?.startMs).toBe(ok.startMs)
    expect(heardOf(a)).toEqual([
      [[1], "チャベネさんたちの調べだとジャンプが良くなった", gap.startMs, gap.endMs],
      [[], "では具体的な方法を見てきまっしょ", ng.startMs, ng.endMs],
    ])
    expectNoOverlap(a)
    expectEverySpokenCharCaptioned(a, r.words)
  })

  it("ties only the speech right after the last sentence to a trailing unmatched sentence; later chatter is still captioned", () => {
    const r = new Recording()
    r.say("では具体的な方法を見ていきましょう")
    r.pause(200)
    const closing = r.say("それじゃあ全体をおさらいします")
    r.pause(1500)
    const chatter = r.say("はいOK")
    const a = alignScript([S2, "最後にもう一度まとめましょう。"], r.words)
    expect(a.missing).toEqual([1])
    expect(heardOf(a)).toEqual([
      [[1], "それじゃあ全体をおさらいします", closing.startMs, closing.endMs],
      [[], "はいOK", chatter.startMs, chatter.endMs],
    ])
  })

  it("captions opening chatter from the transcript", () => {
    const r = new Recording()
    const chatter = r.say("はいじゃあいきます")
    r.pause(2000)
    const head = r.say("チャベネさんたちの調べ")
    r.pause(200)
    r.say("では具体的な方法を見ていきましょう")
    const a = alignScript([S1, S2], r.words)
    expect(heardOf(a)).toEqual([
      [[], "はいじゃあいきます", chatter.startMs, chatter.endMs],
      [[0], "チャベネさんたちの調べ", head.startMs, head.endMs],
    ])
    expectEverySpokenCharCaptioned(a, r.words)
  })

  it("captions opening chatter when every sentence matched", () => {
    const r = new Recording()
    const chatter = r.say("よしいきます")
    r.pause(800)
    r.say("では具体的な方法を見ていきましょう")
    const a = alignScript([S2], r.words)
    expect(a.missing).toEqual([])
    expect(heardOf(a)).toEqual([[[], "よしいきます", chatter.startMs, chatter.endMs]])
  })

  it("does not tie speech after a long pause to a trailing unmatched sentence", () => {
    const r = new Recording()
    r.say("では具体的な方法を見ていきましょう")
    r.pause(1500)
    const chatter = r.say("はいOK")
    const a = alignScript([S2, "最後にもう一度まとめましょう。"], r.words)
    expect(a.missing).toEqual([1])
    expect(heardOf(a)).toEqual([[[], "はいOK", chatter.startMs, chatter.endMs]])
  })

  it("ties at most twice the expected reading time plus 1 s to a trailing unmatched sentence and captions the rest", () => {
    // 「最後にもう一度まとめましょう」は比較用 14 文字 → 2 秒 → 上限 2×2+1 = 5 秒
    const r = new Recording()
    r.say("では具体的な方法を見ていきましょう")
    r.pause(200)
    const talk = r.say("あ".repeat(80))
    const a = alignScript([S2, "最後にもう一度まとめましょう。"], r.words)
    expect(a.heard).toHaveLength(2)
    const [tied, rest] = a.heard
    expect(tied.sentenceIndices).toEqual([1])
    expect(tied.startMs).toBe(talk.startMs)
    expect(tied.endMs).toBeLessThanOrEqual(talk.startMs + 5000)
    expect(tied.endMs).toBeGreaterThan(talk.startMs + 4800)
    expect(rest.sentenceIndices).toEqual([])
    expect(rest.endMs).toBe(talk.endMs)
    expect(tied.text.length + rest.text.length).toBe(80)
    expectNoOverlap(a)
  })

  it("captions everything from the transcript when nothing matched", () => {
    const r = new Recording()
    const all = r.say("まったく別の話をしています")
    const a = alignScript([S0, S1], r.words)
    expect(a.missing).toEqual([0, 1])
    expect(heardOf(a)).toEqual([[[0, 1], "まったく別の話をしています", all.startMs, all.endMs]])
  })

  it("is deterministic", () => {
    const r = new Recording()
    r.say("最初にこの研究の結論をお話しします")
    r.pause(200)
    r.say("チャベネさんたちの調べだとジャンプが良くなった")
    r.pause(200)
    r.say("では具体的な方法を見ていきましょう")
    expect(alignScript([S0, S1, S2], r.words)).toEqual(alignScript([S0, S1, S2], r.words))
  })
})
