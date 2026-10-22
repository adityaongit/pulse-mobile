import { i18n } from "@/i18n/config";
import type { DeltaDir, Tone } from "./bands";
import { decimalMark, getLocale, onLocaleChange } from "./locale";
import { displayPrefs, feetInches, quantity } from "./units";

// Number, date and spoken-label formatting (spec §3.3, §6). Formatters are referenced by key so a
// server component can hand them to a client component (functions do not cross that boundary).

/** The product name for the Healthspan age. Swap to "Pulse Age" here if preferred (spec §11). */
export const AGE_LABEL = "Pulse Age";
export const MISSING = "--";
const MINUS = "−";

/** Joins a number to its unit or word so the pair never wraps apart: `10${NBSP}MB`. */
export const NBSP = " ";

let grouped = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });
const minus = (s: string) => s.replace("-", MINUS);
// "-0.0" collapses to "0.0"; the hyphen becomes a real minus sign.
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

/** Formats a value by key; null, undefined and non-finite numbers render as "--". */
export function formatValue(key: FormatKey, v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? MISSING : FORMATS[key](v);
}

/** Symbol units sit tight against the value (`ml-0.5`); word units get a gap (`ml-1`). */
export const isSymbolUnit = (unit: string) => unit === "%" || unit === "x";

// --- Dates and clock times ---

const dates = new Map<string, Intl.DateTimeFormat>();
onLocaleChange(() => {
  dates.clear();
  grouped = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });
});
/**
 * A calendar day ("2026-09-28", or a month "2026-09") through Intl.DateTimeFormat in the app locale: formatDay(day, DAY.short)
 * → "Mon, Sep 28". Read and formatted in UTC, so the runtime's zone never shifts the day.
 */
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(opts);
  let f = dates.get(key);
  if (!f) dates.set(key, (f = new Intl.DateTimeFormat(getLocale(), { ...opts, timeZone: "UTC" })));
  return f.format(new Date(`${day.length === 7 ? `${day}-01` : day}T00:00:00Z`));
}

/** The app's date shapes (spec §6) as Intl options for formatDay. */
export const DAY = {
  /** "Mon, Sep 28" */
  short: { weekday: "short", month: "short", day: "numeric" },
  /** "Monday, September 28", for spoken labels */
  long: { weekday: "long", month: "long", day: "numeric" },
  /** "Sep 28" */
  monthDay: { month: "short", day: "numeric" },
  /** "Sep 28, 1990" */
  full: { month: "short", day: "numeric", year: "numeric" },
  /** "September 2026" */
  monthYear: { month: "long", year: "numeric" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

/** "today" or "yesterday", the days named rather than printed; else null. Dates are YYYY-MM-DD in the user's zone. */
function nearDay(date: string, today: string) {
  if (date === today) return "today" as const;
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  return date === y.toISOString().slice(0, 10) ? ("yesterday" as const) : null;
}

/** "Today", "Yesterday", else "Mon, Sep 28". Dates are YYYY-MM-DD in the user's zone. */
export function dayLabel(date: string, today: string) {
  const near = nearDay(date, today);
  return near ? i18n.t(`common:${near}`) : formatDay(date, DAY.short);
}

/** A day inside a sentence: "today", "yesterday", else "on Mon, Sep 28". */
export function dayPhrase(date: string, today: string) {
  const near = nearDay(date, today);
  return near ? i18n.t(`common:phrase.${near}`) : i18n.t("common:phrase.on", { date: formatDay(date, DAY.short) });
}

/** The date pill's label: "Today", "Yesterday", else "Mon., Sep. 28", abbreviations marked with a period as the
 * reference app prints them ("TUE., APR. 14", home-03); a month short enough to need none stays bare ("May 4"). */
export function pillLabel(date: string, today: string) {
  if (nearDay(date, today)) return dayLabel(date, today);
  const month = formatDay(date, { month: "short" });
  const dot = month === formatDay(date, { month: "long" }) ? "" : ".";
  return `${formatDay(date, { weekday: "short" })}., ${month}${dot} ${formatDay(date, { day: "numeric" })}`;
}

/** "Sep 22 - Sep 28". */
export const rangeLabel = (from: string, to: string) => `${formatDay(from, DAY.monthDay)} - ${formatDay(to, DAY.monthDay)}`;

const clocks = new Map<string, Intl.DateTimeFormat>();
/** The local hour (0-23) and minute of `ms` in `timeZone` (default: the runtime zone). */
function hourMinute(ms: number, timeZone?: string) {
  const key = timeZone ?? "";
  let f = clocks.get(key);
  if (!f) clocks.set(key, (f = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone })));
  const parts = f.formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // `% 24`: some Intl engines print midnight as hour "24" even with hourCycle h23.
  return { h: get("hour") % 24, m: get("minute") };
}

// Built from the parts, not Intl's 12-hour output: engines differ in the space before AM/PM (some print U+202F, which
// the app's fonts lack).
const twelve = (h: number) => h % 12 || 12;
const period = (h: number) => (h < 12 ? "AM" : "PM");

/** A time of day (hour 0-23) on the person's clock (Settings › App): "22:05", or "10:05 PM". */
export const timeOfDay = (h: number, m: number) => (displayPrefs().hours === 24 ? `${pad(h)}:${pad(m)}` : `${twelve(h)}:${pad(m)}${NBSP}${period(h)}`);

/** Epoch ms → the time on the person's clock, in `timeZone` (default: the runtime zone). */
export function clock(ms: number, timeZone?: string) {
  const { h, m } = hourMinute(ms, timeZone);
  return timeOfDay(h, m);
}

/** A chart's time tick: `clock`, but a whole hour on the 12-hour clock is just "10 PM", short enough for an axis. */
export function clockTick(ms: number, timeZone?: string) {
  const { h, m } = hourMinute(ms, timeZone);
  return displayPrefs().hours === 12 && m === 0 ? `${twelve(h)}${NBSP}${period(h)}` : clock(ms, timeZone);
}

/** A value stored in `unit`, in the person's units with its unit: "2,000 ml" or "68 fl oz", "70.0 kg" or "154.3 lb". */
export function quantityText(v: number, unit: string, format: FormatKey) {
  const q = quantity(unit);
  return `${formatValue(format, q.value(v))}${isSymbolUnit(q.unit) ? "" : NBSP}${q.unit}`;
}

/**
 * A limit kept in `unit`, as a number in the person's units, rounded inward so the shown number is itself allowed: as a
 * minimum 20 kg reads "45" (lb), as a maximum 300 kg reads "661". Whole numbers from 10 up, one decimal below.
 */
export function limitText(v: number, unit: string, side: "min" | "max") {
  const x = quantity(unit).value(v);
  const step = Math.abs(x) >= 10 ? 1 : 0.1;
  const inward = (side === "min" ? Math.ceil(x / step - 1e-9) : Math.floor(x / step + 1e-9)) * step;
  return formatValue(step === 1 ? "grouped" : "decimal1", inward);
}

/** A unit as a word: "millilitres", "fluid ounces". */

/** Height as the person reads it: "178 cm", or "5′ 10″". */
export function heightText(cm: number) {
  if (displayPrefs().units === "metric") return `${Math.round(cm)}${NBSP}cm`;
  const { feet, inches } = feetInches(cm);
  return `${feet}′${NBSP}${inches}″`;
}

/** "38 minutes", "1 hour 12 minutes". */
export function durationWords(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const minutesPart = () => i18n.t("common:duration.minutes", { count: r });
  const hoursPart = () => i18n.t("common:duration.hours", { count: h });
  if (!h) return minutesPart();
  return r ? i18n.t("common:duration.hoursMinutes", { hours: hoursPart(), minutes: minutesPart() }) : hoursPart();
}

/** Relative age of a timestamp: "12 minutes ago", "3 hours ago". */
export function ago(ms: number, now: number) {
  const min = Math.max(0, Math.round((now - ms) / 60000));
  if (min < 1) return i18n.t("common:ago.justNow");
  if (min < 60) return i18n.t("common:ago.minutes", { count: min });
  const h = Math.round(min / 60);
  if (h < 48) return i18n.t("common:ago.hours", { count: h });
  return i18n.t("common:ago.days", { count: Math.round(h / 24) });
}

/** Header sync age, the reference app's battery slot (spec §4.3.2): "Now", "12m", "3h", "2d". */
export function agoShort(ms: number, now: number) {
  const min = Math.max(0, Math.floor((now - ms) / 60000));
  if (min < 1) return i18n.t("common:agoShort.now");
  if (min < 60) return i18n.t("common:agoShort.minutes", { count: min });
  const h = Math.floor(min / 60);
  return h < 48 ? i18n.t("common:agoShort.hours", { count: h }) : i18n.t("common:agoShort.days", { count: Math.floor(h / 24) });
}

// --- Spoken labels (aria) ---

const UNIT_KEY = {
  "%": "percent",
  "ms": "ms",
  "bpm": "bpm",
  "rpm": "rpm",
  "°C": "celsius",
  "°F": "fahrenheit",
  "kcal": "kcal",
  "ml/kg/min": "mlKgMin",
  "x": "times",
  "min": "min",
  "h": "h",
  "km": "km",
  "/km": "perKm",
  "mi": "mi",
  "/mi": "perMi",
  "kg": "kg",
  "lb": "lb",
  "m": "m",
  "ft": "ft",
  "cm": "cm",
  "in": "in",
  "ml": "ml",
  "fl oz": "flOz",
} as const;

/** A unit id as shown: "min" and "h" follow the language, every other unit is returned as it is. */
export const unitLabel = (unit: string) => (unit === "min" || unit === "h" ? i18n.t(`common:unit.${unit}`) : unit);

/** The unit as it is read aloud ("ms" → "milliseconds"); a unit with no spoken form is returned as it is. */
export const unitWord = (unit: string) => (unit in UNIT_KEY ? i18n.t(`common:unitWords.${UNIT_KEY[unit as keyof typeof UNIT_KEY]}`) : unit);

/** "124 milliseconds", "−0.4 degrees" → reads the minus sign as "minus". */
export function spoken(value: string, unit?: string) {
  const v = value.replace(MINUS, `${i18n.t("common:spoken.minus")} `);
  if (!unit) return v;
  return `${v} ${unitWord(unit)}`;
}

export type DialAria = {
  variant: "recovery" | "strain" | "sleep" | "stat" | "gauge";
  label: string;
  value?: number | null;
  valueText?: string;
  unit?: string;
  provisional?: boolean;
  reason?: string | null;
  reasonText?: string;
  bandWord?: string;
  target?: readonly [number, number] | null;
  soFar?: boolean;
};

/** "Recovery 72 percent, green", "Strain 42 percent so far, target 40 to 60 percent", "Recovery unavailable: calibrating, 4 nights left". */
export function dialAriaLabel(a: DialAria) {
  if (a.value === null || a.value === undefined) {
    const why = (a.reasonText ?? i18n.t("common:spoken.noData")).replace(/^(\w)/, (c) => c.toLowerCase()).replace(": ", ", ");
    return i18n.t("common:spoken.unavailable", { label: a.label, why });
  }
  const v = spoken(a.valueText ?? String(a.value), a.unit);
  const provisional = a.provisional ? i18n.t("common:spoken.provisional") : "";
  if (a.variant === "strain") {
    const target = a.target ? i18n.t("common:spoken.target", { from: a.target[0].toFixed(0), to: a.target[1].toFixed(0) }) : "";
    return i18n.t("common:spoken.dialStrain", { label: a.label, provisional, value: v, soFar: a.soFar ? i18n.t("common:spoken.soFar") : "", target });
  }
  const band = a.bandWord ? i18n.t("common:spoken.band", { band: a.bandWord.toLowerCase() }) : "";
  return i18n.t("common:spoken.dialValue", { label: a.label, provisional, value: v, band });
}

/** "Heart rate variability 124 milliseconds, above your 30-day average of 98, good". */
export function statSentence(o: {
  label: string;
  valueText: string;
  unit?: string;
  averageText?: string;
  averageLabel?: string;
  dir?: DeltaDir;
  tone?: Tone;
}) {
  const value = spoken(o.valueText, o.unit);
  if (!o.averageText || o.averageText === MISSING) return i18n.t("common:spoken.stat", { label: o.label, value });
  return i18n.t("common:spoken.statVsAverage", {
    label: o.label,
    value,
    relation: i18n.t(`common:spoken.${o.dir === "up" ? "above" : o.dir === "down" ? "below" : "inLineWith"}`),
    averageLabel: o.averageLabel ?? i18n.t("common:spoken.average30"),
    average: o.averageText,
    tone: o.tone === "good" ? i18n.t("common:spoken.toneGood") : o.tone === "bad" ? i18n.t("common:spoken.toneBad") : "",
  });
}
