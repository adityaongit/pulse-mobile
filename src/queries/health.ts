// Health hub and its four detail screens (spec §7.6–7.10). Ported from pulse src/server/queries/health.ts: reads go
// through the repositories (`ctx.store`), there is no user id.
import { factorCopy } from "@/core/algorithms/healthspanFactor";
import type { HealthspanContribution } from "@/core/algorithms/healthspan";
import { minChronic } from "@/core/scoring/readiness";
import { standardConfig } from "@/core/scoring/trainingLoad";
import { acwrTone } from "@/lib/bands";
import { dayLabel, formatDay } from "@/lib/format";
import { trendHref, weekOf } from "@/lib/url";
import { minuteMeanHr } from "@/core/algorithms/stress";
import { addDays, daysBetween, fractionalYears, localMidnight, wall } from "../time";
import { zoneBounds, zoneNote, zoneRows } from "./strain";
import { illnessRaised, VITAL_LABEL } from "./home";
import {
  type DayRow,
  dayStartOf,
  finite,
  loadDays,
  loadSeries,
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
  stressChartOf,
  exercisesBetween,
} from "./common";
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

const lastStored = async (ctx: QueryCtx, today: string) => (await ctx.store.scores.lastStoredDay(today)) ?? today;

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
    healthspan: hs.value ? ok({ pulseAge: hs.value.pulseAge, deltaYears: hs.value.deltaYears, pace: hs.value.pace, paceDelta: prevPace == null ? null : hs.value.pace - prevPace }, hs.provisional) : none(hs.reason ?? "no_data", hs.nightsLeft),
    monitor: monitor.count.value
      ? ok({ vitals: monitor.vitals.map((v) => ({ key: v.key, short: v.short, status: v.status })), inRange: monitor.count.value.inRange, total: 5 })
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

/** The newest stored band reading, whenever it was. */
async function latestHr(ctx: QueryCtx) {
  const r = await ctx.store.samples.sampleRange("hr");
  return r ? (await hrMinutes(ctx, r.max, r.max + 1)).latest : null;
}

// ── Healthspan ──────────────────────────────────────────────────────────────

const HS_META: Record<string, Omit<HealthspanContributor, "metric" | "recent" | "target" | "years" | "caption" | "key" | "state" | "trendHref">> = {
  sleepHours: {
    group: "sleep",
    label: "Hours of sleep",
    unit: "h",
    domain: [4, 10],
    higherIsBetter: true,
    explanation: "Both short and long sleep are linked to higher mortality. Seven to eight hours a night carries the lowest risk.",
    source: "Cappuccio 2010",
  },
  sri: {
    group: "sleep",
    label: "Sleep consistency",
    unit: "%",
    domain: [0, 100],
    higherIsBetter: true,
    explanation: "Going to bed and waking at the same times predicts a longer life even more strongly than how long you sleep.",
    source: "Windred 2024",
  },
  zone13: {
    group: "strain",
    label: "Heart rate zones 1-3",
    unit: "min",
    domain: [0, 300],
    higherIsBetter: true,
    explanation: "Moderate activity is linked to steeply lower mortality, with most of the benefit in the first 150 minutes a week.",
    source: "Ekelund 2019",
  },
  zone45: {
    group: "strain",
    label: "Heart rate zones 4-5",
    unit: "min",
    domain: [0, 150],
    higherIsBetter: true,
    explanation: "Vigorous activity adds benefit on top of moderate activity. About 75 to 150 minutes a week is where it levels off.",
    source: "Lee 2022",
  },
  strength: {
    group: "strain",
    label: "Strength activity time",
    unit: "min",
    domain: [0, 150],
    higherIsBetter: true,
    explanation: "Muscle-strengthening work is linked to lower mortality, with the lowest risk around 40 minutes a week.",
    source: "Momma 2022",
  },
  steps: {
    group: "strain",
    label: "Daily steps",
    unit: "steps",
    domain: [0, 15000],
    higherIsBetter: true,
    explanation: "More daily steps go with lower mortality, levelling off around 8,000 to 10,000 steps a day.",
    source: "Paluch 2022",
  },
  vo2max: {
    group: "fitness",
    label: "VO2 max",
    unit: "ml/kg/min",
    domain: [15, 70],
    higherIsBetter: true,
    explanation:
      "Higher cardiorespiratory fitness is one of the strongest predictors of a longer life. Each extra 1 MET (3.5 ml/kg/min) is linked to about 13% lower all-cause mortality.",
    source: "Kodama 2009",
  },
  restingHr: {
    group: "fitness",
    label: "Resting heart rate",
    unit: "bpm",
    domain: [40, 90],
    higherIsBetter: false,
    explanation: "Each 10 bpm higher resting heart rate is linked to about 9% higher all-cause mortality.",
    source: "Zhang 2016",
  },
  leanMass: {
    group: "fitness",
    label: "Lean body mass",
    unit: "kg",
    domain: [40, 80],
    higherIsBetter: true,
    explanation: "More fat-free mass for your height is linked to lower mortality, independent of body fat.",
    source: "Sedlmeier 2021",
  },
};
const HS_ORDER = ["sleepHours", "sri", "zone13", "zone45", "strength", "steps", "vo2max", "restingHr", "leanMass"];
/** Each factor's Trend View (health-03's VIEW TREND). */
const HS_TREND: Record<string, string> = {
  sleepHours: "hours",
  sri: "consistency",
  zone13: "zones13",
  zone45: "zones45",
  strength: "strength",
  steps: "steps",
  vo2max: "vo2max",
  restingHr: "rhr",
  leanMass: "lean_mass",
};

/** Healthspan `/health/healthspan` for the ISO week containing `day` (spec §7.7). Updated weekly. */
export async function getHealthspan(day: string, ctx: QueryCtx): Promise<HealthspanVM> {
  const today = todayOf(ctx);
  const [weekStart, weekEnd] = weekOf(day);
  const [last, rows] = await Promise.all([lastStored(ctx, today), loadDays(ctx, addDays(weekEnd, -182), weekEnd)]);
  // A finished week shows its Sunday; the current week shows last Sunday until this one ends.
  const lastSunday = addDays(weekStart, -1);
  const shown = weekEnd <= last ? weekEnd : rows.get(lastSunday)?.healthspan ? lastSunday : last;
  const hs = rows.get(shown)?.healthspan;
  const h2 = ctx.profile.heightCm ? (ctx.profile.heightCm / 100) ** 2 : null;

  let result: HealthspanVM["result"];
  if (!hs) result = none("no_data");
  else if (hs.reason !== null) result = none("calibrating", Math.max(1, 20 - hs.dataDays));
  else result = ok({ pulseAge: hs.pulseAge, deltaYears: hs.deltaYears, pace: hs.paceOfAging, paceProvisional: hs.paceProvisional, vo2maxSource: hs.vo2maxSource }, hs.provisional);

  const contributions = hs && hs.reason === null ? hs.contributions : [];
  const contributors: HealthspanContributor[] = HS_ORDER.map((key) => {
    const meta = HS_META[key];
    const c = contributions.find((x) => x.key === key);
    const display = (v: number) => (key === "sri" ? Math.max(0, v) : key === "leanMass" && h2 ? v * h2 : v);
    const target = c ? display(c.reference) : 0;
    const caption =
      key === "vo2max" && hs?.reason === null && hs.vo2maxSource
        ? hs.vo2maxSource === "run"
          ? "From runs"
          : "Estimated: counts half"
        : key === "leanMass" && !c
          ? "No lean body mass: add weight and body fat in Fitbit. Left out of Pulse Age."
          : undefined;
    const domain: [number, number] = key === "leanMass" && c ? [target * 0.75, target * 1.25] : meta.domain;
    return {
      key,
      ...meta,
      domain,
      metric: c ? ok(display(c.value), result.provisional) : none("no_data"),
      recent: c?.recent != null ? display(c.recent) : null,
      target,
      years: c ? c.years : null,
      state: c ? factorCopy(meta.label, c.years) : null,
      trendHref: trendHref(HS_TREND[key]),
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
    insight: hs && hs.reason === null ? healthspanInsight(hs.paceOfAging, contributions) : null,
    history,
    contributors,
  };
}

function healthspanInsight(pace: number, cs: HealthspanContribution[]) {
  const title = pace < 0.9 ? "Aging slower" : pace > 1.1 ? "Aging faster" : "Steady and healthy";
  const best = [...cs].sort((a, b) => a.years - b.years)[0];
  const worst = [...cs].sort((a, b) => b.years - a.years)[0];
  const label = (c: HealthspanContribution) => HS_META[c.key].label.toLowerCase();
  const parts = [`Your Pace of Aging is ${pace.toFixed(1)}x against your 6-month average.`];
  if (best && best.years < 0) parts.push(`Your biggest boost is ${label(best)}, worth ${Math.abs(best.years).toFixed(1)} years.`);
  if (worst && worst.years > 0) parts.push(`${HS_META[worst.key].label} adds the most, ${worst.years.toFixed(1)} years.`);
  return { title, body: parts.join(" ") };
}

// ── Health Monitor ──────────────────────────────────────────────────────────

const VITALS: { key: VitalKey; short: string; unit: string; signed?: boolean; pick: (r: DayRow) => number | null | undefined }[] = [
  { key: "resp", short: "Resp", unit: "rpm", pick: (r) => r.metrics?.respBpm },
  { key: "spo2", short: "SpO2", unit: "%", pick: (r) => r.metrics?.spo2Pct },
  { key: "restingHr", short: "RHR", unit: "bpm", pick: (r) => r.metrics?.rhrBpm ?? r.sessionRhr },
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
    const value = row ? v.pick(row) : null;
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
      label: VITAL_LABEL[v.key],
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
    count = ok({ inRange: hm.inRange, total: 5, outOfRange: hm.flagged, status: raised ? "illness" : hm.flagged ? "out" : "within" });
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

// ── Heart rhythm and measurements (docs/research/heart-rhythm-ui.md) ────────

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
const NO_RESULT: EcgCopy = { label: "No result", tone: "neutral", explanation: "No rhythm result came with this recording." };

const ecgOf = (ctx: QueryCtx, r: { id: string; ts: number; day: string; data: unknown }): EcgReading => {
  const d = r.data as { result?: string; avgBpm?: number | null };
  const result = d.result ?? "RESULT_CLASSIFICATION_UNSPECIFIED";
  return { id: r.id, at: ms(r.ts), day: r.day, time: wall(r.ts, ctx.timeZone).time.slice(0, 5), result, ...(ECG_RESULT[result] ?? NO_RESULT), avgBpm: finite(d.avgBpm) ? d.avgBpm : null };
};

async function heartRhythm(ctx: QueryCtx, day: string): Promise<HeartRhythm> {
  const all = await ctx.store.daily.healthRecordsUpTo(day);
  const rows = (kind: "ecg" | "irn") => all.filter((r) => r.kind === kind);
  const ecg = rows("ecg").map((r) => ecgOf(ctx, r));
  const irn = rows("irn");
  return { ecg, irn: { count: irn.length, latestAt: irn[0] ? ms(irn[0].ts) : null, latestDay: irn[0]?.day ?? null } };
}

/** One ECG reading for its sheet (`/ecg?id=`): the web opens it from the Heart rhythm list it already holds. */
export async function getEcgReading(ctx: QueryCtx, id: string): Promise<EcgReading | null> {
  const r = (await ctx.store.daily.healthRecordsUpTo(todayOf(ctx))).find((x) => x.kind === "ecg" && x.id === id);
  return r ? ecgOf(ctx, r) : null;
}

const MEASUREMENTS = [
  { key: "weight", label: "Weight", unit: "kg", format: "decimal1", col: "weightKg", always: true },
  { key: "body_fat", label: "Body fat", unit: "%", format: "decimal1", col: "bodyFatPct", always: true },
  { key: "glucose", label: "Blood glucose", unit: "mg/dL", format: "int", col: "glucose", always: false },
  { key: "core_temp", label: "Core temperature", unit: "°C", format: "decimal1", col: "core_temp", always: false },
] as const;

/** Every reading of a measurement, newest first: a daily_metrics column, or a daily_values key. */
const readings = (ctx: QueryCtx, col: (typeof MEASUREMENTS)[number]["col"]): Promise<{ day: string; value: number }[]> =>
  col === "weightKg" || col === "bodyFatPct" ? ctx.store.daily.metricReadings(col) : ctx.store.daily.valueReadings(col);

async function measurements(ctx: QueryCtx, day: string, today: string): Promise<Measurement[]> {
  const all = await Promise.all(MEASUREMENTS.map((m) => readings(ctx, m.col)));
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
  const sameStress = [7, 14, 21, 28].map((k) => rows.get(addDays(day, -k))?.stress).filter((x) => !!x && x.average != null);
  const typicalOf = (pick: (x: NonNullable<DayRow["stress"]>) => number) => meanSd(sameStress.map((x) => pick(x!))).mean ?? 0;
  const typical = sameStress.length ? typicalOf((x) => x.highMin) : null;

  const scored = st && st.average != null;
  const chart = stressChartOf(ctx, row, day, isToday, series, exs);

  return {
    day,
    isToday,
    gauge,
    insight: scored ? stressInsight(st, ctx.timeZone) : null,
    chart,
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
      : none(chart.reason ?? "no_data"),
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
  const vo2: FitnessVM["vo2"] =
    f && f.reason === null
      ? ok({ value: f.vo2max, source: f.source, sourceDay: f.sourceDay, percentile: f.percentile, category: f.category, ageBand: decade(f.age), sex: ctx.profile.sex }, f.source === "daily")
      : none("no_data");
  const tl = row?.trainingLoad;
  const effortDays = [...rows.values()].filter((r) => r.s1?.effort != null).length;
  const trainingLoad: Metric<NonNullable<FitnessVM["trainingLoad"]["value"]>> =
    tl?.acwr != null ? ok({ acwr: tl.acwr, ...acwrStatus(tl.acwr) }) : none("calibrating", Math.max(1, minChronic - effortDays));
  const load = Array.from({ length: 90 }, (_, k) => {
    const d = addDays(last, k - 89);
    const t = rows.get(d)?.trainingLoad;
    return { day: d, ctl: t?.ctl ?? null, atl: t?.atl ?? null, tsb: t?.tsb ?? null };
  });
  return {
    vo2,
    trend: {
      points: trendPoints(rows, last, (r) => r.metrics?.vo2maxRun ?? r.metrics?.vo2maxDaily),
    },
    trainingLoad,
    load,
    loadReason: load.some((p) => p.ctl != null) ? null : { reason: "calibrating", nightsLeft: Math.max(1, standardConfig.minimumDays - (tl?.contiguousDays ?? 0)) },
  };
}

// ── Heart rate ──────────────────────────────────────────────────────────────

/**
 * The band's heart rate over [from, to) unix seconds (minute-aligned) as minute means, a null for a minute without a
 * sample so the chart leaves a gap, plus the newest raw sample in the range.
 */
export async function hrMinutes(ctx: QueryCtx, from: number, to: number): Promise<HeartRateLive> {
  const hr = await ctx.store.samples.readHr(from, to);
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
    restingHr: row?.metrics?.rhrBpm ?? null,
    zoneBands: row?.s1 ? zoneBounds(row.s1.zoneLower) : [],
    maxHr: row?.s1?.maxHr ?? ctx.profile.maxHr,
    zones: zoneRows(row),
    zoneNote: zoneNote(row, ctx),
  };
}
