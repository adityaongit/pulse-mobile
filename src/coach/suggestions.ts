// The starter questions on an empty chat, ported from Pulse's src/server/coach/suggestions.ts: today's signals (Recovery
// and why it is missing, HRV against the 30 days before today, last night's sleep, Strain against today's target).
import { suggestionsFor } from "@/core/algorithms/coachSuggestions";
import { i18n } from "@/i18n/config";
import { addDays } from "@/lib/time";
import { loadDays, priorStats, todayOf, dayStrainOf, type QueryCtx } from "@/queries/common";
import { generateNano, cancelNano } from "../../modules/pulse-nano";
import { generateId } from "ai";
import { getActivities } from "@/queries/activities";
import { getFitness } from "@/queries/health";
import { getNutrition } from "@/queries/nutrition";
import { NO_CUSTOM } from "@/nutrition/targets";

const nanoCache = new Map<string, string[]>();
let cancelSuggestions: (() => void) | undefined;
export const interruptNanoSuggestions = () => cancelSuggestions?.();

export async function nanoSuggestions(ctx: QueryCtx, signal: AbortSignal): Promise<string[]> {
  const today = todayOf(ctx);
  const rows = await loadDays(ctx, today, today);
  const row = rows.get(today);
  const [activities, fitness, nutrition] = await Promise.all([getActivities(1, ctx), getFitness(ctx), getNutrition(ctx, NO_CUSTOM)]);
  const topics = [
    row?.recovery?.value == null ? "Why is my recovery score unavailable today?" : `What does my recovery of ${Math.round(row.recovery.value)}% mean for today?`,
    row?.sleep?.main?.asleepMin == null ? "What sleep data is available today?" : `How does ${Math.round(row.sleep.main.asleepMin)} minutes of sleep affect today?`,
    dayStrainOf(row?.s1) == null ? "What should I consider before training today?" : `How should I pace myself with today's strain of ${Math.round(dayStrainOf(row?.s1)!)}?`,
  ];
  const activityCount = activities.groups.flatMap((g) => g.items).filter((a) => a.kind === "activity").length;
  const candidates = [...topics,
    activityCount ? `What should I consider after today's ${activityCount} workouts?` : "How could I fit some movement into today?",
    fitness.vo2.value ? `What does my current fitness estimate mean for my training?` : "What data would help estimate my fitness?",
    "What do my logged meals tell me about today's nutrition?",
  ];
  const rotation = Math.floor(Date.parse(today) / 86400000) % candidates.length;
  const fallback = [0, 1, 2].map((offset) => candidates[(rotation + offset) % candidates.length]);
  const context = JSON.stringify(nutrition, (key, value) => ["entries", "meals", "points", "days"].includes(key) ? undefined : typeof value === "number" ? Math.round(value * 10) / 10 : value).slice(0, 1800);
  const key = JSON.stringify([today, i18n.language, candidates, context]);
  const cached = nanoCache.get(key);
  if (cached) return cached;
  const id = generateId();
  const cancel = () => cancelNano(id);
  cancelSuggestions?.();
  cancelSuggestions = cancel;
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 20000);
  try {
    if (signal.aborted) return fallback;
    const answer = await generateNano(`Choose three distinct useful questions for today in ${i18n.language}, one per line. Consider recovery, sleep, strain, today's workouts, fitness and logged nutrition. Use the candidate topics and nutrition context below. Rephrase naturally without inventing facts, diagnoses or numbers. Do not infer missing logs mean no food eaten. Keep missing measurements unavailable. No JSON or explanation.\nCandidates:\n${candidates.join("\n")}\nNutrition context: ${context}`, 160, id);
    const lines = answer.trim().split(/\n+/).map((s) => s.replace(/^\s*[-*\d.)]+\s*/, "").trim());
    const valid = lines.length === 3 && new Set(lines).size === 3 && lines.every((s) => s.length > 12 && s.length < 140 && !/[{}\[\]\d]/.test(s) && /[?？]$/.test(s));
    const result = valid ? lines : fallback;
    if (!signal.aborted) {
      nanoCache.clear();
      nanoCache.set(key, result);
    }
    return result;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    if (cancelSuggestions === cancel) cancelSuggestions = undefined;
  }
}

export async function coachSuggestions(ctx: QueryCtx) {
  const today = todayOf(ctx);
  const rows = await loadDays(ctx, addDays(today, -30), today);
  const row = rows.get(today);
  const target = row?.strainTarget;
  const list = suggestionsFor({
    recovery: row?.recovery?.value ?? null,
    provisional: row?.recovery?.provisional ?? false,
    reason: row?.recovery?.reason === "band_not_worn" ? "awaiting_sleep_sync" : (row?.recovery?.reason ?? null),
    hrv: row?.metrics?.hrvMs ?? null,
    hrvBaseline: priorStats(rows, today, (r) => r.metrics?.hrvMs).mean,
    asleepMinutes: row?.sleep?.main?.asleepMin ?? null,
    strain: dayStrainOf(row?.s1),
    targetHigh: target?.reason === null ? target.high : null,
  });
  return list.map((s) => ({ key: s.key, text: i18n.t(`coach:suggestions.${s.code}`) }));
}
