import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DARK, LIGHT } from "../src/ui/palette";

// The live-workout notification (modules/pulse-workouts) draws in the app's tokens: its colours.xml mirrors the palette.
describe("workout notification colours", () => {
  it("match the light and dark tokens", () => {
    const TOKENS: Record<string, keyof typeof LIGHT> = { strain: "strain", muted: "muted-foreground", sleep: "sleep", optimal: "optimal", warning: "warning", red: "recovery-red" };
    for (const [dir, palette] of [["values", LIGHT], ["values-night", DARK]] as const) {
      const xml = readFileSync(`modules/pulse-workouts/android/src/main/res/${dir}/colors.xml`, "utf8");
      const colors = Object.fromEntries([...xml.matchAll(/<color name="pulse_workout_(\w+)">(#\w+)<\/color>/g)].map((m) => [m[1], m[2]]));
      expect(colors).toEqual(Object.fromEntries(Object.entries(TOKENS).map(([name, token]) => [name, palette[token]])));
    }
  });
});
