// Health hub and its four detail screens (spec §7.6–7.10). Ported from Pulse's src/server/queries/health.ts.
import { fitnessLevel } from "@/core/algorithms/fitnessLevel";
import { HEALTHSPAN_TERM_COUNT, healthspanConfig, type HealthspanContribution } from "@/core/algorithms/healthspan";
import { minuteMeanHr } from "@/core/algorithms/stress";
import type { LoadStatus } from "@/core/engine/strain";
import { addDays, daysBetween, fractionalYears, localMidnight, wall } from "@/lib/time";
import { acwrTone, dayLabel, formatDay, weekOf } from "./_lib";
import {
  type DayRow,
  dayStartOf,
  finite,
  lastStored,
  loadDays,
  loadSeries,
  maxHrOf,
  meanSd,
  minutePoints,
  ms,
  nightReason,
  none,
  ok,
  type QueryCtx,
  stressNow,
  todayOf,
  vitalReason,
  trendPoints,
  daySpansOf,
  exercisesBetween,
} from "./common";
import { illnessRaised, VITAL_LABEL } from "./home";
import { zoneBounds, zoneNote, zoneRows } from "./strain";
import type {
  ChipTone,
  EcgReading,
  FitnessVM,
  HeartRhythm,
  Measurement,
  HealthHubVM,
  HealthspanContributor,
  HealthspanVM,
  HeartRateLive,
  HeartRateVM,
  Metric,
  MonitorVM,
  StressVM,
  Vital,
  VitalKey,
} from "./types";
import { metricsWithLoggedBody } from "@/data/body";

// ── Hub ─────────────────────────────────────────────────────────────────────

/** Health hub `/health`: today's values (spec §7.6). */
export async function getHealthHub(ctx: QueryCtx): Promise<HealthHubVM> {
  const today = todayOf(ctx);
  const rows = await loadDays(ctx, addDays(today, -35), today);
  const row = rows.get(today);
  const [hsVm, monitor, fit, stressSeries, heartRate] = await Promise.all([
    getHealthspan(today, ctx),
    getMonitor(today, ctx, rows),
    getFitness(ctx),
    loadSeries(ctx, today, "stress"),
    latestHr(ctx),
  ]);
  const hs = hsVm.result;
  // Healthspan updates weekly: compare the shown week's pace with the stored week before it.
  const prevDay = addDays(hsVm.asOf, -7);
  const prevHs = (await loadDays(ctx, prevDay, prevDay)).get(prevDay)?.healthspan;
  const prevPace = prevHs && prevHs.reason === null ? prevHs.paceOfAging : null;
  const st = row?.stress;
  const sameDays = [7, 14, 21, 28].map((k) => rows.get(addDays(today, -k))?.stress?.highMin).filter(finite);
  const tl = fit.trainingLoad.value;
  return {
    day: today,
    healthspan: hs.value ? ok({ pulseAge: hs.value.pulseAge, deltaYears: hs.value.deltaYears, pace: hs.value.pace, paceDelta: prevPace == null || hs.value.pace == null ? null : hs.value.pace - prevPace }, hs.provisional) : none(hs.reason ?? "no_data", hs.nightsLeft),
    monitor: monitor.count.value
      ? ok({ vitals: monitor.vitals.map((v) => ({ key: v.key, short: v.short, status: v.status })), inRange: monitor.count.value.inRange, total: VITALS.length })
      : none(monitor.count.reason ?? "no_data"),
    stress:
      st && st.average != null
        ? ok(
            {
              highMin: st.highMin,
              typicalHighMin: sameDays.length ? meanSd(sameDays).mean : null,
              weekday: formatDay(today, { weekday: "short" }),
              spark: minutePoints(stressSeries, dayStartOf(ctx, today), 2),
            },
            st.provisional,
          )
        : none(row?.s1?.hrCount ? "no_data" : "band_not_worn"),
    fitness: fit.vo2.value
      ? ok({ vo2max: fit.vo2.value.value, category: fit.vo2.value.category, percentile: fit.vo2.value.percentile, acwr: tl?.acwr ?? null, acwrTone: tl?.tone ?? null })
      : none("no_data"),
    heartRate,
  };
}

/** Alias: the task's name for the Health hub query. */
export const getHealth = getHealthHub;

/** The newest stored band reading, whenever it was. */
async function latestHr(ctx: QueryCtx) {
  const r = await ctx.store.hrBounds();
  return r ? (await hrMinutes(ctx, r.last, r.last + 1)).latest : null;
}

// ── Healthspan ──────────────────────────────────────────────────────────────

// The terms and references follow the Pulse engine's Pulse Age (src/core/engine/pulseAge.ts).
const HS_META: Record<string, Omit<HealthspanContributor, "metric" | "target" | "years" | "caption" | "key">> = {
  sleepHours: {
    group: "sleep",
    label: "Hours of sleep",
    unit: "h",
    domain: [4, 10],
    higherIsBetter: true,
    explanation: "Both short and long sleep are linked to higher mortality. Around 7.5 to 9 hours a night carries the lowest risk; 7 hours costs about half a year, 6 hours or less about 2.",
    source: "Population mortality studies",
  },
  sri: {
    group: "sleep",
    label: "Sleep consistency",
    unit: "%",
    domain: [0, 100],
    higherIsBetter: true,
    explanation: "Being asleep at the same times each day is linked to a longer life, on top of how long you sleep. The reference is a consistency of 70: below it costs years quickly, above it takes a little off. The same Sleep consistency as on the Sleep screen, averaged over the window.",
    source: "Population mortality studies",
  },
  zone13: {
    group: "strain",
    label: "Moderate activity",
    unit: "min",
    domain: [0, 300],
    higherIsBetter: true,
    explanation: "Moderate activity is linked to steeply lower mortality, with the reference at 150 minutes a week and the benefit levelling off well past it. Counted by Pulse from your heart rate in Zones 2 and 3 (60 to 80% of max heart rate), as a weekly average of the 28 days.",
    source: "Population mortality studies",
  },
  zone45: {
    group: "strain",
    label: "Heart rate zones 4-5",
    unit: "min",
    domain: [0, 150],
    higherIsBetter: true,
    explanation: "Vigorous activity adds benefit on top of moderate activity. The reference is 10 minutes a week; a little more helps, and the benefit levels off quickly. Counted from your heart rate in Zones 4 and 5.",
    source: "Population mortality studies",
  },
  strength: {
    group: "strain",
    label: "Strength activity time",
    unit: "min",
    domain: [0, 150],
    higherIsBetter: true,
    explanation: "Muscle-strengthening work (strength training, weights, calisthenics or HIIT) is linked to lower mortality. The reference is 10 minutes a week, and the benefit levels off past about 40.",
    source: "Population mortality studies",
  },
  steps: {
    group: "strain",
    label: "Daily steps",
    unit: "steps",
    domain: [0, 15000],
    higherIsBetter: true,
    explanation: "More daily steps go with lower mortality. The reference is 8,000 a day (6,000 from 60), and credit stops at 10,000 (8,000 from 60). Days without heart rate or steps are left out, so a band left on the charger isn't read as a lazy day.",
    source: "Population mortality studies",
  },
  vo2max: {
    group: "fitness",
    label: "VO2 max",
    unit: "ml/kg/min",
    domain: [15, 70],
    higherIsBetter: true,
    explanation: "Higher cardiorespiratory fitness is one of the strongest predictors of a longer life. The reference comes from a table for your age and sex; each ml/kg/min above it takes about 0.4 years off, each below adds about as much. From Fitbit's VO2 max readings.",
    source: "Population mortality studies",
  },
  restingHr: {
    group: "fitness",
    label: "Resting heart rate",
    unit: "bpm",
    domain: [40, 90],
    higherIsBetter: false,
    explanation: "A higher resting heart rate is linked to higher mortality. The reference comes from a table for your age and sex; each 10 bpm above it adds about 1.2 years.",
    source: "Population mortality studies",
  },
  leanMass: {
    group: "fitness",
    label: "Lean body mass",
    unit: "%",
    domain: [50, 95],
    higherIsBetter: true,
    explanation: "The share of your weight that isn't fat. The reference is 100 less the typical body fat for your age and sex. Falling short of it costs years, faster the further you are; from 35, beating it takes a little off, more so with age. From your body fat readings.",
    source: "Population mortality studies",
  },
};
const HS_ORDER = ["sleepHours", "sri", "zone13", "zone45", "strength", "steps", "vo2max", "restingHr", "leanMass"];

const VO2_CAPTION = { run: "Measured", daily: "Fitbit estimate", estimate: "Estimated from resting heart rate and activity" } as const;

/** Healthspan `/health/healthspan` for the ISO week containing `day` (spec §7.7). Updated weekly. */
export async function getHealthspan(day: string, ctx: QueryCtx): Promise<HealthspanVM> {
  const today = todayOf(ctx);
  const [weekStart, weekEnd] = weekOf(day);
  const [last, rows] = await Promise.all([lastStored(ctx, today), loadDays(ctx, addDays(weekEnd, -182), weekEnd)]);
  // A finished week shows its Sunday; the current week shows last Sunday until this one ends.
  const lastSunday = addDays(weekStart, -1);
  const shown = weekEnd <= last ? weekEnd : rows.get(lastSunday)?.healthspan ? lastSunday : last;
  const hs = rows.get(shown)?.healthspan;

  let result: HealthspanVM["result"];
  if (!hs) result = none("no_data");
  else if (hs.reason !== null) result = none("calibrating", Math.max(1, 20 - hs.dataDays));
  else
    result = ok(
      { pulseAge: hs.pulseAge, deltaYears: hs.deltaYears, pace: hs.paceOfAging ?? null, paceDays: hs.paceDays ?? null, paceProvisional: hs.paceProvisional, vo2maxSource: hs.vo2maxSource },
      hs.provisional,
    );

  // Only the current terms; a row stored before lean mass became a body-fat % term (no `paceDays`) leaves it out.
  const current = hs && hs.reason === null && hs.paceDays !== undefined;
  const contributions = hs && hs.reason === null ? hs.contributions.filter((c) => c.key in HS_META && (current || c.key !== "leanMass")) : [];
  const body = current ? hs.bodyComposition : null;
  const contributors: HealthspanContributor[] = HS_ORDER.map((key) => {
    const meta = HS_META[key];
    const c = contributions.find((x) => x.key === key);
    const display = (v: number) => (key === "sri" ? Math.max(0, v) : v);
    const target = c ? display(c.reference) : 0;
    const caption =
      key === "vo2max" && hs?.reason === null && hs.vo2maxSource
        ? VO2_CAPTION[hs.vo2maxSource]
        : key === "leanMass"
          ? c
            ? leanCaption(c, body, hs?.reason === null ? hs.age : 0)
            : "Needs body fat (a smart scale, or Journal › Log › Body fat), or your weight with your height in Profile. Left out of Pulse Age."
          : undefined;
    const domain: [number, number] = key === "leanMass" && c ? [target - 25, target + 10] : meta.domain;
    return {
      key,
      ...meta,
      domain,
      metric: c ? ok(display(c.value), result.provisional) : none("no_data"),
      target,
      years: c ? c.years : null,
      ...(caption && { caption }),
    };
  });

  const history = [];
  for (let k = 25; k >= 0; k--) {
    const d = addDays(weekEnd, -7 * k);
    const r = rows.get(d)?.healthspan;
    if (d <= last) history.push({ day: d, value: r && r.reason === null ? r.pulseAge : null });
  }

  return {
    day,
    weekStart,
    weekEnd,
    asOf: shown,
    nextUpdateInDays: weekEnd > last ? Math.max(0, daysBetween(today, weekEnd)) : 0,
    age: hs && hs.reason === null ? hs.age : fractionalYears(ctx.profile.birthDate, shown),
    result,
    insight: hs && hs.reason === null ? healthspanInsight(hs.paceOfAging, hs.deltaYears, contributions, hs.termsUsed) : null,
    history,
    contributors,
  };
}

/** Lean body mass's caption: the body composition behind the % (lean and fat mass in kg, and per m² of height). */
function leanCaption(c: HealthspanContribution, b: HealthspanBody | null | undefined, age: number) {
  const parts = [`${(100 - c.value).toFixed(1)}% body fat`];
  if (b?.leanKg != null && b.fatKg != null) parts.push(`${b.leanKg.toFixed(1)} kg lean, ${b.fatKg.toFixed(1)} kg fat`);
  if (b?.ffmi != null && b.fmi != null) parts.push(`FFMI ${b.ffmi.toFixed(1)}, FMI ${b.fmi.toFixed(1)} kg/m²`);
  const note = c.estimated
    ? " Body fat estimated from your BMI."
    : "";
  return `${parts.join(" · ")}.${note}`;
}
type HealthspanBody = Extract<NonNullable<DayRow["healthspan"]>, { reason: null }>["bodyComposition"];

/** `termsUsed`: how many of Pulse Age's 9 inputs it rests on (absent on rows stored before scoring version 10). */
function healthspanInsight(pace: number | null, deltaYears: number, cs: HealthspanContribution[], termsUsed: number | undefined) {
  const title =
    pace == null
      ? deltaYears < -1
        ? "Younger than your age"
        : deltaYears > 1
          ? "Older than your age"
          : "Close to your age"
      : pace < 0.9
        ? "Aging slower"
        : pace > 1.1
          ? "Aging faster"
          : "Steady and healthy";
  const best = [...cs].sort((a, b) => a.years - b.years)[0];
  const worst = [...cs].sort((a, b) => b.years - a.years)[0];
  const label = (c: HealthspanContribution) => HS_META[c.key].label.toLowerCase();
  const parts = [
    pace == null
      ? `Pace of Aging shows once ${healthspanConfig.paceMinDays} of the last 30 days have data.`
      : `Your Pace of Aging is ${pace.toFixed(1)}x: your Pulse Age over your age.`,
  ];
  if (best && best.years < 0) parts.push(`Your biggest boost is ${label(best)}, worth ${Math.abs(best.years).toFixed(1)} years.`);
  if (worst && worst.years > 0) parts.push(`${HS_META[worst.key].label} adds the most, ${worst.years.toFixed(1)} years.`);
  // Say how much of Pulse Age is measured; the engine scales the inputs present to stand for all nine.
  if (termsUsed != null)
    parts.push(
      termsUsed < HEALTHSPAN_TERM_COUNT
        ? `Based on ${termsUsed} of ${HEALTHSPAN_TERM_COUNT} inputs; the ones present are scaled up to stand for all ${HEALTHSPAN_TERM_COUNT}.`
        : `Based on all ${HEALTHSPAN_TERM_COUNT} inputs.`,
    );
  return { title, body: parts.join(" ") };
}

// ── Health Monitor ──────────────────────────────────────────────────────────

const VITALS: { key: VitalKey; short: string; unit: string; signed?: boolean; pick: (r: DayRow) => number | null | undefined }[] = [
  { key: "resp", short: "Resp", unit: "rpm", pick: (r) => r.metrics?.respBpm },
  // The engine's night values, the ones Health Monitor's band and Recovery use (the daily ones before a scored night).
  { key: "restingHr", short: "RHR", unit: "bpm", pick: (r) => r.rhr },
  { key: "hrv", short: "HRV", unit: "ms", pick: (r) => r.metrics?.hrvMs },
  { key: "skinTempDev", short: "Temp", unit: "°C", signed: true, pick: (r) => r.recovery?.inputs.skinTempDev },
];

const num = (v: number, dp: number, signed = false) => {
  const s = Math.abs(v).toFixed(dp);
  return signed ? `${v >= 0 ? "+" : "−"}${s}` : v < 0 ? `−${s}` : s;
};

/** Health Monitor `/health/monitor` for `day` (spec §7.8). */
export async function getMonitor(day: string, ctx: QueryCtx, preloaded?: Map<string, DayRow>): Promise<MonitorVM> {
  const today = todayOf(ctx);
  const isToday = day === today;
  const [rows, rhythm, measured] = await Promise.all([
    preloaded?.has(addDays(day, -29)) ? preloaded : loadDays(ctx, addDays(day, -29), day),
    heartRhythm(ctx, day),
    measurements(ctx, day, today),
  ]);
  const row = rows.get(day);
  const hm = row?.healthMonitor;
  const vitals: Vital[] = VITALS.map((v) => {
    const reading = hm && hm.reason === null ? hm.vitals.find((x) => x.key === v.key) : undefined;
    // The value Health Monitor judged, so the number, its chip and the count agree; the day's own reading only where
    // the monitor had none (no status then).
    const value = reading?.value ?? (row ? v.pick(row) : null);
    const range = reading?.range ?? null;
    const status = reading?.status ?? "no_data";
    let chip: Vital["chip"] = null;
    if (range && finite(value)) {
      // Ranges always show one decimal, so a whole-number reading never looks equal to its bound.
      const lo = num(range.low, 1, v.signed);
      const hi = num(range.high, 1, v.signed);
      if (v.key === "spo2" && status === "low" && value < 95) chip = { tone: "warning", text: "Below 95%" };
      else if (status === "in_range") chip = { tone: "optimal", text: v.key === "spo2" ? `Within ${lo} - 100` : `Within ${lo} - ${hi}` };
      else if (status === "high") chip = { tone: "warning", text: `Elevated, above ${hi}` };
      else if (status === "low") chip = { tone: "warning", text: `Low, below ${lo}` };
    }
    const reason = v.key === "skinTempDev" && row?.metrics?.nightlyTempC != null ? "calibrating" : vitalReason(row, isToday, v.key === "hrv");
    const tags = hm && hm.reason === null && hm.stale.includes(v.key === "restingHr" ? "rhr" : v.key === "skinTempDev" ? "skinTemp" : v.key) ? (["stale_baseline"] as const) : [];
    return {
      key: v.key,
      label: v.key === "skinTempDev" ? "Skin temp" : VITAL_LABEL[v.key],
      short: v.short,
      unit: v.unit,
      metric: finite(value) ? ok(value, false, [...tags]) : none(reason),
      range,
      status,
      chip,
      trend: {
        points: trendPoints(rows, day, v.pick, 30),
        baseline: range && v.key !== "spo2" ? { mean: (range.low + range.high) / 2, sd: (range.high - range.low) / 2 } : null,
      },
    };
  });

  let count: MonitorVM["count"];
  if (!hm) count = none(isToday ? "awaiting_sleep_sync" : "band_not_worn");
  else if (hm.reason !== null) count = none(nightReason(hm.reason, isToday));
  else {
    const raised = illnessRaised(hm);
    count = ok({ inRange: hm.inRange, total: VITALS.length, outOfRange: hm.flagged, status: raised ? "illness" : hm.flagged ? "out" : "within" });
  }
  return {
    day,
    isToday,
    count,
    illness: hm && hm.reason === null && illnessRaised(hm) ? { level: hm.illness.level, score: hm.illness.score } : null,
    vitals,
    heartRhythm: rhythm,
    measurements: measured,
  };
}

// ── Heart rhythm and measurements ───────────────────────────────────────────

type EcgCopy = Pick<EcgReading, "label" | "tone" | "explanation">;
/**
 * Google's Electrocardiogram.ResultClassification in the Google Health app's words. Only AFib takes a colour, and
 * a warning one, not red; every inconclusive state stays neutral. Unknown or unspecified codes read as "No result".
 */
export const ECG_RESULT: Record<string, EcgCopy> = {
  NORMAL_SINUS_RHYTHM: { label: "Normal sinus rhythm", tone: "optimal", explanation: "Your heart rhythm appears normal and shows no signs of AFib." },
  ATRIAL_FIBRILLATION: {
    label: "Atrial fibrillation",
    tone: "warning",
    explanation: "This reading shows signs of atrial fibrillation (AFib), an irregular heart rhythm. Share it with your doctor.",
  },
  INCONCLUSIVE: { label: "Inconclusive", tone: "neutral", explanation: "This reading couldn’t be classified, often because of movement, a weak signal or another rhythm." },
  INCONCLUSIVE_HIGH_HEART_RATE: {
    label: "Inconclusive: high heart rate",
    tone: "neutral",
    explanation: "Your heart rate was over 120 bpm, too high to check your rhythm. Rest for a few minutes and try again.",
  },
  INCONCLUSIVE_LOW_HEART_RATE: { label: "Inconclusive: low heart rate", tone: "neutral", explanation: "Your heart rate was under 50 bpm, too low to check your rhythm." },
  UNREADABLE: { label: "Poor recording", tone: "neutral", explanation: "The signal was too noisy to read. Try again sitting still with your arm resting on a table." },
  NOT_ANALYZED: { label: "Not analyzed", tone: "neutral", explanation: "This recording was saved but not classified, so it has no rhythm result." },
};
export const NO_RESULT: EcgCopy = { label: "No result", tone: "neutral", explanation: "No rhythm result came with this recording." };

/**
 * Heart-rhythm records up to `day`, newest first. Only the Google Health API carries them (src/google/sync.ts writes
 * the Store's health records); with Health Connect or demo data the section is honestly empty.
 */
async function heartRhythm(ctx: QueryCtx, day: string): Promise<HeartRhythm> {
  const all = await ctx.store.healthRecords(day);
  const ecg = all
    .filter((r) => r.kind === "ecg")
    .map((r): EcgReading => {
      const d = r.data as { result?: string; avgBpm?: number | null };
      const result = d.result ?? "RESULT_CLASSIFICATION_UNSPECIFIED";
      return { id: r.id, at: ms(r.ts), day: r.day, time: wall(r.ts, ctx.timeZone).time.slice(0, 5), result, ...(ECG_RESULT[result] ?? NO_RESULT), avgBpm: finite(d.avgBpm) ? d.avgBpm : null };
    });
  const irn = all.filter((r) => r.kind === "irn");
  return { ecg, irn: { count: irn.length, latestAt: irn[0] ? ms(irn[0].ts) : null, latestDay: irn[0]?.day ?? null } };
}

const MEASUREMENTS = [
  { key: "weight", label: "Weight", unit: "kg", format: "decimal1", col: "weightKg", always: true },
  { key: "body_fat", label: "Body fat", unit: "%", format: "decimal1", col: "bodyFatPct", always: true },
  { key: "glucose", label: "Blood glucose", unit: "mg/dL", format: "int", col: "glucose", always: false },
  { key: "core_temp", label: "Core temperature", unit: "°C", format: "decimal1", col: "core_temp", always: false },
] as const;

/** Every reading of each measurement, newest first: a Metrics column, or a daily-values key. */
async function allReadings(ctx: QueryCtx): Promise<{ day: string; value: number }[][]> {
  const [metrics, values] = await Promise.all([metricsWithLoggedBody(ctx.store), ctx.store.dailyValues()]);
  const newest = (a: { day: string }, b: { day: string }) => b.day.localeCompare(a.day);
  return MEASUREMENTS.map((m) => {
    if (m.col === "weightKg" || m.col === "bodyFatPct") {
      const col = m.col;
      return metrics.flatMap((r) => (finite(r[col]) ? [{ day: r.day, value: r[col] }] : [])).sort(newest);
    }
    const key = m.col;
    return values.filter((v) => v.key === key && /^\d{4}-\d{2}-\d{2}$/.test(v.day)).map((v) => ({ day: v.day, value: v.value })).sort(newest);
  });
}

async function measurements(ctx: QueryCtx, day: string, today: string): Promise<Measurement[]> {
  const all = await allReadings(ctx);
  const out: Measurement[] = [];
  for (const [i, m] of MEASUREMENTS.entries()) {
    const rs = all[i];
    if (!m.always && !rs.length) continue;
    const latest = rs.find((r) => r.day <= day);
    const prior = latest ? rs.filter((r) => r.day >= addDays(latest.day, -30) && r.day < latest.day).map((r) => r.value) : [];
    const { mean, sd } = meanSd(prior);
    out.push({
      key: m.key,
      label: m.label,
      unit: m.unit,
      format: m.format,
      metric: latest ? ok(latest.value) : none("no_data"),
      average: mean,
      sd,
      direction: "neutral",
      caption: latest ? dayLabel(latest.day, today) : undefined,
    });
  }
  return out;
}

// ── Stress Monitor ──────────────────────────────────────────────────────────

/** Stress Monitor `/health/stress` for `day` (spec §7.9). */
export async function getStress(day: string, ctx: QueryCtx): Promise<StressVM> {
  const today = todayOf(ctx);
  const isToday = day === today;
  const [rows, series, exs] = await Promise.all([loadDays(ctx, addDays(day, -29), day), loadSeries(ctx, day, "stress"), exercisesBetween(ctx, day, day)]);
  const row = rows.get(day);
  const st = row?.stress;
  const gauge = stressNow(row, isToday);
  const start = dayStartOf(ctx, day);
  const sameStress = [7, 14, 21, 28].map((k) => rows.get(addDays(day, -k))?.stress).filter((x) => !!x && x.average != null);
  const typicalOf = (pick: (x: NonNullable<DayRow["stress"]>) => number) => meanSd(sameStress.map((x) => pick(x!))).mean ?? 0;
  const typical = sameStress.length ? typicalOf((x) => x.highMin) : null;

  const spans = daySpansOf(row, start, exs);
  const scored = st && st.average != null;
  const empty = row?.s1?.hrCount ? "no_data" : "band_not_worn";

  return {
    day,
    isToday,
    gauge,
    insight: scored ? stressInsight(st, ctx.timeZone) : null,
    chart: scored ? ok({ points: minutePoints(series, start, 2), spans, now: isToday && st.latest ? ms(st.latest.ts) : null }, st.provisional) : none(empty),
    levels: scored
      ? ok(
          {
            lowMin: st.lowMin,
            mediumMin: st.mediumMin,
            highMin: st.highMin,
            typicalDeltaMin: typical == null ? null : st.highMin - typical,
            weekday: formatDay(day, { weekday: "long" }),
            typical: sameStress.length ? { lowMin: typicalOf((x) => x.lowMin), mediumMin: typicalOf((x) => x.mediumMin), highMin: typical! } : null,
          },
          st.provisional,
        )
      : none(empty),
    trend: {
      points: trendPoints(rows, day, (r) => r.stress?.average, 30),
    },
  };
}

function stressInsight(st: NonNullable<DayRow["stress"]>, tz: string) {
  const total = st.lowMin + st.mediumMin + st.highMin;
  const top = st.lowMin >= st.mediumMin && st.lowMin >= st.highMin ? "low" : st.mediumMin >= st.highMin ? "medium" : "high";
  const lead = `Most of your time was in ${top} stress.`;
  if (!total) return null;
  if (st.longestHigh && st.longestHigh.minutes >= 10) {
    const at = wall(st.longestHigh.start, tz).time.slice(0, 5);
    return `${lead} Your longest high-stress stretch started at ${at} and lasted ${st.longestHigh.minutes} minutes.`;
  }
  return `${lead} You had no long stretch of high stress.`;
}

// ── Fitness ─────────────────────────────────────────────────────────────────

const ACWR_STATUS = { neutral: "detraining", optimal: "optimal", warning: "pushing", alert: "high_risk" } as const satisfies Record<ChipTone, string>;
type LoadChip = NonNullable<FitnessVM["trainingLoad"]["value"]>["status"];
const STATUS_TONE: Record<LoadChip, ChipTone> = { detraining: "neutral", optimal: "optimal", pushing: "warning", high_risk: "alert" };
/** The engine's load statuses on the screen's four chips. */
const CARDIO_STATUS: Record<Exclude<LoadStatus, "calibrating">, LoadChip> = {
  detraining: "detraining",
  maintaining: "optimal",
  peaking: "optimal",
  productive: "optimal",
  fatigued: "pushing",
  overtraining: "high_risk",
};
export const acwrStatus = (acwr: number) => {
  const tone = acwrTone(acwr);
  return { status: ACWR_STATUS[tone], tone };
};

/** Fitness `/health/fitness`: latest values (spec §7.10). */
export async function getFitness(ctx: QueryCtx): Promise<FitnessVM> {
  const today = todayOf(ctx);
  const last = await lastStored(ctx, today);
  const rows = await loadDays(ctx, addDays(last, -181), last);
  const row = rows.get(last);
  const f = row?.fitness;
  const decade = (age: number) => {
    const lo = Math.min(70, Math.max(20, Math.floor(age / 10) * 10));
    return `${lo}-${lo + 9}`;
  };
  // Mobile: Fitness Age and Pulse's own VO2 max estimate (from resting HR and activity) on the newest day that has one.
  const estDay = [...rows.keys()].sort().reverse().find((d) => d >= addDays(last, -6) && rows.get(d)?.healthspan?.fitnessEstimate);
  const est = estDay ? rows.get(estDay)!.healthspan!.fitnessEstimate! : null;
  const estAge = estDay ? fractionalYears(ctx.profile.birthDate, estDay) : 0;
  const vo2: FitnessVM["vo2"] =
    f && f.reason === null
      ? ok({ value: f.vo2max, source: f.source, sourceDay: f.sourceDay, percentile: f.percentile, category: f.category, ageBand: decade(f.age), sex: ctx.profile.sex }, f.source === "daily")
      : est && estDay
        ? ok({ value: est.vo2max, source: "estimate", sourceDay: estDay, ...fitnessLevel(est.vo2max, estAge, ctx.profile.sex), ageBand: decade(estAge), sex: ctx.profile.sex }, true)
        : none("no_data");
  const fitnessAge: FitnessVM["fitnessAge"] =
    est && estDay
      ? ok({ fitnessAge: est.fitnessAge, age: estAge, vo2max: est.vo2max, method: est.method, activityIndex: est.activityIndex, restingHr: est.restingHr, day: estDay })
      : none("no_data");
  // Cardio Load on the Pulse engine (training_load.cardio): the ratio and its status, mapped onto the screen's chips.
  const cardio = row?.trainingLoad?.cardio;
  const trainingLoad: Metric<NonNullable<FitnessVM["trainingLoad"]["value"]>> =
    cardio && cardio.status !== "calibrating" && cardio.ratio != null
      ? ok({ acwr: cardio.ratio, status: CARDIO_STATUS[cardio.status], tone: STATUS_TONE[CARDIO_STATUS[cardio.status]] })
      : none("calibrating");
  const load = Array.from({ length: 90 }, (_, k) => {
    const d = addDays(last, k - 89);
    const t = rows.get(d)?.trainingLoad?.cardio;
    return { day: d, ctl: t?.ctl ?? null, atl: t?.atl ?? null, tsb: t ? t.ctl - t.atl : null };
  });
  // Measured and Fitbit values; with none in the window, Pulse's own estimate.
  const measured = trendPoints(rows, last, (r) => r.metrics?.vo2maxRun ?? r.metrics?.vo2maxDaily);
  return {
    vo2,
    fitnessAge,
    trend: {
      points: measured.some((p) => p.value !== null) ? measured : trendPoints(rows, last, (r) => r.healthspan?.fitnessEstimate?.vo2max, 182, () => true),
    },
    trainingLoad,
    load,
    loadReason: load.some((p) => p.ctl != null) ? null : { reason: "calibrating" },
  };
}

// ── Heart rate ──────────────────────────────────────────────────────────────

/**
 * The band's heart rate over [from, to) unix seconds (minute-aligned) as minute means, a null for a minute without a
 * sample so the chart leaves a gap, plus the newest raw sample in the range. Reads only that window.
 */
export async function hrMinutes(ctx: QueryCtx, from: number, to: number): Promise<HeartRateLive> {
  const hr = await ctx.store.readHr(from, to);
  const last = hr.at(-1);
  return {
    points: minuteMeanHr(hr, from, to).map((v, m) => ({ t: ms(from + m * 60), v: v === null ? null : Math.round(v) })),
    latest: last ? { t: ms(last.ts), bpm: last.bpm } : null,
  };
}

/** Heart rate `/health/heart-rate?d=`: the day's minutes (today up to now), resting heart rate and time in zones. */
export async function getHeartRate(day: string, ctx: QueryCtx): Promise<HeartRateVM> {
  const isToday = day === todayOf(ctx);
  const start = localMidnight(day, ctx.timeZone);
  const end = localMidnight(addDays(day, 1), ctx.timeZone);
  const to = isToday ? Math.min(end, Math.floor(ctx.now / 60) * 60 + 60) : end;
  const [hr, rows] = await Promise.all([hrMinutes(ctx, start, to), loadDays(ctx, day, day)]);
  const row = rows.get(day);
  return {
    day,
    isToday,
    end: ms(end),
    ...hr,
    restingHr: row?.rhr ?? null,
    zoneBands: row?.s1 ? zoneBounds(row.s1.zoneLower) : [],
    maxHr: row?.s1?.maxHr ?? maxHrOf(ctx),
    zones: zoneRows(row),
    zoneNote: zoneNote(row, ctx),
  };
}
