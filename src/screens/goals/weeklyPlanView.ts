// The Weekly Plan sheet's words (src/screens/goals/WeeklyPlan.tsx; halo src/screens/home/weeklyPlanView.ts): value and
// target text, the status word and its DeltaMark, the line under each target, and Pulse Age's years. Pure, so it is tested without React.
import { i18n } from "@/i18n/config";
import type { PlanStatus } from "@/core/algorithms/weeklyPlan";
import type { DeltaDir, Tone } from "@/lib/bands";
import { formatValue, MISSING, NBSP } from "@/lib/format";
import type { PlanRow } from "@/queries/weeklyPlan";

/** Each status's word and its DeltaMark, as KeyStatRow marks a value: done up and good, behind and missed down and bad, on pace a grey dot, no data none. The word is a getter: it resolves when read. */
export const PLAN_STATUS: Record<PlanStatus, { word: string; mark: { dir: DeltaDir; tone: Tone } | null }> = {
  done: { get word() { return i18n.t("goals:planStatus.done"); }, mark: { dir: "up", tone: "good" } },
  on_pace: { get word() { return i18n.t("goals:planStatus.onPace"); }, mark: { dir: "flat", tone: "neutral" } },
  behind: { get word() { return i18n.t("goals:planStatus.behind"); }, mark: { dir: "down", tone: "bad" } },
  missed: { get word() { return i18n.t("goals:planStatus.missed"); }, mark: { dir: "down", tone: "bad" } },
  no_data: { get word() { return i18n.t("goals:planStatus.noData"); }, mark: null },
};

type Row = Pick<PlanRow, "key" | "value" | "target" | "format" | "status" | "expected" | "streak">;

/** The week's value so far: "80", "7,500", "--". */
export const planValueText = (it: Pick<Row, "value" | "format">) => (it.value === null ? MISSING : formatValue(it.format, it.value));

/** "of 150 min", "of 2 sessions", "of 8,000", "of 80%", "of 5 nights". */
export function planTargetText(it: Pick<Row, "key" | "target" | "format">): string {
  const value = formatValue(it.format, it.target);
  switch (it.key) {
    case "zone13":
    case "zone45":
      return i18n.t("goals:planTarget.minutes", { value });
    case "strength":
      return i18n.t("goals:planTarget.sessions", { count: it.target, value: formatValue("grouped", it.target) });
    case "consistency":
      return i18n.t("goals:planTarget.percent", { value });
    case "sleepNeed":
      return i18n.t("goals:planTarget.nights", { count: it.target, value: formatValue("grouped", it.target) });
    default:
      return i18n.t("goals:planTarget.plain", { value });
  }
}

/** What is left to the target, in the target's words: "70 min", "1 session", "500 steps a day", "2 points", "3 nights". */
function leftText(it: Row, left: number): string {
  const count = Math.ceil(left);
  const value = formatValue("grouped", count);
  switch (it.key) {
    case "zone13":
    case "zone45":
      return i18n.t("goals:planLeft.minutes", { value: count });
    case "strength":
      return i18n.t("goals:planLeft.sessions", { count, value });
    case "steps":
      return i18n.t("goals:planLeft.steps", { count, value });
    case "consistency":
      return i18n.t("goals:planLeft.points", { count, value });
    case "sleepNeed":
      return i18n.t("goals:planLeft.nights", { count, value });
  }
}

/** The line under a target: how it stands, what is left, and its streak of weeks. */
export function planCaption(it: Row): string {
  const n = it.streak.current;
  const left = it.value === null ? it.target : Math.max(0, it.target - it.value);
  switch (it.status) {
    case "done":
      return n > 1 ? i18n.t("goals:planCaption.doneStreak", { count: n }) : i18n.t("goals:planCaption.done");
    case "on_pace":
      return n > 0 ? i18n.t("goals:planCaption.onPaceStreak", { left: leftText(it, left), count: n }) : i18n.t("goals:planCaption.onPace", { left: leftText(it, left) });
    case "behind":
      // Totals: how far under an even pace; averages and counts: how far from the target.
      if ((it.key === "zone13" || it.key === "zone45") && it.expected !== null) return i18n.t("goals:planCaption.behindPace", { left: leftText(it, it.expected - (it.value ?? 0)) });
      return i18n.t(it.key === "steps" || it.key === "consistency" ? "goals:planCaption.short" : "goals:planCaption.toGo", { left: leftText(it, left) });
    case "missed":
      return it.streak.longest > 1 ? i18n.t("goals:planCaption.missedBest", { count: it.streak.longest }) : i18n.t("goals:planCaption.missed");
    case "no_data":
      return i18n.t("goals:planCaption.noData");
  }
}

/** Pulse Age's years for the habit: "−0.6 yr", "+1.2 yr"; null without a Pulse Age. Negative is younger (good). */
export function ageText(years: number | null): string | null {
  if (years === null) return null;
  const r = Math.round(years * 10) / 10;
  if (r === 0) return `0.0${NBSP}yr`;
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}${NBSP}yr`;
}
