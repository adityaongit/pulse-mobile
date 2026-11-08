import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DARK, LIGHT } from "../src/ui/palette";
const require = createRequire(import.meta.url);
const { addWidgetDeclarations } = require("../plugins/withWidgets.js");
const { widgetStrings } = require("../plugins/widgetResources.js");

describe("widget native configuration", () => {
  it("is idempotent and preserves other manifest components", () => {
    const activity = { $: { "android:name": ".MainActivity" } };
    const receiver = { $: { "android:name": "existing.Receiver" } };
    const manifest = { manifest: { application: [{ activity: [activity], receiver: [receiver] }] } };
    addWidgetDeclarations(manifest);
    const once = JSON.stringify(manifest);
    addWidgetDeclarations(manifest);
    expect(JSON.stringify(manifest)).toBe(once);
    expect(manifest.manifest.application[0].receiver[0]).toEqual(receiver);
    expect(manifest.manifest.application[0].activity[0]).toEqual(activity);
    expect(manifest.manifest.application[0].receiver).toHaveLength(4);
    expect(manifest.manifest.application[0].activity).toHaveLength(2);
    expect(manifest.manifest.application[0].activity[1].$).toMatchObject({
      "android:taskAffinity": "", "android:excludeFromRecents": "true", "android:theme": "@style/PulseWidgetConfigure",
    });
  });
  it("keeps packaged native text in sync with English translation keys", () => {
    expect(readFileSync("modules/pulse-widgets/android/src/main/res/values/strings.xml", "utf8")).toBe(widgetStrings());
  });
  it("draws the widget in the app's light and dark tokens", () => {
    const TOKENS: Record<string, keyof typeof LIGHT> = {
      bg_top: "background-top", bg: "background", card_top: "card-top", card: "card", card_edge: "glass-rim",
      fg: "foreground", secondary: "foreground-secondary", muted: "muted-foreground", track: "dial-track", warning_text: "warning-text",
      green: "recovery-green", yellow: "recovery-yellow", red: "recovery-red", strain: "strain", sleep: "sleep", optimal: "optimal", warning: "warning", blue: "recovery-blue",
    };
    // Android writes alpha first: rgba(r, g, b, a) becomes #aarrggbb.
    const android = (css: string) => {
      const m = css.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
      if (!m) return css;
      const hex = (n: number) => n.toString(16).padStart(2, "0");
      return `#${hex(Math.round(Number(m[4]) * 255))}${[m[1], m[2], m[3]].map((n) => hex(Number(n))).join("")}`;
    };
    for (const [dir, palette] of [["values", LIGHT], ["values-night", DARK]] as const) {
      const xml = readFileSync(`modules/pulse-widgets/android/src/main/res/${dir}/colors.xml`, "utf8");
      const colors = Object.fromEntries([...xml.matchAll(/<color name="pulse_widget_(\w+)">(#\w+)<\/color>/g)].map((m) => [m[1], m[2]]));
      expect(colors).toEqual(Object.fromEntries(Object.entries(TOKENS).map(([name, token]) => [name, android(palette[token])])));
    }
  });
});
