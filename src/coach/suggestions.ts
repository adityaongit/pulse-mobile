// The starter questions on an empty chat, ported from Pulse's src/server/coach/suggestions.ts: today's signals (Recovery
// and why it is missing, HRV against the 30 days before today, last night's sleep, Strain against today's target).
import { suggestionsFor } from "@/core/algorithms/coachSuggestions";
import { i18n } from "@/i18n/config";
import { addDays } from "@/lib/time";
import { loadDays, priorStats, todayOf, dayStrainOf, type QueryCtx } from "@/queries/common";
import { generateNano, cancelNano } from "../../modules/pulse-nano";
import { generateId } from "ai";

const nanoCache = new Map<string, string[]>();
let cancelSuggestions: (() => void) | undefined;
export const interruptNanoSuggestions = () => cancelSuggestions?.();

export async function nanoSuggestions(ctx: QueryCtx, signal: AbortSignal): Promise<string[]> {
  const today = todayOf(ctx);
  const rows = await loadDays(ctx, today, today);
  const row = rows.get(today);
  const topics = [
    row?.recovery?.value == null ? "Why is my recovery score unavailable today?" : `What does my recovery of ${Math.round(row.recovery.value)}% mean for today?`,
    row?.sleep?.main?.asleepMin == null ? "What sleep data is available today?" : `How does ${Math.round(row.sleep.main.asleepMin)} minutes of sleep affect today?`,
    dayStrainOf(row?.s1) == null ? "What should I consider before training today?" : `How should I pace myself with today's strain of ${Math.round(dayStrainOf(row?.s1)!)}?`,
  ];
  const key = JSON.stringify([today, i18n.language, topics]);
  const cached = nanoCache.get(key);
  if (cached) return cached;
  const id = generateId();
  const cancel = () => cancelNano(id);
  cancelSuggestions?.();
  cancelSuggestions = cancel;
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 20000);
  try {
    if (signal.aborted) return topics;
    const answer = await generateNano(`Write exactly three short questions in ${i18n.language}, one per line. Rephrase these questions without adding facts, diagnoses or numbers. Keep unavailable measurements unavailable. No JSON or explanation.\n${topics.join("\n")}`, 160, id);
    const lines = answer.trim().split(/\n+/).map((s) => s.replace(/^\s*[-*\d.)]+\s*/, "").trim());
    const valid = lines.length === 3 && new Set(lines).size === 3 && lines.every((s) => s.length > 12 && s.length < 140 && !/[{}\[\]\d]/.test(s) && /[?？]$/.test(s));
    const result = valid ? lines : topics;
    if (!signal.aborted) {
      nanoCache.clear();
      nanoCache.set(key, result);
    }
    return result;
  } catch {
    return topics;
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
