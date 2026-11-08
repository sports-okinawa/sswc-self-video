// 写し元: athcon-video-self-edit/src/self/emphasis.test.ts (485d27f)
import { describe, expect, it } from "vitest";
import { findEmphasis } from "./emphasis.ts";

const slices = (text: string) =>
  findEmphasis(text).map((e) => ({ kind: e.kind, s: text.slice(e.start, e.end) }));

describe("findEmphasis", () => {
  it("かっこの中身だけを quote にする", () => {
    expect(slices("AIの前に「データの質」と「コーチの目」を磨け")).toEqual([
      { kind: "quote", s: "データの質" },
      { kind: "quote", s: "コーチの目" },
    ]);
  });

  it("パーセントを number にする", () => {
    expect(slices("対象選手の76%はプロ。女性はわずか3%。")).toEqual([
      { kind: "number", s: "76%" },
      { kind: "number", s: "3%" },
    ]);
  });

  it("単位つきの数字を number にする", () => {
    expect(slices("58本")).toEqual([{ kind: "number", s: "58本" }]);
    expect(slices("2019年")).toEqual([{ kind: "number", s: "2019年" }]);
    expect(slices("11種類")).toEqual([{ kind: "number", s: "11種類" }]);
    expect(slices("1.5倍")).toEqual([{ kind: "number", s: "1.5倍" }]);
  });

  it("序数(1つ目)は対象外", () => {
    expect(findEmphasis("1つ目のコツ")).toEqual([]);
  });

  it("かっこの中の数字は quote 1 件だけ", () => {
    expect(slices("「76%の選手」が来た")).toEqual([{ kind: "quote", s: "76%の選手" }]);
  });

  it("位置順に並ぶ", () => {
    expect(slices("3回目の「基本」と2019年").map((x) => x.s)).toEqual(["3回", "基本", "2019年"]);
  });
});
