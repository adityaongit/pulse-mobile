// Ported from pulse src/app/(app)/health/format.ts. The tone strings are the web's class names, which are also NativeWind classes.
import { i18n } from "@/i18n/config";
import { formatValue } from "@/lib/format";

/**
 * 78 → "78th". The web asks Intl.PluralRules; Hermes' Intl is a newer, thinner implementation, so the English rule
 * is written out (the same answers: 1st 2nd 3rd, 11th to 13th, then by the last digit). The four endings are keys; a
 * language whose ordinal is one form gives all four the same text.
 */
export const ordinal = (n: number) => {
  const r = Math.round(n);
  const last2 = Math.abs(r) % 100;
  const last = last2 % 10;
  const form = last2 >= 11 && last2 <= 13 ? "other" : last === 1 ? "one" : last === 2 ? "two" : last === 3 ? "few" : "other";
  return i18n.t(`health:ordinal.${form}`, { n: r });
};

/** "2.3 years younger" / "1.0 years older" / "Same as your age" (spec §6), with its tone class. */
export function ageDelta(delta: number) {
  const v = formatValue("decimal1", Math.abs(delta));
  if (v === "0.0") return { text: i18n.t("health:age.same"), tone: "text-foreground-secondary" };
  return delta < 0 ? { text: i18n.t("health:age.younger", { years: v }), tone: "text-optimal-text" } : { text: i18n.t("health:age.older", { years: v }), tone: "text-warning-text" };
}

/** "excellent" (the core's key) → "Excellent". */
export const categoryWord = (c: string) => {
  const k = c.toLowerCase();
  return k === "poor" || k === "fair" || k === "good" || k === "excellent" || k === "superior" ? i18n.t(`health:category.${k}`) : c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
};

/** VO2 max category word colour (spec §7.6). */
export function categoryTone(c: string) {
  const k = c.toLowerCase();
  return k === "excellent" || k === "superior" ? "text-optimal-text" : k === "good" ? "text-foreground" : "text-warning-text";
}
