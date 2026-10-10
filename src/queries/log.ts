// Journal's Log (spec §11 LG1): which sheets to offer, whether each can write to Google, and one day's log, grouped
// the way people think about it (water, food by meal, body, mood and symptoms), with the day's totals and its week.
// Ported from pulse src/server/queries/log.ts and the read half of src/server/log.ts (`toEntry`): reads go through the
// log and daily repositories. There is no demo mode, so `demo` and the "demo" access are gone.
import { appLabel, CYCLE_SYMPTOMS, describeEntry, isCycleKind, KIND_TYPES, LOG_DAYS, LOG_KINDS, MEALS, type LogData, type LogKind, type LogType, type Meal } from "@/lib/log";
import type { DayTotals, Food, LoggedEntryRow } from "../data/repos/log";
import { logAccess, type LogAccess } from "../google/log";
import { addDays } from "../time";
import { type QueryCtx, todayOf } from "./common";

export type { DayTotals, Food, LogAccess };

/** `fromApp`: logged in another app and brought home by the sync; `app` says which ("Pulse" for Pulse's own). */
export type LoggedEntry = {
  id: string;
  type: LogType;
  ts: number;
  day: string;
  title: string;
  detail: string;
  data: unknown;
  atGoogle: boolean;
  fromApp: boolean;
  app: string;
  createdAt: number;
};

export const toEntry = (r: LoggedEntryRow): LoggedEntry => ({
  id: r.id,
  type: r.type as LogType,
  ts: r.ts,
  day: r.day,
  ...describeEntry(r.type as LogType, r.data),
  data: r.data,
  atGoogle: r.googleName !== null,
  fromApp: r.source === "google",
  app: appLabel(r.source, r.app),
  createdAt: r.createdAt,
});

export type MealGroup = { meal: Meal; label: string; kcal: number; entries: LoggedEntry[] };
/** A weight and the body fat logged with it (one weigh-in writes both), as one row. */
export type Weighin = { ts: number; kg: number | null; pct: number | null; entries: LoggedEntry[] };
export type WeekDay = DayTotals;

/** A weight older than this is not "the latest": the tile shows nothing rather than a reading from months ago. */
const WEIGHT_DAYS = 90;
/** A scale may write weight and body fat a moment apart: within this they are one weigh-in. */
const WEIGHIN_S = 60;

export type LogVM = {
  /** Cycle kinds are absent on a male profile. */
  kinds: LogKind[];
  /** Per sheet: the worst access of the types it writes (weight needs weight and body fat). */
  access: Record<LogKind, LogAccess>;
  /** The day shown (Journal's selected day) and today, both local. */
  day: string;
  today: string;
  timeZone: string;
  /** Whether other apps' entries are listed for the day: the sync brings them home for the last LOG_DAYS only. */
  listed: boolean;
  /** The day's water: Google's roll-up plus what Pulse logged since that sync, and each drink. */
  water: { total: number; entries: LoggedEntry[] };
  /** The day's food the same way, and each entry under its meal (every meal, empty ones too). */
  food: { total: Food | null; meals: MealGroup[] };
  /** The latest weight on or before the day, its change from the one before, and the day's weigh-ins. */
  body: { latest: { kg: number; day: string } | null; change: { kg: number; since: string } | null; weighins: Weighin[] };
  moods: LoggedEntry[];
  symptoms: LoggedEntry[];
  /** Periods running through the day and ovulation tests on it (female profiles only). */
  cycle: LoggedEntry[];
  /** The seven days ending on the day, oldest first. */
  week: WeekDay[];
};

const RANK: Record<LogAccess, number> = { ok: 0, reconnect: 1, not_connected: 2 };

export async function getLog(ctx: QueryCtx, day: string): Promise<LogVM> {
  const { log, daily } = ctx.store;
  const female = ctx.profile.sex === "female";
  const [byType, rows, weights, week, food] = await Promise.all([
    logAccess(ctx.store),
    log.entriesOnDay(day),
    daily.recentWeights(addDays(day, -WEIGHT_DAYS), day, 2),
    log.totalsBetween(addDays(day, -6), day),
    log.foodOn(day),
  ]);
  const entries = rows.map(toEntry);
  const kinds = LOG_KINDS.filter((k) => female || !isCycleKind(k));
  const access = Object.fromEntries(LOG_KINDS.map((k) => [k, KIND_TYPES[k].map((t) => byType[t]).reduce((a, b) => (RANK[b] > RANK[a] ? b : a))])) as Record<LogKind, LogAccess>;
  const of = (t: LoggedEntry["type"]) => entries.filter((e) => e.type === t);

  const foods = of("nutrition-log");
  // A meal value Pulse does not know files under Snack rather than vanishing (the import maps Google's own to Snack).
  const mealOf = (e: LoggedEntry) => {
    const m = String((e.data as LogData["nutrition-log"]).meal ?? "").toUpperCase();
    return MEALS.some(([k]) => k === m) ? m : "SNACK";
  };
  const meals = MEALS.map(([meal, label]) => {
    const mine = foods.filter((e) => mealOf(e) === meal);
    return { meal, label, kcal: mine.reduce((a, e) => a + (e.data as LogData["nutrition-log"]).kcal, 0), entries: mine };
  });

  const weighins: Weighin[] = [];
  for (const e of [...of("weight"), ...of("body-fat")].sort((a, b) => a.ts - b.ts)) {
    const slot = e.type === "weight" ? "kg" : "pct";
    let w = weighins.find((x) => x[slot] === null && Math.abs(x.ts - e.ts) <= WEIGHIN_S);
    if (!w) weighins.push((w = { ts: e.ts, kg: null, pct: null, entries: [] }));
    if (e.type === "weight") w.kg = (e.data as LogData["weight"]).kg;
    else w.pct = (e.data as LogData["body-fat"]).pct;
    w.entries.push(e);
  }

  // A weigh-in logged in Pulse today reaches daily_metrics only with the next sync: it is the latest until then.
  const loggedKg = weighins.findLast((w) => w.kg !== null)?.kg ?? null;
  const [last, prev] = weights;
  const latest = loggedKg !== null ? { kg: loggedKg, day } : (last ?? null);
  const before = loggedKg !== null ? (last && last.day < day ? last : prev) : prev;
  const change = latest && before ? { kg: Math.round((latest.kg - before.kg) * 10) / 10, since: before.day } : null;

  return {
    kinds,
    access,
    day,
    today: todayOf(ctx),
    timeZone: ctx.timeZone,
    listed: day >= addDays(todayOf(ctx), 1 - LOG_DAYS),
    water: { total: week[6].water ?? 0, entries: of("hydration-log") },
    food: { total: food, meals },
    body: { latest, change, weighins },
    moods: of("moods"),
    symptoms: female ? of("symptoms") : of("symptoms").filter((e) => !(e.data as LogData["symptoms"]).symptoms.some((s) => CYCLE_SYMPTOMS.has(s))),
    // A male profile never sees cycle entries, even ones logged before the profile changed.
    cycle: female ? entries.filter((e) => e.type === "menstrual-period" || e.type === "ovulation-test") : [],
    week,
  };
}

/**
 * The entries behind one row of the day's log (a drink, a meal, a weigh-in's weight and body fat), for the entry sheet:
 * a sheet is a route and its params are strings, so it loads them by id. Entries already deleted are left out.
 */
export async function getLogEntries(ctx: QueryCtx, ids: string[], day: string): Promise<{ entries: LoggedEntry[]; day: string; today: string; timeZone: string }> {
  const rows = await Promise.all(ids.map((id) => ctx.store.log.entryById(id)));
  return { entries: rows.flatMap((r) => (r ? [toEntry(r)] : [])), day, today: todayOf(ctx), timeZone: ctx.timeZone };
}
