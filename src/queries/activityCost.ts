// Mobile: Activity Cost and detected activities for the Activities and Activity screens, Insights and the coach. Activity
// Cost is stage 2's stored result (src/core/algorithms/activityCost.ts) with the screens' names; the wording lives here
// so every surface says the same thing.
import { i18n } from "@/i18n/config";
import { activityCostConfig, barelyMoves } from "@/core/algorithms/activityCost";
import type { DetectedActivity, DetectedKind } from "@/core/algorithms/autoWorkout";
import { ACTIVITY_NAME, ms, type QueryCtx } from "./common";
import { FORMATS } from "./_lib";
import type { ActivityCostEntry, ActivityCostVM, ActivityKind, DetectedItem } from "./types";

/** Every kind's Activity Cost, measured kinds first; null before stage 2 has stored one. */
export async function getActivityCost(ctx: QueryCtx): Promise<ActivityCostVM | null> {
  const r = await ctx.store.getActivityCost();
  if (!r) return null;
  return {
    baseline: r.baseline,
    baselineKind: r.baselineKind,
    minSessions: activityCostConfig.minSessions,
    items: r.items.map((i) => ({ ...i, kind: i.kind as ActivityKind, name: ACTIVITY_NAME[i.kind as ActivityKind] ?? ACTIVITY_NAME.workout })),
  };
}

/** "4 runs", "1 strength session": a count of one kind. */
const kindCount = (kind: ActivityKind, count: number) => i18n.t(`strain:costKind.${kind}`, { count });
const gerund = (kind: ActivityKind) => i18n.t(`strain:costGerund.${kind}`);
const against = (kind: ActivityCostVM["baselineKind"]) => i18n.t(`strain:costAgainst.${kind}`);

/** "−8%", "+3%": the change in next-morning Recovery; null when not measured. */
export const costValue = (e: ActivityCostEntry) => (e.reason === null ? `${FORMATS.signedInt(e.change)}%` : null);

/** Which way the change goes, for its colour: a cost, a lift, or barely any. */
export const costTone = (e: ActivityCostEntry): "cost" | "lift" | "flat" =>
  e.reason !== null || barelyMoves(e.change) ? "flat" : e.change < 0 ? "cost" : "lift";

/** The bounce-back: "Back in about 2 days", or what the change means when there is nothing to bounce back from. */
export function bounceText(e: ActivityCostEntry): string {
  if (e.reason !== null) return i18n.t("strain:bounce.notEnough");
  if (barelyMoves(e.change)) return i18n.t("strain:bounce.barely");
  if (e.change > 0) return i18n.t("strain:bounce.higher");
  if (e.daysToBaseline === null) return i18n.t("strain:bounce.notBack");
  return i18n.t("strain:bounce.back", { count: e.daysToBaseline });
}

/** The row caption: the bounce-back and how many workouts it rests on, or how many more it needs. */
export function costCaption(e: ActivityCostEntry, minSessions: number): string {
  if (e.reason !== null) return i18n.t("strain:costCaption.notEnough", { have: e.sessions, needed: kindCount(e.kind, minSessions) });
  return i18n.t(e.confidence === "building" ? "strain:costCaption.early" : "strain:costCaption.based", { bounce: bounceText(e), sessions: kindCount(e.kind, e.sessions) });
}

/** One plain sentence for the Activity screen and the coach. */
export function costSentence(e: ActivityCostEntry, vm: Pick<ActivityCostVM, "baselineKind" | "minSessions">): string {
  const activity = gerund(e.kind);
  if (e.reason !== null) return i18n.t("strain:costSentence.needs", { needed: kindCount(e.kind, vm.minSessions), have: e.sessions });
  const base = against(vm.baselineKind);
  if (barelyMoves(e.change)) return i18n.t("strain:costSentence.same", { activity, against: base });
  const pts = Math.round(Math.abs(e.change));
  if (e.change > 0) return i18n.t("strain:costSentence.above", { activity, pts, against: base });
  if (e.daysToBaseline === null) return i18n.t("strain:costSentence.belowOpen", { activity, pts, against: base });
  return i18n.t("strain:costSentence.belowDays", { activity, pts, against: base, count: e.daysToBaseline });
}

/** "Measured against your rest days (64%)". */
export const baselineText = (vm: Pick<ActivityCostVM, "baseline" | "baselineKind">) =>
  vm.baseline === null ? null : i18n.t("strain:costBaseline", { against: against(vm.baselineKind), value: FORMATS.int(vm.baseline) });

/** The coach's digest (get_activities): each kind's change in Recovery points and bounce-back, or why it isn't measured. */
export function costDigest(vm: ActivityCostVM) {
  return {
    unit: "Recovery percentage points",
    baseline: vm.baseline === null ? null : Math.round(vm.baseline),
    baselineIs: vm.baselineKind === "rest" ? "mean Recovery on days with no workout that day or in the 7 days before" : "mean Recovery over every day (too few rest days)",
    kinds: vm.items.map((e) =>
      e.reason === null
        ? { activity: e.name, workoutsMeasured: e.sessions, nextMorningChange: Math.round(e.change), daysToBaseline: e.daysToBaseline, confidence: e.confidence, summary: costSentence(e, vm), reason: null }
        : { activity: e.name, workoutsMeasured: e.sessions, needed: vm.minSessions, reason: e.reason },
    ),
  };
}

export const DETECTED_LABEL: Record<DetectedKind, string> = {
  get walk() {
    return i18n.t("strain:detectedKind.walk");
  },
  get run() {
    return i18n.t("strain:detectedKind.run");
  },
  get cardio() {
    return i18n.t("strain:detectedKind.cardio");
  },
};

/** A stored detected window as the screens show it. */
export const detectedItem = (d: DetectedActivity): DetectedItem => ({
  kind: d.kind,
  label: DETECTED_LABEL[d.kind],
  start: ms(d.start),
  end: ms(d.end),
  avgHr: d.avgHr,
  maxHr: d.maxHr,
  // A detected window has no engine units, so no strain on the percent scale.
  strain: null,
  steps: d.steps,
});
