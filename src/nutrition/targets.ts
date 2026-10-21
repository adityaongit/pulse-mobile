// Daily nutrition targets: calories, protein, carbs and fat. Each is the person's own number when they set one
// (Nutrition › Targets, kept on the phone by src/state/nutrition.ts), else Pulse's suggestion from their own data:
//  - protein: 1.6 g per kg of their latest weight (the point past which more protein stopped adding lean mass in
//    resistance-trained adults, Morton et al. 2018, Br J Sports Med); with no weight reading, the same per kg of a
//    healthy weight for their height (BMI 22); with neither, 100 g;
//  - calories: what they burned a day, on average, over the 14 days before today (their maintenance), with at least
//    3 days of it; else the 2,000 kcal food labels use;
//  - fat: 30 % of the calories (inside the 20-35 % the dietary guidelines give);
//  - carbs: the calories left after protein and fat.
// No React or database, so the tests run in node. The "basis" sentences and errors are translated here (nutrition, errors).
import { localeFixed } from "@/lib/locale";
import { i18n } from "@/i18n/config";

export const TARGET_KEYS = ["kcal", "protein", "carbs", "fat"] as const;
export type TargetKey = (typeof TARGET_KEYS)[number];

/** The person's own targets; null follows Pulse's suggestion. */
export type CustomTargets = Record<TargetKey, number | null>;
export const NO_CUSTOM: CustomTargets = { kcal: null, protein: null, carbs: null, fat: null };

export const PROTEIN_G_PER_KG = 1.6;
export const REFERENCE_BMI = 22;
export const DEFAULT_PROTEIN_G = 100;
export const DEFAULT_KCAL = 2000;
export const FAT_SHARE = 0.3;
/** Days of calories burned the calorie suggestion averages, and how many it needs. */
export const BURN_DAYS = 14;
export const MIN_BURN_DAYS = 3;

export type TargetLimit = { min: number; max: number; unit: string };
export const TARGET_LIMITS: Record<TargetKey, TargetLimit> = {
  kcal: { min: 800, max: 8000, unit: "kcal" },
  protein: { min: 10, max: 400, unit: "g" },
  carbs: { min: 5, max: 1000, unit: "g" },
  fat: { min: 5, max: 400, unit: "g" },
};

/** One resolved target: its value, whether it is the person's own, and where it comes from in a few words. */
export type Target = { value: number; custom: boolean; basis: string };
export type Targets = Record<TargetKey, Target>;

const group = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
const kg1 = (v: number) => localeFixed(Math.round(v * 10) / 10, 1);

/** The protein suggestion: 1.6 g per kg of the latest weight, else of a healthy weight for the height, else 100 g. */
export function proteinTarget(weightKg: number | null, heightCm: number | null): Target {
  if (weightKg !== null && Number.isFinite(weightKg) && weightKg >= 20 && weightKg <= 300) {
    return { value: Math.round(weightKg * PROTEIN_G_PER_KG), custom: false, basis: i18n.t("nutrition:basis.proteinWeight", { perKg: PROTEIN_G_PER_KG, kg: kg1(weightKg) }) };
  }
  if (heightCm !== null && Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 250) {
    const kg = REFERENCE_BMI * (heightCm / 100) ** 2;
    return { value: Math.round(kg * PROTEIN_G_PER_KG), custom: false, basis: i18n.t("nutrition:basis.proteinHeight", { perKg: PROTEIN_G_PER_KG, cm: Math.round(heightCm), kg: Math.round(kg) }) };
  }
  return { value: DEFAULT_PROTEIN_G, custom: false, basis: i18n.t("nutrition:basis.proteinDefault", { perKg: PROTEIN_G_PER_KG }) };
}

/** Plausible days of total calories burned (a day the band was barely worn reads far lower). */
const usableBurn = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v >= 800 && v <= 8000;

/** The calorie suggestion: the average burn over `burned` (oldest first, the days before today), else 2,000. */
export function calorieTarget(burned: (number | null | undefined)[]): Target {
  const days = burned.slice(-BURN_DAYS).filter(usableBurn);
  if (days.length >= MIN_BURN_DAYS) {
    const mean = days.reduce((a, b) => a + b, 0) / days.length;
    const value = Math.min(5000, Math.max(1200, Math.round(mean / 50) * 50));
    return { value, custom: false, basis: i18n.t("nutrition:basis.kcalBurn", { count: days.length }) };
  }
  return { value: DEFAULT_KCAL, custom: false, basis: i18n.t("nutrition:basis.kcalDefault") };
}

/** Every target: the person's own where set, else the suggestions (fat and carbs follow the calories and protein). */
export function resolveTargets(custom: CustomTargets, input: { weightKg: number | null; heightCm: number | null; burned: (number | null | undefined)[] }): Targets {
  const own = (k: TargetKey): Target | null => (custom[k] !== null ? { value: custom[k], custom: true, basis: i18n.t("nutrition:basis.own") } : null);
  const kcal = own("kcal") ?? calorieTarget(input.burned);
  const protein = own("protein") ?? proteinTarget(input.weightKg, input.heightCm);
  const fat = own("fat") ?? { value: Math.round((kcal.value * FAT_SHARE) / 9), custom: false, basis: i18n.t("nutrition:basis.fat", { pct: Math.round(FAT_SHARE * 100), kcal: group(kcal.value) }) };
  const left = kcal.value - protein.value * 4 - fat.value * 9;
  const carbs = own("carbs") ?? { value: Math.max(0, Math.round(left / 4)), custom: false, basis: i18n.t("nutrition:basis.carbs") };
  return { kcal, protein, carbs, fat };
}

/** Progress toward a target, 0-1 (more than the target reads full); null without a value. */
export const progressOf = (value: number | null, target: number) => (value === null || !(target > 0) ? null : Math.max(0, Math.min(1, value / target)));

/** Null when `value` may be `key`'s target (null: Pulse's suggestion), else why not. */
export function validateTarget(key: TargetKey, value: number | null): string | null {
  if (value === null) return null;
  const l = TARGET_LIMITS[key];
  if (!Number.isFinite(value)) return i18n.t("errors:goals.enterNumber");
  if (!Number.isInteger(value)) return i18n.t("errors:goals.wholeOnly");
  if (value < l.min || value > l.max) return i18n.t("nutrition:basis.between", { low: group(l.min), high: group(l.max), unit: l.unit });
  return null;
}

/** A field's text: blank is Pulse's suggestion (null); else the number and the error to show, if any. */
export function parseTarget(key: TargetKey, text: string): { value: number | null; error: string | null } {
  const t = text.trim().replace(/[,\s](?=\d{3}\b)/g, "");
  if (t === "") return { value: null, error: null };
  const n = /^\d+([.]\d+)?$/.test(t) ? Number(t) : NaN;
  const error = Number.isNaN(n) ? i18n.t("errors:goals.enterNumber") : validateTarget(key, n);
  return { value: error ? null : n, error };
}

/** Stored JSON → custom targets; anything missing, broken or out of range follows the suggestion. */
export function parseCustomTargets(raw: string | null): CustomTargets {
  let v: unknown = null;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out: CustomTargets = { ...NO_CUSTOM };
  for (const k of TARGET_KEYS) {
    const t = o[k];
    if (typeof t === "number" && validateTarget(k, t) === null) out[k] = t;
  }
  return out;
}
