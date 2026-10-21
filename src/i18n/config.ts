// The i18next instance (docs/i18n-plan.md). Resources are bundled statically; English is the source and the fallback,
// so a language without a file yet reads English. No I/O here: the stored choice and the phone's language are in
// language.ts, so this file loads in Node for the tests and in the headless background task.
import "intl-pluralrules";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "./locales/en/common.json";

export const NAMESPACES = ["common"] as const;

const resources = { en: { common: enCommon } } as const;

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
export type LanguageCode = (typeof LANGUAGES)[number]["code"];

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
  void i18n.use(initReactI18next).init({
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
