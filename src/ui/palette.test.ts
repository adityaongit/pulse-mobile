import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alpha, mix, parseColor, resolveCss } from "./color";
import { BLACK, DARK, LIGHT, VALUES } from "./palette";

const css = readFileSync(new URL("../../global.css", import.meta.url), "utf8");
const block = (selector: string) => {
  const open = css.indexOf(`\n${selector} {`);
  return css.slice(css.indexOf("{", open) + 1, css.indexOf("}", open));
};
const vars = (b: string) => Object.fromEntries([...b.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(([, n, v]) => [n, v.trim()]));

/**
 * global.css stores "R G B" channels or rgb(r g b / a); palette.ts stores "#rrggbb" or "rgba(r, g, b, a)". A shadow
 * keeps its syntax with each rgb() in the comma form; a number is a number.
 */
const rgba = (v: string) => v.replace(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/g, "rgba($1, $2, $3, $4)");
function asPalette(v: string) {
  if (/^\d+ \d+ \d+$/.test(v)) return `#${v.split(" ").map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  return rgba(v);
}
const asValue = (v: string) => (/^-?[\d.]+$/.test(v) ? Number(v) : rgba(v));

describe("global.css and palette.ts hold the same tokens", () => {
  for (const [name, selector, palette] of [["light", ":root", LIGHT], ["dark", ".dark:root", DARK]] as const) {
    it(`${name}: every token matches`, () => {
      const values: Record<string, unknown> = VALUES[name];
      const entries = Object.entries(vars(block(selector)));
      expect(Object.fromEntries(entries.filter(([k]) => !(k in values)).map(([k, v]) => [k, asPalette(v)]))).toEqual(palette);
      expect(Object.fromEntries(entries.filter(([k]) => k in values).map(([k, v]) => [k, asValue(v)]))).toEqual(values);
    });
  }
  it("pure black: the dark palette with .pure-black's tokens", () => {
    const ground = Object.fromEntries(Object.entries(vars(block(".pure-black"))).map(([k, v]) => [k, asPalette(v)]));
    expect(Object.keys(ground).every((k) => k in DARK)).toBe(true);
    expect(BLACK).toEqual({ ...DARK, ...ground });
  });
  it("both themes define the same names", () => {
    expect(Object.keys(LIGHT)).toEqual(Object.keys(DARK));
    expect(Object.keys(VALUES.light)).toEqual(Object.keys(VALUES.dark));
  });
});

describe("named opacity tiers equal the alpha modifiers they replace", () => {
  const TIERS = [
    ["fill-faint", "foreground", 0.06],
    ["fill-hover", "foreground", 0.08],
    ["fill-pressed", "foreground", 0.1],
    ["foreground-body", "foreground", 0.85],
    ["card-peek", "card", 0.6],
    ["focus-ring", "foreground", 0.7],
    ["overlay-ring", "foreground", 0.1],
    ["popover-ring", "foreground", 0.08],
    ["alert-ring", "recovery-red", 0.6],
    ["warning-ring", "warning", 0.5],
  ] as const;
  for (const p of [LIGHT, DARK])
    for (const [tier, base, a] of TIERS) it(`${tier} = ${base} at ${a}`, () => expect(p[tier]).toBe(alpha(p[base], a)));
  it("skeleton: muted at 60 % in light, the text colour at 6 % in dark (dark muted is the card's own colour)", () => {
    expect(LIGHT.skeleton).toBe(alpha(LIGHT.muted, 0.6));
    expect(DARK.skeleton).toBe(alpha(DARK.foreground, 0.06));
  });
  it("input-fill: the input colour at 30 % in dark, nothing in light", () => {
    expect(DARK["input-fill"]).toBe(alpha(DARK.input, 0.3));
    expect(parseColor(LIGHT["input-fill"])[3]).toBe(0);
  });
});

describe("colour helpers", () => {
  it("parses hex and rgba", () => {
    expect(parseColor("#0093e7")).toEqual([0, 147, 231, 1]);
    expect(parseColor("rgba(255, 255, 255, 0.1)")).toEqual([255, 255, 255, 0.1]);
  });
  it("alpha and mix write what color-mix writes", () => {
    expect(alpha("#ffffff", 0.07)).toBe("rgba(255, 255, 255, 0.07)");
    expect(mix("#0093e7", "#ffffff", 0.78)).toBe("#38abec");
  });
  it("resolves var() and the two inline color-mix shapes", () => {
    expect(resolveCss("var(--recovery-green)", DARK)).toBe("#16ec06");
    expect(resolveCss("color-mix(in srgb, var(--foreground) 5%, transparent)", DARK)).toBe("rgba(255, 255, 255, 0.05)");
    expect(resolveCss("color-mix(in srgb, var(--warning) 16%, var(--card))", DARK)).toBe(mix(DARK.warning, DARK.card, 0.16));
    expect(resolveCss("#abc", DARK)).toBe("#abc");
  });
  it("the stored strain bands equal the web's color-mix of strain and card", () => {
    expect(DARK["strain-band-2"]).toBe(mix(DARK.strain, DARK.card, 0.78));
    expect(LIGHT["strain-band-4"]).toBe(mix(LIGHT.strain, LIGHT.card, 0.4));
  });
  it("throws on an unknown token rather than drawing nothing", () => {
    expect(() => resolveCss("var(--nope)", DARK)).toThrow();
  });
});
