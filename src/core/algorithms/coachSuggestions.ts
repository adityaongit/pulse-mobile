import type { ReasonCode } from "@/lib/reasons";

/** The wording lives in `coach:suggestions.<code>`. */
export type SuggestionCode = "brief" | "sync" | "recoveryProvisional" | "trainEasy" | "trainControlled" | "trainHard" | "strain" | "hrv" | "sleepPoor" | "sleepTonight" | "recoveryShaping" | "trainPlan";
export type CoachSuggestion = { key: "brief" | "recovery" | "training" | "hrv" | "sleep" | "strain" | "sync"; code: SuggestionCode };
export type SuggestionSignals = {
  recovery: number | null;
  provisional: boolean;
  reason: ReasonCode | null;
  hrv: number | null;
  hrvBaseline: number | null;
  asleepMinutes: number | null;
  strain: number | null;
  targetHigh: number | null;
};

export function suggestionsFor(s: SuggestionSignals): CoachSuggestion[] {
  const out: CoachSuggestion[] = [{ key: "brief", code: "brief" }];
  if (s.reason === "awaiting_sleep_sync") out.push({ key: "sync", code: "sync" });
  else if (s.reason === "calibrating" || s.provisional) out.push({ key: "recovery", code: "recoveryProvisional" });
  else if (s.recovery !== null) out.push({ key: "training", code: s.recovery < 34 ? "trainEasy" : s.recovery < 67 ? "trainControlled" : "trainHard" });
  if (s.strain !== null && (s.targetHigh !== null ? s.strain >= s.targetHigh : s.strain >= 67)) out.push({ key: "strain", code: "strain" });
  if (s.hrv !== null && s.hrvBaseline !== null && s.hrvBaseline > 0 && s.hrv < s.hrvBaseline * 0.85) out.push({ key: "hrv", code: "hrv" });
  if (s.asleepMinutes !== null && s.asleepMinutes < 360) out.push({ key: "sleep", code: "sleepPoor" });
  for (const item of [{ key: "sleep", code: "sleepTonight" }, { key: "recovery", code: "recoveryShaping" }, { key: "training", code: "trainPlan" }] as CoachSuggestion[]) {
    if (!out.some((s) => s.key === item.key)) out.push(item);
  }
  return out.slice(0, 4);
}
