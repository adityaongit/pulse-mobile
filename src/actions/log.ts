import { i18n } from "@/i18n/config";
// Logging from Pulse, as halo's src/screens/journal/actions.ts does it: water, food, weight (and body fat), blood
// oxygen, mood, symptoms, or (female profiles) a period or ovulation test. Every entry stays on the phone
// (`logged_entries`, source "pulse"): nothing is written to Health Connect or Google. Same validation and messages as
// pulse's src/server/actions/log.ts.
import { limitText, unitWord } from "@/lib/format";
import { quantity } from "@/lib/units";
import { addDays, fromWall, localDay } from "@/lib/time";
import {
  CYCLE_SYMPTOMS,
  deleteEntry,
  FLOWS,
  isCycleKind,
  MEALS,
  MOODS,
  type NewEntry,
  OVULATION_RESULTS,
  saveEntries,
  SYMPTOMS,
  VALENCES,
  type Flow,
  type Meal,
  type Mood,
  type OvulationResult,
  type Symptom,
  type Valence,
} from "@/queries/log";
import type { FoodData, FoodVia } from "@/queries/food";
import type { ActionCtx, ActionResult } from "./journal";

/** One food: its name (blank: the meal's), portion, calories and grams; a nutrient not given is null (unknown). */
export type FoodItemInput = { name: string; portion?: string; kcal: number; protein: number | null; carbs: number | null; fat: number | null; fiber?: number | null };

export type LogInput =
  | { kind: "water"; ml: number; at?: string }
  | ({ kind: "food"; meal: Meal; via?: FoodVia; at?: string } & FoodItemInput)
  | { kind: "weight"; kg: number; fatPct: number | null; at?: string }
  | { kind: "spo2"; pct: number; at?: string }
  | { kind: "mood"; moods: Mood[]; valence: Valence | null; at?: string }
  | { kind: "symptoms"; symptoms: Symptom[]; at?: string }
  | { kind: "period"; start: string; end: string; flow: Flow | null }
  | { kind: "ovulation"; result: OvulationResult; at?: string };

const fail = (error: string) => ({ ok: false as const, error });
const nowOf = (c: ActionCtx) => (c.nowS ? c.nowS() : Math.floor(Date.now() / 1000));

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && new Date(Date.parse(`${v}T00:00:00Z`)).toISOString().slice(0, 10) === v;
const AT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
/** A local wall time `YYYY-MM-DDTHH:mm` that names a real minute. */
const validAt = (at: string) => {
  const m = AT.exec(at);
  return !!m && isDay(m[1]) && +m[2] < 24 && +m[3] < 60;
};
const keys = (list: readonly (readonly [string, ...unknown[]])[]) => new Set(list.map((x) => x[0]));
const MEAL_KEYS = keys(MEALS);
const MOOD_KEYS = keys(MOODS);
const VALENCE_KEYS = keys(VALENCES);
const SYMPTOM_KEYS = keys(SYMPTOMS);
const FLOW_KEYS = keys(FLOWS);
const RESULT_KEYS = keys(OVULATION_RESULTS);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const grams = (v: unknown) => v === null || (num(v) && v >= 0 && v <= 1000);
const T_ENUM = () => i18n.t("errors:log.invalidOption");
const VIA_KEYS = new Set<string>(["photo", "text", "manual"]);
/** Most foods one save takes (a photo estimate lists each food it sees). */
export const MAX_FOODS = 20;

/** The first problem with `v`, as the web's zod schema reports it; null when it's valid. */
function invalid(v: LogInput): string | null {
  if ("at" in v && v.at !== undefined && !validAt(v.at)) return i18n.t("errors:log.chooseTime");
  switch (v.kind) {
    case "water":
      if (!num(v.ml) || !Number.isInteger(v.ml)) return i18n.t("errors:log.enterAmount", { unit: unitWord(quantity("ml").unit) });
      if (v.ml < 10) return i18n.t("errors:log.atLeast", { value: limitText(10, "ml", "min"), unit: quantity("ml").unit });
      if (v.ml > 5000) return i18n.t("errors:log.atMost", { value: limitText(5000, "ml", "max"), unit: quantity("ml").unit });
      return null;
    case "food":
      if (!MEAL_KEYS.has(v.meal) || (v.via !== undefined && !VIA_KEYS.has(v.via))) return T_ENUM();
      return invalidFood(v);
    case "weight":
      if (!num(v.kg) || v.kg < 20 || v.kg > 300) return i18n.t("errors:log.betweenUnit", { low: limitText(20, "kg", "min"), high: limitText(300, "kg", "max"), unit: quantity("kg").unit });
      if (v.fatPct !== null && (!num(v.fatPct) || v.fatPct < 2 || v.fatPct > 75)) return i18n.t("errors:log.fatRange");
      return null;
    case "spo2":
      return num(v.pct) && v.pct >= 70 && v.pct <= 100 ? null : i18n.t("errors:log.spo2Range");
    case "mood":
      if (!Array.isArray(v.moods) || v.moods.length < 1) return i18n.t("errors:log.chooseMood");
      if (v.moods.length > 5) return i18n.t("errors:log.maxMoods");
      if (!v.moods.every((m) => MOOD_KEYS.has(m)) || (v.valence !== null && !VALENCE_KEYS.has(v.valence))) return T_ENUM();
      return null;
    case "symptoms":
      if (!Array.isArray(v.symptoms) || v.symptoms.length < 1) return i18n.t("errors:log.chooseSymptom");
      if (v.symptoms.length > 10) return i18n.t("errors:log.maxSymptoms");
      if (!v.symptoms.every((s) => SYMPTOM_KEYS.has(s))) return T_ENUM();
      return null;
    case "period":
      if (!isDay(v.start) || !isDay(v.end)) return i18n.t("errors:log.chooseDays");
      if (v.flow !== null && !FLOW_KEYS.has(v.flow)) return T_ENUM();
      return null;
    case "ovulation":
      return RESULT_KEYS.has(v.result) ? null : T_ENUM();
  }
}

/** The first problem with one food, as the web's rules phrase them (portion and fiber are the phone's additions). */
export function invalidFood(v: FoodItemInput): string | null {
  if (typeof v.name !== "string" || v.name.trim().length > 80) return i18n.t("errors:log.nameLength");
  if (v.portion !== undefined && (typeof v.portion !== "string" || v.portion.trim().length > 60)) return i18n.t("errors:log.portionLength");
  if (!num(v.kcal) || !Number.isInteger(v.kcal) || v.kcal < 0) return i18n.t("errors:log.wholeCalories");
  if (v.kcal > 10_000) return i18n.t("errors:log.maxKcal");
  if (![v.protein, v.carbs, v.fat, v.fiber ?? null].every(grams)) return i18n.t("errors:log.macroRange");
  return null;
}

/** A food's stored data: a blank name is null, and the portion, fiber and how it was made only when given. */
function foodData(v: FoodItemInput, meal: Meal, via: FoodVia | undefined): FoodData {
  const portion = v.portion?.trim();
  return {
    name: v.name.trim() || null,
    meal,
    kcal: v.kcal,
    protein: v.protein,
    carbs: v.carbs,
    fat: v.fat,
    ...(portion ? { portion } : null),
    ...(v.fiber != null ? { fiber: v.fiber } : null),
    ...(via ? { via } : null),
  };
}

/** `at` as a moment for a log entry, or why it can't be one (not a time, in the future, over a year back). */
function momentOf(c: ActionCtx, at: string | undefined): { ok: true; ts: number } | { ok: false; error: string } {
  if (at !== undefined && !validAt(at)) return fail(i18n.t("errors:log.chooseTime"));
  const now = nowOf(c);
  const ts = at ? fromWall(at, c.timeZone) : now;
  if (ts > now + 60) return fail(i18n.t("errors:log.future"));
  if (ts < now - 366 * 86_400) return fail(i18n.t("errors:log.tooOld"));
  return { ok: true, ts };
}

/**
 * Logs one meal's foods at once (a photo or description estimate lists each food it sees; one typed food is a list of
 * one): every food is checked before any is saved, and all share the meal and the time.
 */
export async function logFoods(c: ActionCtx, input: { meal: Meal; via: FoodVia; at?: string; items: FoodItemInput[] }): Promise<ActionResult<{ count: number }>> {
  if (!MEAL_KEYS.has(input.meal) || !VIA_KEYS.has(input.via)) return fail(T_ENUM());
  if (!Array.isArray(input.items) || input.items.length < 1) return fail(i18n.t("errors:log.addFood"));
  if (input.items.length > MAX_FOODS) return fail(i18n.t("errors:log.maxFoods", { count: MAX_FOODS }));
  for (const item of input.items) {
    const problem = invalidFood(item);
    if (problem) return fail(input.items.length > 1 && item.name.trim() ? `${item.name.trim()}: ${problem}` : problem);
  }
  const when = momentOf(c, input.at);
  if (!when.ok) return when;
  const entries: NewEntry[] = input.items.map((item) => ({ type: "nutrition-log", ts: when.ts, data: foodData(item, input.meal, input.via) }));
  await saveEntries(c.store, entries, { tz: c.timeZone, now: nowOf(c) });
  return { ok: true, data: { count: entries.length } };
}

/**
 * Changes a food logged in Pulse, in place (same id): its name, portion, numbers, meal and time. `ts` is the entry's
 * time as listed (it is found from there). Food read from Health Connect (logged in Fitbit) is changed in Fitbit only.
 */
export async function updateFoodEntry(c: ActionCtx, input: { id: string; ts: number; meal: Meal; at?: string; item: FoodItemInput }): Promise<ActionResult> {
  if (!MEAL_KEYS.has(input.meal)) return fail(T_ENUM());
  const problem = invalidFood(input.item);
  if (problem) return fail(problem);
  const when = momentOf(c, input.at);
  if (!when.ok) return when;
  const row = (await c.store.loggedEntries(Math.min(input.ts, when.ts) - 1, 5000)).find((r) => r.id === input.id);
  if (!row || row.type !== "nutrition-log") return fail(i18n.t("errors:log.foodGone"));
  if (row.source !== "pulse") return fail(i18n.t("errors:log.foodInFitbit"));
  const before = row.data as Partial<FoodData> | null;
  const via = before && typeof before.via === "string" && VIA_KEYS.has(before.via) ? before.via : undefined;
  const data = foodData(input.item, input.meal, via);
  if (before?.separate === true) data.separate = true;
  await c.store.addLoggedEntries([{ ...row, ts: when.ts, day: localDay(when.ts, c.timeZone), data }]);
  return { ok: true, data: undefined };
}

/**
 * "Count it too": a Pulse food that Pulse took for a repeat of a Fitbit entry is a food of its own after all, so it
 * counts beside Fitbit's (`separate`). `separate: false` lets Pulse match it again.
 */
export async function setFoodSeparate(c: ActionCtx, input: { id: string; ts: number; separate: boolean }): Promise<ActionResult> {
  const row = (await c.store.loggedEntries(input.ts - 1, 5000)).find((r) => r.id === input.id);
  if (!row || row.type !== "nutrition-log") return fail(i18n.t("errors:log.foodGone"));
  if (row.source !== "pulse") return fail(i18n.t("errors:log.foodInFitbit"));
  const { separate: _old, ...data } = (row.data ?? {}) as FoodData;
  await c.store.addLoggedEntries([{ ...row, data: input.separate ? { ...data, separate: true } : data }]);
  return { ok: true, data: undefined };
}

/** Logs one entry (weight with body fat is two). */
export async function logEntry(c: ActionCtx, input: LogInput): Promise<ActionResult> {
  const problem = invalid(input);
  if (problem) return fail(problem);
  const v = input;
  const tz = c.timeZone;
  // Cycle tracking never exists on a male profile, whatever a request says.
  if (c.profile.sex !== "female" && (isCycleKind(v.kind) || (v.kind === "symptoms" && v.symptoms.some((s) => CYCLE_SYMPTOMS.has(s))))) {
    return fail(i18n.t("errors:log.notAvailable"));
  }

  const now = nowOf(c);
  const today = localDay(now, tz);
  const ts = "at" in v && v.at ? fromWall(v.at, tz) : now;
  if (ts > now + 60) return fail(i18n.t("errors:log.future"));
  if (ts < now - 366 * 86_400) return fail(i18n.t("errors:log.tooOld"));

  let entries: NewEntry[];
  switch (v.kind) {
    case "water":
      entries = [{ type: "hydration-log", ts, data: { ml: v.ml } }];
      break;
    case "food":
      entries = [{ type: "nutrition-log", ts, data: foodData(v, v.meal, v.via) }];
      break;
    case "weight":
      entries = [
        { type: "weight", ts, data: { kg: Math.round(v.kg * 10) / 10 } },
        ...(v.fatPct != null ? [{ type: "body-fat" as const, ts, data: { pct: Math.round(v.fatPct * 10) / 10 } }] : []),
      ];
      break;
    case "spo2":
      entries = [{ type: "oxygen-saturation", ts, data: { pct: Math.round(v.pct * 10) / 10 } }];
      break;
    case "mood":
      entries = [{ type: "moods", ts, data: { moods: v.moods, valence: v.valence } }];
      break;
    case "symptoms":
      entries = [{ type: "symptoms", ts, data: { symptoms: v.symptoms } }];
      break;
    case "period": {
      if (v.end < v.start) return fail(i18n.t("errors:log.endBeforeStart"));
      if (v.end > today) return fail(i18n.t("errors:log.futureDay"));
      if (v.start < addDays(today, -366)) return fail(i18n.t("errors:log.tooOld"));
      if (v.end > addDays(v.start, 14)) return fail("A period is 15 days at most");
      entries = [{ type: "menstrual-period", ts: fromWall(`${v.start}T00:00`, tz), data: { start: v.start, end: v.end, flow: v.flow } }];
      break;
    }
    case "ovulation":
      entries = [{ type: "ovulation-test", ts, data: { result: v.result } }];
      break;
  }
  await saveEntries(c.store, entries, { tz, now });
  return { ok: true, data: undefined };
}

/** Deletes a logged entry. */
export async function deleteLogEntry(c: ActionCtx, input: { id: string }): Promise<ActionResult> {
  if (typeof input.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) return fail(i18n.t("errors:log.invalidId"));
  await deleteEntry(c.store, input.id);
  return { ok: true, data: undefined };
}
