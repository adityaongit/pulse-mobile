import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadProgram, skiaOutsideCanvas, textOutsideText } from "./renderSafety";

const root = path.resolve(__dirname, "..");
const show = (fs: { file: string; line: number; message: string }[]) => fs.map((f) => `${f.file}:${f.line} ${f.message}`);

describe("render safety (renderSafety.ts)", () => {
  let loaded: ReturnType<typeof loadProgram>;
  beforeAll(() => {
    loaded = loadProgram(root);
  });

  it("draws every Skia element inside a canvas", () => {
    expect(show(skiaOutsideCanvas(loaded))).toEqual([]);
  });

  it("renders no number or string outside <Text> through `&&`", () => {
    expect(show(textOutsideText(loaded))).toEqual([]);
  });

  it("catches both faults in a fixture that has them", () => {
    const bad = loadProgram(path.join(__dirname, "__fixtures__/render-safety"));
    expect(show(skiaOutsideCanvas(bad))).toEqual(["src/Plot.tsx:13 <Group> is a Skia element returned by Plot, which also returns React Native elements"]);
    expect(show(textOutsideText(bad))).toHaveLength(1);
    expect(textOutsideText(bad)[0]).toMatchObject({ file: "src/Plot.tsx", line: 15 });
  });
});
