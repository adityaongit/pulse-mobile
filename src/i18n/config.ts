// The i18next instance (docs/i18n-plan.md). Resources are bundled statically; English is the source and the fallback,
// so a language without a file yet reads English. No I/O here: the stored choice and the phone's language are in
// language.ts, so this file loads in Node for the tests and in the headless background task.
import "intl-pluralrules";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

export const NAMESPACES = ["common", "reasons", "metrics", "home", "sleep", "recovery", "strain", "health", "journal", "trends", "nutrition", "goals", "reports", "coach", "settings", "onboarding", "more", "howItWorks", "notifications", "errors", "ui"] as const;


/** Each language by its own name. Add a code here with its folder under locales/. */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "ru", name: "Русский" },
  { code: "pl", name: "Polski" },
] as const;
/** A development-only language: English wrapped and padded by 40%, so a string that was not moved into keys stays plain and a layout that cannot take longer words overflows. */
export const PSEUDO = "en-XA";
export type LanguageCode = (typeof LANGUAGES)[number]["code"] | typeof PSEUDO;
export const showPseudo = typeof __DEV__ !== "undefined" && __DEV__;

const ACCENTED: Record<string, string> = { a: "å", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", n: "ñ", o: "ö", p: "þ", r: "ŕ", s: "š", t: "ţ", u: "û", w: "ŵ", y: "ý", z: "ž" };
/** "Sleep" → "[Šļééþ ·]": accents on the letters, 40% longer (tags and already-filled values pass through as text). */
export function pseudo(text: string): string {
  const out = text.replace(/[a-z]/gi, (c) => {
    const a = ACCENTED[c.toLowerCase()] ?? c;
    return c === c.toUpperCase() ? a.toUpperCase() : a;
  }).replace(/\s+/g, " ");
  return `[${out}${" ·".repeat(Math.ceil(text.length * 0.2))}]`;
}

/** Languages a native speaker has signed off; the others show "Beta" in the picker. A sign-off adds its code here. */
export const REVIEWED = new Set<string>(["en"]);

/** What the person picked: "auto" follows the phone. */
export type LanguageChoice = "auto" | LanguageCode;

const codes = LANGUAGES.map((l) => l.code as string);

/** The first of the phone's locales (BCP 47 tags, best first) that Pulse speaks: exact tag, then its language, else English. */
export function matchLanguage(tags: readonly string[]): LanguageCode {
  for (const tag of tags) {
    const exact = codes.find((c) => c.toLowerCase() === tag.toLowerCase());
    if (exact) return exact as LanguageCode;
    const base = tag.split("-")[0].toLowerCase();
    const byBase = codes.find((c) => c.split("-")[0].toLowerCase() === base);
    if (byBase) return byBase as LanguageCode;
  }
  return "en";
}

/** Starts i18next once, synchronously, in `language`; later calls switch the language. Safe from the background task. */
export function initI18n(language: LanguageCode = "en"): void {
  if (i18n.isInitialized) {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    return;
  }
  void i18n
    .use({ type: "postProcessor", name: "pseudo", process: (value: string) => (i18n.language === PSEUDO ? pseudo(value) : value) })
    .use(initReactI18next)
    .init({
    postProcess: ["pseudo"],
    resources,
    lng: language,
    fallbackLng: "en",
    ns: [...NAMESPACES],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
    react: { useSuspense: false },
  });
}

export { i18n };
