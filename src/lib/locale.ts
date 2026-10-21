// The one locale every Intl formatter uses (src/lib/format.ts, src/queries/_lib.ts). It follows the app language plus the
// phone's region when the two agree (`de-AT`, `pt-BR`), set by src/state/app.ts on boot and on a language switch.
let locale = "en-US";
const listeners = new Set<() => void>();

export const getLocale = () => locale;

export function setLocale(tag: string): void {
  if (tag === locale) return;
  locale = tag;
  listeners.forEach((f) => f());
}

/** Formatters that cache an Intl instance call this to drop it when the locale changes. */
export const onLocaleChange = (f: () => void) => void listeners.add(f);
