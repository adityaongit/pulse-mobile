// Ported from pulse src/app/(app)/health/format.ts. The tone strings are the web's class names, which are also NativeWind classes.
import { formatValue } from "@/lib/format";

/**
 * 78 → "78th". The web asks Intl.PluralRules; Hermes' Intl is a newer, thinner implementation, so the English rule
 * is written out (the same answers: 1st 2nd 3rd, 11th to 13th, then by the last digit).
 */
export const ordinal = (n: number) => {
  const r = Math.round(n);
  const last2 = Math.abs(r) % 100;
  const last = last2 % 10;
  const suffix = last2 >= 11 && last2 <= 13 ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
  return `${r}${suffix}`;
};

/** "2.3 years younger" / "1.0 years older" / "Same as your age" (spec §6), with its tone class. */
export function ageDelta(delta: number) {
  const v = formatValue("decimal1", Math.abs(delta));
  if (v === "0.0") return { text: "Same as your age", tone: "text-foreground-secondary" };
  return delta < 0 ? { text: `${v} years younger`, tone: "text-optimal-text" } : { text: `${v} years older`, tone: "text-warning-text" };
}

/** "excellent" (the core's key) → "Excellent". */
export const categoryWord = (c: string) => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();

/** VO2 max category word colour (spec §7.6). */
export function categoryTone(c: string) {
  const k = c.toLowerCase();
  return k === "excellent" || k === "superior" ? "text-optimal-text" : k === "good" ? "text-foreground" : "text-warning-text";
}
