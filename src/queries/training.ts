// Garmin-style training answers (version 19): Training Readiness, Recovery Time and Training Status for the Activity tab,
// each workout's Training Effect for its Activity screen, and HRV Status for the Health tab. Each is Halo's own
// implementation of Garmin's published method (src/core/algorithms: trainingReadiness.ts, trainingEffect.ts,
// trainingStatus.ts, hrvStatus.ts); these turn the stored rows into what the cards show.
import { i18n } from "@/i18n/config";
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

/** A record whose words resolve when read (the language can change after import). */
const getters = <K extends string>(keys: readonly K[], word: (k: K) => string): Record<K, string> =>
  Object.defineProperties({}, Object.fromEntries(keys.map((k) => [k, { get: () => word(k), enumerable: true }]))) as Record<K, string>;
const keysOf = <K extends string>(o: Record<K, unknown>) => Object.keys(o) as K[];

export const READINESS_TONE: Record<ReadinessBand, ChipTone> = { prime: "optimal", high: "optimal", moderate: "neutral", low: "warning", poor: "alert" };
export const READINESS_WORD = getters(keysOf(READINESS_TONE), (k) => i18n.t(`strain:readinessBand.${k}`));
export const FACTOR_LABEL = getters<ReadinessFactorKey>(["sleep", "recoveryTime", "hrv", "load", "sleepHistory", "stressHistory"], (k) => i18n.t(`strain:readinessFactor.${k}`));

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
export const STATUS_WORD = getters(keysOf(STATUS_TONE), (k) => i18n.t(`strain:statusWord.${k}`));

/** The Training Effect labels' keys in the strain namespace. */
const TE_KEY = { no_benefit: "noBenefit", minor: "minor", maintaining: "maintaining", improving: "improving", highly_improving: "highlyImproving", overreaching: "overreaching" } as const satisfies Record<TeLabel, string>;
export const TE_TONE: Record<TeLabel, ChipTone> = {
  no_benefit: "neutral",
  minor: "neutral",
  maintaining: "neutral",
  improving: "optimal",
  highly_improving: "optimal",
  overreaching: "warning",
};
export const TE_WORD = getters(keysOf(TE_TONE), (k) => i18n.t(`strain:teWord.${TE_KEY[k]}`));
export const BENEFIT_WORD = getters<PrimaryBenefit>(["recovery", "base", "tempo", "threshold", "vo2max"], (k) => i18n.t(`strain:benefitWord.${k}`));

export const HRV_TONE = { balanced: "optimal", unbalanced: "warning", low: "alert" } as const satisfies Record<"balanced" | "unbalanced" | "low", ChipTone>;
export const HRV_WORD = getters(keysOf(HRV_TONE), (k) => i18n.t(`strain:hrvWord.${k}`));

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
    line: r.limiting ? i18n.t(`strain:readinessLimit.${r.limiting}`) : r.longDay ? i18n.t("strain:readinessLongDay") : i18n.t("strain:readinessAllGood"),
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
    line: i18n.t(`strain:statusLine.${s.status}`),
    loadRatio: loadRatio == null ? null : Math.round(loadRatio * 100) / 100,
    vo2PerMonth: s.vo2PerMonth == null ? null : round1(s.vo2PerMonth),
    hrv: hrv?.status ? HRV_WORD[hrv.status] : null,
  });
}

/** A workout's Training Effect, from its day's training row; null without one (too little heart rate, or an older row). */
export function trainingEffectVM(t: TrainingRow | null | undefined, id: string): TrainingEffectVM | null {
  const s: TrainingSession | undefined = t?.sessions.find((x) => x.id === id);
  if (!s) return null;
  return { te: s.te, label: TE_WORD[s.label], tone: TE_TONE[s.label], benefit: BENEFIT_WORD[s.benefit], benefitLine: i18n.t(`strain:benefitLine.${s.benefit}`), recoveryHours: s.recoveryHours, epoc: s.epoc };
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
      ? i18n.t("strain:hrvLine.balanced")
      : h.status === "low"
        ? i18n.t("strain:hrvLine.low")
        : h.direction === "high"
          ? i18n.t("strain:hrvLine.high")
          : i18n.t("strain:hrvLine.belowRange");
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
