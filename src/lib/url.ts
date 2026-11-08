import { addDays as addDaysFns, format, isValid, parseISO, startOfISOWeek } from "date-fns";

// URL state: the selected day `?d=YYYY-MM-DD` (KTD15) and the trend range `?r=` (spec §5.5, §8).

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = (date: Date) => format(date, "yyyy-MM-dd");

/** Today as YYYY-MM-DD in `timeZone` (default: the runtime zone). */
export function todayIn(timeZone?: string, now = new Date()) {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const addDays = (day: string, n: number) => iso(addDaysFns(parseISO(day), n));

/** `from` moved by `by` days, kept within [firstDay, today]. */
export function stepDay(from: string, by: number, today: string, firstDay?: string | null) {
  const day = addDays(from, by);
  return day > today ? today : firstDay && day < firstDay ? firstDay : day;
}

/** Monday and Sunday of the ISO week containing `day`. */
export function weekOf(day: string): [string, string] {
  const mon = startOfISOWeek(parseISO(day));
  return [iso(mon), iso(addDaysFns(mon, 6))];
}

function isDay(raw: string) {
  if (!DAY.test(raw)) return false;
  const date = parseISO(raw);
  return isValid(date) && iso(date) === raw; // rejects 2026-02-31
}

/** How far back `?d=` may go. Pages build a day strip from `d` to today, so this bounds it (~3,650 tiles). */
export const MAX_PAST_DAYS = 3650;

/** A real day no later than today and no more than MAX_PAST_DAYS before it. */
export const inDayRange = (v: string, today: string) => isDay(v) && v <= today && v >= addDays(today, -MAX_PAST_DAYS);

/**
 * Reads `?d=`. Missing → today. Unparsable, future or older than MAX_PAST_DAYS → today with `rejected: true`, so
 * the page can replace the URL without `d`.
 */
export function parseDay(raw: string | string[] | undefined, today: string) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === "") return { d: today, isToday: true, rejected: false };
  if (!inDayRange(v, today)) return { d: today, isToday: true, rejected: true };
  return { d: v, isToday: v === today, rejected: false };
}

export const RANGES = ["w", "m", "6m", "1y"] as const;
export type TrendRange = (typeof RANGES)[number];
export const RANGE_DAYS: Record<TrendRange, number> = { w: 7, m: 30, "6m": 182, "1y": 365 };

/** Reads `?r=`; anything else is the default `m`. */
export function parseRange(raw: string | string[] | undefined): TrendRange {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (RANGES as readonly string[]).includes(v ?? "") ? (v as TrendRange) : "m";
}

/** Sets or removes one query param on a `search` string ("?a=1" or "a=1"); returns "?…" or "". */
export function withParam(search: string, key: string, value: string | null) {
  const p = new URLSearchParams(search);
  if (value === null) p.delete(key);
  else p.set(key, value);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Link to a day-aware screen carrying `d` (omitted for today). Keeps a `#hash` and any query
 * already on `href`: dayHref("/sleep#planner", "2026-09-26", today) → "/sleep?d=2026-09-26#planner".
 */
export function dayHref(href: string, d: string, today: string) {
  const [pathAndQuery, hash] = href.split("#");
  const [path, query = ""] = pathAndQuery.split("?");
  const q = withParam(query, "d", d === today ? null : d);
  return `${path}${q}${hash ? `#${hash}` : ""}`;
}

/** A metric's own detail screen (Steps, Distance, Weight, …): `/metric/steps`. */
export const metricHref = (key: string) => `/metric/${key}`;

/** A Trend View `/trend/[key]` (spec §11 R29), keeping the day and, when set, the range and period offset. */
export function trendHref(key: string, o: { d?: string; today?: string; r?: string; p?: number } = {}) {
  const q = new URLSearchParams();
  if (o.d && o.d !== o.today) q.set("d", o.d);
  if (o.r) q.set("r", o.r);
  if (o.p) q.set("p", String(o.p));
  return `/trend/${key}${q.size ? `?${q}` : ""}`;
}

/** `/activity/[id]`. Google's ids are resource names with slashes (`users/…/dataPoints/…`), so the id is encoded. */
export const activityHref = (id: string) => `/activity/${encodeURIComponent(id)}`;
/** `/sleep/nap/[id]`, encoded like activityHref. */
export const napHref = (id: string) => `/sleep/nap/${encodeURIComponent(id)}`;

// --- Navigation structure (spec §4.2, §4.5) ---

export type Tab = "home" | "health" | "workout" | "journal" | "more";
export const TAB_ROOT: Record<Tab, string> = { home: "/", health: "/health", workout: "/workout", journal: "/journal", more: "/more" };

/** The tab a route belongs to. Detail routes map to their parent tab. */
export function tabForPath(pathname: string): Tab {
  const first = pathname.split("/")[1] ?? "";
  if (first === "health") return "health";
  if (first === "journal") return "journal";
  if (first === "workout" || first === "workout-coach") return "workout";
  if (["more", "settings", "reports", "trends"].includes(first)) return "more";
  return "home";
}

/** Where DetailHeader's back goes without history: the parent tab root. */
export const parentHref = (pathname: string) => TAB_ROOT[tabForPath(pathname)];
