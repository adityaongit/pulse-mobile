// Garmin-style training answers (version 19): Training Readiness, Recovery Time and Training Status for the Activity tab,
// each workout's Training Effect for its Activity screen, and HRV Status for the Health tab. Each is Halo's own
// implementation of Garmin's published method (src/core/algorithms: trainingReadiness.ts, trainingEffect.ts,
// trainingStatus.ts, hrvStatus.ts); these turn the stored rows into what the cards show.
import type { ChipTone } from "@/lib/bands";
import type { Metric } from "@/lib/reasons";
import { addDays } from "@/lib/time";
import type { HrvStatusRow, TrainingRow, TrainingSession } from "@/pipeline/types";
import type { ReadinessBand, ReadinessFactorKey } from "@/core/algorithms/trainingReadiness";
import type { TrainingStatusKind } from "@/core/algorithms/trainingStatus";
import type { PrimaryBenefit, TeLabel } from "@/core/algorithms/trainingEffect";
import { hrvStatusConfig } from "@/core/algorithms/hrvStatus";
import { fromReason, loadDays, ms, none, ok, type QueryCtx, todayOf } from "./common";
import type { TimePoint } from "./types";

// ── Words ────────────────────────────────────────────────────────────────────

export const READINESS_WORD: Record<ReadinessBand, string> = { prime: "Prime", high: "High", moderate: "Moderate", low: "Low", poor: "Poor" };
export const READINESS_TONE: Record<ReadinessBand, ChipTone> = { prime: "optimal", high: "optimal", moderate: "neutral", low: "warning", poor: "alert" };
export const FACTOR_LABEL: Record<ReadinessFactorKey, string> = {
  sleep: "Last night’s sleep",
  recoveryTime: "Recovery time",
  hrv: "HRV status",
  load: "Load ratio",
  sleepHistory: "Sleep, last 3 nights",
  stressHistory: "Stress, last 3 days",
};
const LIMIT_LINE: Record<ReadinessFactorKey, string> = {
  sleep: "Last night’s sleep is holding it back.",
  recoveryTime: "Your body is still recovering from recent training.",
  hrv: "Your HRV is off your usual range.",
  load: "Your recent load is high for you.",
  sleepHistory: "Your sleep over the last few nights is holding it back.",
  stressHistory: "Stress over the last few days is holding it back.",
};

export const STATUS_WORD: Record<TrainingStatusKind, string> = {
  productive: "Productive",
  maintaining: "Maintaining",
  recovery: "Recovery",
  peaking: "Peaking",
  unproductive: "Unproductive",
  overreaching: "Overreaching",
  strained: "Strained",
  detraining: "Detraining",
};
export const STATUS_TONE: Record<TrainingStatusKind, ChipTone> = {
  productive: "optimal",
  peaking: "optimal",
  maintaining: "neutral",
  recovery: "neutral",
  unproductive: "warning",
  strained: "warning",
  detraining: "warning",
  overreaching: "alert",
};
const STATUS_LINE: Record<TrainingStatusKind, string> = {
  productive: "Your training is building fitness.",
  maintaining: "Your training keeps your fitness where it is; more load would build it.",
  recovery: "A lighter stretch lets your body recover, ready for harder work.",
  peaking: "Fitness is up while load eases: good timing for a race or a test.",
  unproductive: "Load is steady but fitness is slipping. Check your sleep, stress and recovery.",
  overreaching: "Load is very high and is starting to cost you. Ease off.",
  strained: "Your HRV is low under this load: your body is struggling to recover.",
  detraining: "Training is well below your usual, so fitness will slowly fall.",
};

export const TE_WORD: Record<TeLabel, string> = {
  no_benefit: "No benefit",
  minor: "Minor",
  maintaining: "Maintaining",
  improving: "Improving",
  highly_improving: "Highly improving",
  overreaching: "Overreaching",
};
export const TE_TONE: Record<TeLabel, ChipTone> = {
  no_benefit: "neutral",
  minor: "neutral",
  maintaining: "neutral",
  improving: "optimal",
  highly_improving: "optimal",
  overreaching: "warning",
};
export const BENEFIT_WORD: Record<PrimaryBenefit, string> = { recovery: "Recovery", base: "Base", tempo: "Tempo", threshold: "Threshold", vo2max: "VO2 max" };
const BENEFIT_LINE: Record<PrimaryBenefit, string> = {
  recovery: "Light work that helps you recover.",
  base: "Steady aerobic work that builds your base.",
  tempo: "Harder aerobic work that lifts your endurance.",
  threshold: "Sustained hard work that raises the pace you can hold.",
  vo2max: "Hard efforts that raise your aerobic ceiling.",
};

export const HRV_WORD = { balanced: "Balanced", unbalanced: "Unbalanced", low: "Low" } as const;
export const HRV_TONE = { balanced: "optimal", unbalanced: "warning", low: "alert" } as const satisfies Record<keyof typeof HRV_WORD, ChipTone>;

// ── View models ──────────────────────────────────────────────────────────────

export type TrainingReadinessVM = {
  score: number;
  band: string;
  tone: ChipTone;
  /** This morning's score, before today's training. */
  atWake: number | null;
  line: string;
  /** Each factor 0–100 (null: missing, its weight shared). */
  factors: { key: ReadinessFactorKey; label: string; value: number | null }[];
};
export type RecoveryTimeVM = { hours: number; atWake: number; /** Epoch ms when it reaches 0, at a steady countdown. */ readyAt: number | null };
export type TrainingStatusVM = {
  status: string;
  tone: ChipTone;
  line: string;
  loadRatio: number | null;
  vo2PerMonth: number | null;
  hrv: string | null;
};
export type TrainingVM = {
  day: string;
  isToday: boolean;
  readiness: Metric<TrainingReadinessVM>;
  recoveryTime: Metric<RecoveryTimeVM>;
  status: Metric<TrainingStatusVM>;
};

export type TrainingEffectVM = {
  te: number;
  label: string;
  tone: ChipTone;
  benefit: string;
  benefitLine: string;
  /** Hours of Recovery Time this workout added on its own. */
  recoveryHours: number;
  epoc: number;
};

export type HrvStatusVM = {
  status: string;
  tone: ChipTone;
  /** Unbalanced: above or below the band. */
  direction: "high" | "low" | null;
  lastNight: number | null;
  weekAverage: number;
  band: { low: number; high: number };
  lowLine: number;
  line: string;
  /** The last 28 nights' HRV, ms. */
  nights: TimePoint[];
};

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The Activity tab's training card: readiness, recovery time and status for `day`. */
export async function getTraining(day: string, ctx: QueryCtx): Promise<TrainingVM> {
  const today = todayOf(ctx);
  const isToday = day === today;
  const row = (await loadDays(ctx, day, day)).get(day);
  const t = row?.training ?? null;
  return {
    day,
    isToday,
    readiness: readinessVM(t, isToday),
    recoveryTime: recoveryTimeVM(t, isToday),
    status: statusVM(t, row?.hrvStatus ?? null, row?.trainingLoad?.acwr ?? null, isToday),
  };
}

export function readinessVM(t: TrainingRow | null, isToday: boolean): Metric<TrainingReadinessVM> {
  if (!t) return fromReason(null, isToday);
  const r = t.readiness;
  if (r.reason !== null) return none(r.reason);
  return ok({
    score: r.score,
    band: READINESS_WORD[r.band],
    tone: READINESS_TONE[r.band],
    atWake: r.atWake?.score ?? null,
    line: r.limiting ? LIMIT_LINE[r.limiting] : r.longDay ? "A very long day awake before last night holds it back." : "Everything that feeds it is in good shape.",
    factors: (Object.keys(FACTOR_LABEL) as ReadinessFactorKey[]).map((key) => ({ key, label: FACTOR_LABEL[key], value: r.factors[key] == null ? null : Math.round(r.factors[key]!) })),
  });
}

export function recoveryTimeVM(t: TrainingRow | null, isToday: boolean): Metric<RecoveryTimeVM> {
  if (!t) return fromReason(null, isToday);
  const rt = t.recoveryTime;
  return ok({ hours: round1(rt.now), atWake: round1(rt.atWake), readyAt: rt.now > 0 ? ms(rt.until + rt.now * 3600) : null });
}

export function statusVM(t: TrainingRow | null, hrv: HrvStatusRow | null, loadRatio: number | null, isToday: boolean): Metric<TrainingStatusVM> {
  if (!t) return fromReason(null, isToday);
  const s = t.status;
  if (s.reason !== null) return none(s.reason);
  return ok({
    status: STATUS_WORD[s.status],
    tone: STATUS_TONE[s.status],
    line: STATUS_LINE[s.status],
    loadRatio: loadRatio == null ? null : Math.round(loadRatio * 100) / 100,
    vo2PerMonth: s.vo2PerMonth == null ? null : round1(s.vo2PerMonth),
    hrv: hrv?.status ? HRV_WORD[hrv.status] : null,
  });
}

/** A workout's Training Effect, from its day's training row; null without one (too little heart rate, or an older row). */
export function trainingEffectVM(t: TrainingRow | null | undefined, id: string): TrainingEffectVM | null {
  const s: TrainingSession | undefined = t?.sessions.find((x) => x.id === id);
  if (!s) return null;
  return { te: s.te, label: TE_WORD[s.label], tone: TE_TONE[s.label], benefit: BENEFIT_WORD[s.benefit], benefitLine: BENEFIT_LINE[s.benefit], recoveryHours: s.recoveryHours, epoc: s.epoc };
}

/** The Health tab's HRV Status card for `day`, with its last 28 nights. */
export async function getHrvStatus(day: string, ctx: QueryCtx): Promise<Metric<HrvStatusVM>> {
  const isToday = day === todayOf(ctx);
  const rows = await loadDays(ctx, addDays(day, -27), day);
  const h = rows.get(day)?.hrvStatus ?? null;
  if (!h) return fromReason(null, isToday);
  if (h.status === null) return none("calibrating", h.reason === "building" ? Math.max(1, hrvStatusConfig.minBaselineNights - h.baselineNights) : undefined);
  const nights = [...rows.values()].map((r) => ({ t: ms(Date.parse(`${r.day}T12:00:00Z`) / 1000), v: r.metrics?.hrvMs ?? null }));
  const line =
    h.status === "balanced"
      ? "Your 7-day average sits in your usual range."
      : h.status === "low"
        ? "Your 7-day average is well below your usual range: often a sign of strain, illness or poor sleep."
        : h.direction === "high"
          ? "Your 7-day average is above your usual range."
          : "Your 7-day average is a little below your usual range.";
  return ok({
    status: HRV_WORD[h.status],
    tone: HRV_TONE[h.status],
    direction: h.direction,
    lastNight: h.lastNight,
    weekAverage: h.weekAverage,
    band: h.band,
    lowLine: h.lowLine,
    line,
    nights,
  });
}
