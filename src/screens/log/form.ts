// The log sheets' form state and its translation to the log action's input: the pure half of pulse's
// (app)/journal/Log.tsx (EMPTY, toInput, num, wallNow), unchanged, so it is tested in Node (form.test.ts).
import { unitWord } from "@/lib/format";
import { quantity } from "@/lib/units";
import type { FoodItemInput, LogInput } from "@/actions/log";
import type { LogKind, Meal } from "@/queries/log";
import { wall } from "@/lib/time";

const NUM = /^\d+([.,]\d+)?$/;

/** The wall clock now in the person's zone, as `YYYY-MM-DDTHH:mm` (what the web's datetime-local input holds). */
export const wallNow = (timeZone: string, now = Math.floor(Date.now() / 1000)) => {
  const w = wall(now, timeZone);
  return `${w.day}T${w.time.slice(0, 5)}`;
};

/** A past day logs at noon of that day by default; today at the time it is. */
export const defaultAt = (vm: { day: string; today: string; timeZone: string }) => (vm.day === vm.today ? wallNow(vm.timeZone) : `${vm.day}T12:00`);

export const num = (s: string) => (s.trim() === "" ? null : NUM.test(s.trim()) ? Number(s.trim().replace(",", ".")) : NaN);

/** One food's fields as typed (the food sheet's form, and each food of an estimate under review), halo's forms.ts. */
export type FoodForm = { name: string; portion: string; kcal: string; protein: string; carbs: string; fat: string; fiber: string };
export const EMPTY_FOOD: FoodForm = { name: "", portion: "", kcal: "", protein: "", carbs: "", fat: "", fiber: "" };

/** One food's fields as the action's item (portion and fiber only when given), or the first problem to show. */
export function foodItemOf(f: FoodForm): FoodItemInput | string {
  const kcal = num(f.kcal);
  if (kcal == null || Number.isNaN(kcal) || !Number.isInteger(kcal)) return "Enter calories as a whole number.";
  const [protein, carbs, fat, fiber] = [f.protein, f.carbs, f.fat, f.fiber].map(num);
  if ([protein, carbs, fat, fiber].some((g) => Number.isNaN(g))) return "Macros are grams, as numbers.";
  const portion = f.portion.trim();
  return { name: f.name, ...(portion && { portion }), kcal, protein, carbs, fat, ...(fiber !== null && { fiber }) };
}

/** A food's numbers as its fields show them: an estimate to review, an entry to edit. Unknown grams stay blank. */
export function foodFormOf(v: { name: string | null; portion?: string | null; kcal: number; protein: number | null; carbs: number | null; fat: number | null; fiber?: number | null }): FoodForm {
  const g = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
  return { name: v.name ?? "", portion: v.portion ?? "", kcal: String(v.kcal), protein: g(v.protein), carbs: g(v.carbs), fat: g(v.fat), fiber: g(v.fiber) };
}

/** The meal a time of day suggests ("HH:mm"): breakfast before 11, lunch before 4 pm, a snack before 6, dinner before 11 pm. */
export function mealAt(hhmm: string): Meal {
  const h = Number(hhmm.slice(0, 2));
  if (!(h >= 4) || h >= 23) return "SNACK";
  if (h < 11) return "BREAKFAST";
  if (h < 16) return "LUNCH";
  if (h < 18) return "SNACK";
  return "DINNER";
}

export type Form = Record<string, string | string[]>;
export const EMPTY: Record<LogKind, Form> = {
  water: { ml: "" },
  food: { name: "", meal: "", kcal: "", protein: "", carbs: "", fat: "" },
  weight: { kg: "", fat: "" },
  spo2: { pct: "" },
  mood: { valence: "", moods: [] },
  symptoms: { symptoms: [] },
  period: { start: "", end: "", flow: "" },
  ovulation: { result: "" },
};

/** The form's values as the action's input, or the first problem to show. */
export function toInput(kind: LogKind, f: Form, at: string): LogInput | string {
  const s = (k: string) => f[k] as string;
  const a = (k: string) => f[k] as string[];
  switch (kind) {
    case "water": {
      // Typed in the person's units (a whole number of ml or fl oz), kept as whole millilitres.
      const typed = num(s("ml"));
      const q = quantity("ml");
      return typed && Number.isInteger(typed) ? { kind, ml: Math.round(q.stored(typed)), at } : `Enter the amount in ${unitWord(q.unit)}.`;
    }
    case "food": {
      const [kcal, protein, carbs, fat] = ["kcal", "protein", "carbs", "fat"].map((k) => num(s(k)));
      if (!s("meal")) return "Choose a meal.";
      if (kcal == null || Number.isNaN(kcal) || !Number.isInteger(kcal)) return "Enter calories as a whole number.";
      if ([protein, carbs, fat].some((g) => Number.isNaN(g))) return "Macros are grams, as numbers.";
      return { kind, name: s("name"), meal: s("meal") as never, kcal, protein, carbs, fat, at };
    }
    case "weight": {
      // Typed in the person's units, kept in kg.
      const typed = num(s("kg"));
      const fatPct = num(s("fat"));
      const q = quantity("kg");
      if (typed == null || Number.isNaN(typed)) return `Enter your weight in ${unitWord(q.unit)}.`;
      if (Number.isNaN(fatPct)) return "Body fat is a percentage, as a number.";
      return { kind, kg: q.stored(typed), fatPct, at };
    }
    case "spo2": {
      const pct = num(s("pct"));
      return pct == null || Number.isNaN(pct) ? "Enter blood oxygen as a percentage, e.g. 95." : { kind, pct, at };
    }
    case "mood":
      return a("moods").length ? { kind, moods: a("moods") as never, valence: (s("valence") || null) as never, at } : "Choose how you feel.";
    case "symptoms":
      return a("symptoms").length ? { kind, symptoms: a("symptoms") as never, at } : "Choose a symptom.";
    case "period":
      if (!s("start") || !s("end")) return "Choose the first and last day.";
      return { kind, start: s("start"), end: s("end"), flow: (s("flow") || null) as never };
    case "ovulation":
      return s("result") ? { kind, result: s("result") as never, at } : "Choose the result.";
  }
}

// The pickers work in the device's local time; the app's wall strings are in the person's zone (the web's datetime-local
// holds a bare wall time too). A wall string is read as the device-local time with the same digits, and back.
const p2 = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DDTHH:mm` or `YYYY-MM-DD` → a Date whose device-local digits are those. */
export function wallToDate(w: string): Date {
  const [y, mo, d] = w.slice(0, 10).split("-").map(Number);
  const [h, mi] = w.length > 10 ? w.slice(11, 16).split(":").map(Number) : [0, 0];
  return new Date(y, mo - 1, d, h, mi);
}
export const dateToWall = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const dateToDay = (d: Date) => dateToWall(d).slice(0, 10);
