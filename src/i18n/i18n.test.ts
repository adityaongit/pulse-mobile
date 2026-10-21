// The translation checks (docs/i18n-plan.md "The checks"): every language has every key of English, with the same
// placeholders and tags, the plural forms its grammar needs, no empty or untranslated text, and the glossary kept.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGES, NAMESPACES, matchLanguage } from "./config";

const ROOT = join(__dirname, "locales");
const GLOSSARY = [
  "Pulse Age", "Pulse", "Health Connect", "Fitbit", "Google Health", "Recovery", "Strain Target", "Strain", "Sleep Performance",
  "Sleep Debt", "Sleep Need", "Sleep Consistency", "Training Load", "Stress Monitor", "Health Monitor", "Energy Bank",
  "Healthspan", "Pace of Aging", "Coach", "HRV", "RHR", "VO2 max", "SpO2",
];
const UNITS = /^(bpm|ms|rpm|km|mi|kcal|min|h|kg|lb)*$/;
const PLURAL = /_(zero|one|two|few|many|other)$/;

type Flat = Map<string, string>;
function flatten(o: unknown, prefix = "", out: Flat = new Map()): Flat {
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else flatten(v, key, out);
  }
  return out;
}
const load = (lng: string, ns: string): Flat | null => {
  const p = join(ROOT, lng, `${ns}.json`);
  return existsSync(p) ? flatten(JSON.parse(readFileSync(p, "utf8"))) : null;
};
/** "x_one", "x_other" → "x"; other keys as they are. */
const base = (k: string) => k.replace(PLURAL, "");
const tokens = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}|<\/?\w+\s*\/?>/g)].map((m) => m[0].replace(/\s/g, "")).sort();
const stripGlossary = (s: string) => GLOSSARY.reduce((r, g) => r.split(g).join(""), s).replace(/[^\p{L}]/gu, "");
const others = LANGUAGES.map((l) => l.code as string).filter((c) => c !== "en");

describe("English", () => {
  it("has a file for every namespace and none without one", () => {
    for (const ns of NAMESPACES) expect(load("en", ns), ns).not.toBeNull();
    expect(readdirSync(join(ROOT, "en")).map((f) => f.replace(".json", "")).sort()).toEqual([...NAMESPACES].sort());
  });
});

describe.each(others)("%s", (lng) => {
  it("has no file outside the namespaces", () => {
    const dir = join(ROOT, lng);
    const files = existsSync(dir) ? readdirSync(dir).map((f) => f.replace(".json", "")) : [];
    expect(files.filter((f) => !(NAMESPACES as readonly string[]).includes(f))).toEqual([]);
  });
  for (const ns of NAMESPACES) {
    const en = load("en", ns)!;
    const tr = load(lng, ns);
    // A language with no file yet reads English at run time (fallbackLng); a started language must be complete.
    if (!tr) continue;
    const enValue = (key: string) => en.get(key) ?? [...en].find(([e]) => base(e) === base(key))?.[1] ?? "";

    it(`${ns}: same keys as English`, () => {
      expect([...new Set([...tr.keys()].map(base))].sort()).toEqual([...new Set([...en.keys()].map(base))].sort());
    });
    it(`${ns}: same placeholders and tags`, () => {
      for (const [key, v] of tr) expect(tokens(v).filter((t) => t !== "{{count}}"), key).toEqual(tokens(enValue(key)).filter((t) => t !== "{{count}}"));
    });
    it(`${ns}: plural forms match the language`, () => {
      const want = new Intl.PluralRules(lng).resolvedOptions().pluralCategories.sort();
      for (const k of new Set([...en.keys()].filter((e) => PLURAL.test(e)).map(base))) {
        const have = [...tr.keys()].filter((t) => base(t) === k).map((t) => t.match(PLURAL)![1]).sort();
        expect(have, k).toEqual(want);
      }
    });
    it(`${ns}: nothing empty, English left over or glossary dropped`, () => {
      for (const [key, v] of tr) {
        expect(v.trim(), key).not.toBe("");
        if (v === enValue(key)) expect(stripGlossary(v), `${key} is still English`).toMatch(UNITS);
        for (const g of GLOSSARY) if (enValue(key).includes(g)) expect(v, `${key} lost "${g}"`).toContain(g);
      }
    });
  }
});

describe("matchLanguage", () => {
  it.each([
    [["de-AT", "en-US"], "de"],
    [["pt-PT"], "pt-BR"],
    [["pt-BR"], "pt-BR"],
    [["it-IT", "pl-PL"], "pl"],
    [["ja-JP"], "en"],
    [[], "en"],
  ])("%j → %s", (tags, want) => expect(matchLanguage(tags)).toBe(want));
});
