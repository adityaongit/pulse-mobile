// The few helpers the queries need from Pulse's src/lib/{format,bands,url,extraMetrics,dashboard}.ts and
// src/lib/log.ts, copied here so src/queries depends on nothing outside src/core, src/lib/time and src/lib/reasons
// (the UI's own port of those libs is written separately). Keep each function identical to the web's.
import { decimalMark, getLocale, onLocaleChange } from "@/lib/locale";
import { i18n } from "@/i18n/config";
import { type LabelKey, labelRecord, withLabel } from "@/lib/metricLabels";
import { acwrBand, type AcwrBand } from "@/core/scoring/readiness";

// ── format.ts ───────────────────────────────────────────────────────────────

const MINUS = "−";
let grouped = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });
const minus = (s: string) => s.replace("-", MINUS);
const fixed = (v: number, d: number) => {
  const s = v.toFixed(d);
  return minus((/^-0(\.0+)?$/.test(s) ? s.slice(1) : s).replace(".", decimalMark()));
};
const signed = (v: number, d: number) => (Number(v.toFixed(d)) > 0 ? `+${fixed(v, d)}` : fixed(v, d));
const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes → "7:42". */
export function hmm(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

export const FORMATS = {
  int: (v: number) => fixed(v, 0),
  grouped: (v: number) => minus(grouped.format(Math.round(v))),
  decimal1: (v: number) => fixed(v, 1),
  /** A whole percent with its sign tight: Strain "42%". */
  pct: (v: number) => `${fixed(v, 0)}%`,
  decimal2: (v: number) => fixed(v, 2),
  signed1: (v: number) => signed(v, 1),
  signedInt: (v: number) => signed(v, 0),
  /** Minutes → h:mm. */
  duration: hmm,
  /** Seconds (per km) → m:ss, the pace "5:32". */
  pace: (s: number) => {
    const t = Math.max(0, Math.round(s));
    return `${Math.floor(t / 60)}:${pad(t % 60)}`;
  },
  /** Seconds → h:mm:ss. */
  durationHMS: (s: number) => {
    const t = Math.max(0, Math.round(s));
    return `${Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
  },
} satisfies Record<string, (v: number) => string>;
export type FormatKey = keyof typeof FORMATS;

const dates = new Map<string, Intl.DateTimeFormat>();
onLocaleChange(() => {
  dates.clear();
  grouped = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });
});
/** A calendar day ("2026-09-28", or a month "2026-09") in the app locale, read and formatted in UTC so the runtime's zone never shifts it. */
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(opts);
  let f = dates.get(key);
  if (!f) dates.set(key, (f = new Intl.DateTimeFormat(getLocale(), { ...opts, timeZone: "UTC" })));
  return f.format(new Date(`${day.length === 7 ? `${day}-01` : day}T00:00:00Z`));
}

/** The app's date shapes as Intl options for formatDay. */
export const DAY = {
  /** "Mon, Sep 28" */
  short: { weekday: "short", month: "short", day: "numeric" },
  /** "Monday, September 28" */
  long: { weekday: "long", month: "long", day: "numeric" },
  /** "Sep 28" */
  monthDay: { month: "short", day: "numeric" },
  /** "Sep 28, 1990" */
  full: { month: "short", day: "numeric", year: "numeric" },
  /** "September 2026" */
  monthYear: { month: "long", year: "numeric" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

/** "Today", "Yesterday", else "Mon, Sep 28". */
export function dayLabel(date: string, today: string) {
  if (date === today) return i18n.t("common:today");
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (date === y.toISOString().slice(0, 10)) return i18n.t("common:yesterday");
  return formatDay(date, DAY.short);
}

/** The person's clock (src/lib/format.ts), which reads their 12- or 24-hour choice. */
export { clock } from "@/lib/format";

// ── url.ts ──────────────────────────────────────────────────────────────────

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday and Sunday of the ISO week containing `day`. */
export function weekOf(day: string): [string, string] {
  const t = Date.parse(`${day}T00:00:00Z`);
  const back = (new Date(t).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  const mon = t - back * 86_400_000;
  return [iso(mon), iso(mon + 6 * 86_400_000)];
}

export const RANGES = ["w", "m", "6m", "1y"] as const;
export type TrendRange = (typeof RANGES)[number];
export const RANGE_DAYS: Record<TrendRange, number> = { w: 7, m: 30, "6m": 182, "1y": 365 };

/** A metric's own detail screen (Steps, Distance, Weight, …): `/metric/steps`. The mobile router maps it to a route. */
export const metricHref = (key: string) => `/metric/${key}`;

// ── bands.ts ────────────────────────────────────────────────────────────────

export type RecoveryBand = "green" | "yellow" | "red";

/** ≥ 67 green, 34-66 yellow, below 34 red. */
export function recoveryBand(value: number): RecoveryBand {
  if (value >= 67) return "green";
  if (value >= 34) return "yellow";
  return "red";
}

export type StressLevel = "low" | "medium" | "high";
export function stressLevel(value: number): StressLevel {
  if (value >= 60) return "high";
  if (value >= 30) return "medium";
  return "low";
}

/** Which way is good. `neutral` still shows the arrow direction, never a good/bad tone. */
export type GoodDirection = "up" | "down" | "neutral" | "toward_zero";

export type ChipTone = "optimal" | "warning" | "alert" | "neutral";

const ACWR_TONE: Record<AcwrBand, ChipTone> = { LOAD_RAMPING_DOWN: "neutral", LOAD_SWEET_SPOT: "optimal", LOAD_BUILDING_FAST: "warning", LOAD_SPIKING: "alert" };

/** Training load (ACWR) chip tone, on Garmin's 2026 bands: below 0.8 neutral, [0.8, 1.5) optimal, [1.5, 2.0) warning, then alert. */
export const acwrTone = (acwr: number): ChipTone => ACWR_TONE[acwrBand(acwr)];

// ── extraMetrics.ts ─────────────────────────────────────────────────────────

export type ExtraMetric = {
  key: string;
  label: string;
  /** Shown after the value; minutes use h:mm via `format` instead. */
  unit?: string;
  format: FormatKey;
  direction: GoodDirection;
  /** My Dashboard's editor group. Every extra opens its own detail screen, `/metric/<key>`. */
  group: "activity" | "nutrition" | "vitals";
  /** Accrues through the day: today is a gap in trends, not a low bar. */
  partialToday?: boolean;
  /**
   * mobile: where the number comes from when it is not the source's own roll-up. Health Connect carries no activity
   * minutes, Active Zone Minutes or daily average heart rate, so the sync derives them from the band's heart rate and
   * steps (src/health/derive.ts), approximating Fitbit's rules; the metric screen shows this note as the source.
   */
  note?: string;
};

const EXTRA_DEFS = [
  { key: "distance", unit: "km", format: "decimal2", direction: "up", group: "activity", partialToday: true },
  { key: "floors", format: "grouped", direction: "up", group: "activity", partialToday: true },
  { key: "elevation", unit: "m", format: "int", direction: "up", group: "activity", partialToday: true },
  { key: "active_minutes", format: "duration", direction: "up", group: "activity", partialToday: true, derived: true },
  { key: "light_minutes", format: "duration", direction: "up", group: "activity", partialToday: true, derived: true },
  { key: "azm", format: "duration", direction: "up", group: "activity", partialToday: true, derived: true },
  { key: "active_calories", unit: "kcal", format: "grouped", direction: "neutral", group: "activity", partialToday: true },
  { key: "sedentary_minutes", format: "duration", direction: "down", group: "activity", partialToday: true, derived: true },
  // Today's is the samples so far (in the morning mostly the night's), not the day's average: "so far", like Stress's.
  { key: "avg_hr", unit: "bpm", format: "int", direction: "neutral", group: "activity", partialToday: true, derived: true },
  { key: "water", unit: "ml", format: "grouped", direction: "up", group: "nutrition", partialToday: true },
  { key: "calories_in", unit: "kcal", format: "grouped", direction: "neutral", group: "nutrition", partialToday: true },
  { key: "protein", unit: "g", format: "int", direction: "neutral", group: "nutrition", partialToday: true },
  { key: "carbs", unit: "g", format: "int", direction: "neutral", group: "nutrition", partialToday: true },
  { key: "fat", unit: "g", format: "int", direction: "neutral", group: "nutrition", partialToday: true },
  { key: "glucose", unit: "mg/dL", format: "int", direction: "neutral", group: "vitals" },
  { key: "core_temp", unit: "°C", format: "decimal1", direction: "neutral", group: "vitals" },
  { key: "swim_strokes", format: "grouped", direction: "up", group: "activity", partialToday: true },
] as const satisfies readonly (Omit<ExtraMetric, "label" | "key" | "note"> & { key: LabelKey; derived?: true })[];

/** `label` and `note` are getters (metrics namespace), resolved when read. */
export const EXTRA_METRICS = EXTRA_DEFS.map((d) => {
  const m = withLabel(d);
  return "derived" in d ? Object.defineProperty(m, "note", { get: () => i18n.t("metrics:derivedNote"), enumerable: true }) : m;
});

export type ExtraKey = (typeof EXTRA_DEFS)[number]["key"];
export const EXTRA_KEYS = EXTRA_METRICS.map((m) => m.key) as ExtraKey[];
export const extraMetric = (key: ExtraKey): ExtraMetric => EXTRA_METRICS.find((m) => m.key === key)!;

// ── dashboard.ts ────────────────────────────────────────────────────────────

export const DASHBOARD_GROUPS = [
  { key: "recovery" },
  { key: "activity" },
  { key: "body" },
  { key: "nutrition" },
  { key: "vitals" },
] as const;
export type DashboardGroup = (typeof DASHBOARD_GROUPS)[number]["key"];

/** The eight v1 rows; their units and reasons live in the Home query (`keyStats`). */
const CORE = [
  { key: "hrv", group: "recovery" },
  { key: "rhr", group: "recovery" },
  { key: "resp", group: "vitals" },
  { key: "sleep", group: "recovery" },
  { key: "calories", group: "activity" },
  { key: "steps", group: "activity" },
  { key: "spo2", group: "vitals" },
  { key: "skin", group: "vitals" },
] as const;

/** Weight and body-fat readings; each opens its detail screen. */
const BODY_DEFS = [
  { key: "weight", unit: "kg", format: "decimal1", direction: "neutral", href: metricHref("weight") },
  { key: "body_fat", unit: "%", format: "decimal1", direction: "neutral", href: metricHref("body_fat") },
] as const satisfies readonly { key: LabelKey; unit: string; format: FormatKey; direction: GoodDirection; href: string }[];
export const BODY_METRICS = BODY_DEFS.map(withLabel);
export type BodyKey = (typeof BODY_DEFS)[number]["key"];

export type DashboardKey = (typeof CORE)[number]["key"] | BodyKey | ExtraKey;

const ALL = (
  [
    ...CORE,
    ...BODY_METRICS.map((m) => ({ key: m.key, group: "body" as const })),
    ...EXTRA_METRICS.map((m) => ({ key: m.key, group: m.group })),
  ] as { key: DashboardKey & LabelKey; group: DashboardGroup }[]
).map(withLabel);

/** Every metric, in editor order: by group, then catalogue order within it. */
export const DASHBOARD_METRICS = DASHBOARD_GROUPS.flatMap((g) => ALL.filter((m) => m.group === g.key));

/** `DASHBOARD_LABEL[key]` resolves the name per read. */
export const DASHBOARD_LABEL: Record<DashboardKey, string> = labelRecord(ALL.map((m) => m.key));

export const isDashboardKey = (k: string): k is DashboardKey => Object.prototype.hasOwnProperty.call(DASHBOARD_LABEL, k);

/** The default list: the v1 rows in their v1 order. */
export const DASHBOARD_DEFAULT: DashboardKey[] = CORE.map((m) => m.key);

/** The default for an account that has never synced heart rate (phone only, no band): what its phone counts. */
export const PHONE_DEFAULT: DashboardKey[] = ["steps", "distance", "calories", "active_minutes", "active_calories", "floors"];

/** Phone Home's lead card (spec §11 CD2): what a phone records without a band. */
export const PHONE_STATS: DashboardKey[] = ["steps", "distance", "calories", "active_minutes"];

// ── log.ts (types only: the metric screen's "entries" section shape) ────────

export const LOG_TYPES = ["hydration-log", "nutrition-log", "weight", "body-fat", "oxygen-saturation", "moods", "symptoms", "menstrual-period", "ovulation-test"] as const;
export type LogType = (typeof LOG_TYPES)[number];

/**
 * One entry logged from Pulse, as the metric screen lists it. mobile: `source` says whether it was logged in Pulse or
 * read from Health Connect (logged in Fitbit); the latter are shown read-only.
 */
export type LoggedEntry = { id: string; type: LogType; ts: number; day: string; title: string; detail: string; atGoogle: boolean; source: "pulse" | "health_connect" };
