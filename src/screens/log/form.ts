// The log sheets' form state and its translation to the log action's input: the pure half of pulse's
// (app)/journal/Log.tsx (EMPTY, toInput, num, wallNow), unchanged, so it is tested in Node (form.test.ts).
import type { LogInput } from "@/actions/log";
import type { LogKind } from "@/lib/log";
import { wall } from "../../time";

const NUM = /^\d+([.,]\d+)?$/;

/** The wall clock now in the person's zone, as `YYYY-MM-DDTHH:mm` (what the web's datetime-local input holds). */
export const wallNow = (timeZone: string, now = Math.floor(Date.now() / 1000)) => {
  const w = wall(now, timeZone);
  return `${w.day}T${w.time.slice(0, 5)}`;
};

/** A past day logs at noon of that day by default; today at the time it is. */
export const defaultAt = (vm: { day: string; today: string; timeZone: string }) => (vm.day === vm.today ? wallNow(vm.timeZone) : `${vm.day}T12:00`);

export const num = (s: string) => (s.trim() === "" ? null : NUM.test(s.trim()) ? Number(s.trim().replace(",", ".")) : NaN);

export type Form = Record<string, string | string[]>;
export const EMPTY: Record<LogKind, Form> = {
  water: { ml: "" },
  food: { name: "", meal: "", kcal: "", protein: "", carbs: "", fat: "" },
  weight: { kg: "", fat: "" },
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
      const ml = num(s("ml"));
      return ml && Number.isInteger(ml) ? { kind, ml, at } : "Enter the amount in millilitres.";
    }
    case "food": {
      const [kcal, protein, carbs, fat] = ["kcal", "protein", "carbs", "fat"].map((k) => num(s(k)));
      if (!s("meal")) return "Choose a meal.";
      if (kcal == null || Number.isNaN(kcal) || !Number.isInteger(kcal)) return "Enter calories as a whole number.";
      if ([protein, carbs, fat].some((g) => Number.isNaN(g))) return "Macros are grams, as numbers.";
      return { kind, name: s("name"), meal: s("meal") as never, kcal, protein, carbs, fat, at };
    }
    case "weight": {
      const kg = num(s("kg"));
      const fatPct = num(s("fat"));
      if (kg == null || Number.isNaN(kg)) return "Enter your weight in kilograms.";
      if (Number.isNaN(fatPct)) return "Body fat is a percentage, as a number.";
      return { kind, kg, fatPct, at };
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
