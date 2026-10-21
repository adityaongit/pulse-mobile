// The starter questions on an empty chat, ported from Pulse's src/server/coach/suggestions.ts: today's signals (Recovery
// and why it is missing, HRV against the 30 days before today, last night's sleep, Strain against today's target).
import { suggestionsFor } from "@/core/algorithms/coachSuggestions";
import { i18n } from "@/i18n/config";
import { addDays } from "@/lib/time";
import { loadDays, priorStats, todayOf, dayStrainOf, type QueryCtx } from "@/queries/common";

/** The core returns English wording; each known sentence maps to its key, so the screen shows the app language. */
const KEYS: Record<string, string> = {
  "Today's brief": "brief",
  "What can I do while last night's sleep syncs?": "sync",
  "How should I train while my Recovery is provisional?": "recoveryProvisional",
  "What easy activity makes sense today?": "trainEasy",
  "How should I keep today's training controlled?": "trainControlled",
  "How hard can I train within today's target?": "trainHard",
  "Have I done enough activity today?": "strain",
  "Why is my HRV below my usual range?": "hrv",
  "I slept poorly. How can I recover today?": "sleepPoor",
  "How can I improve tonight's sleep?": "sleepTonight",
  "What's shaping my Recovery?": "recoveryShaping",
  "How should I plan today's training?": "trainPlan",
};

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
  return list.map((s) => (KEYS[s.text] ? { ...s, text: i18n.t(`coach:suggestions.${KEYS[s.text]}` as "coach:suggestions.brief") } : s));
}
