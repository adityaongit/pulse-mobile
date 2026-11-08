// View models returned by the screen queries, one per screen (Pulse spec §7), ported verbatim from the web app's
// src/server/queries/types.ts so the ported UI consumes them unchanged.
// Conventions: instants are epoch **milliseconds** (as the charts and cards take them), days are
// local `YYYY-MM-DD`, Strain is a percent (0–100 on most days, above 100 on a very big one), and no number is ever NaN or ±Infinity.
import type { ChipTone, DashboardKey, FormatKey, GoodDirection, RecoveryBand as Band, StressLevel } from "./_lib";
import type { Metric, MetricTag, ReasonCode } from "@/lib/reasons";
import type { EnergyBand } from "@/core/engine/energyBank";

export type { Band, ChipTone, GoodDirection, Metric, MetricTag, ReasonCode, StressLevel };
export type SleepStatus = "poor" | "sufficient" | "optimal";
export type ActivityKind = "run" | "ride" | "walk" | "strength" | "workout";

/** `partial`: today's running total of a metric that accrues through the day (drawn faded, kept out of averages). */
export type DayPoint = { day: string; value: number | null; provisional?: boolean; partial?: boolean };
/** 182 days ending on the selected day (the chart slices W / M / 6M). */
export type Trend = {
  points: DayPoint[];
  /** Personal normal range (mean ± 1 σ), when the chart shades one. */
  baseline?: { mean: number; sd: number } | null;
  /** Strain trend: today's Strain Target band. */
  target?: [number, number] | null;
};
/** A day's total with its parts; `parts` null when the day has a total but no breakdown. */
export type SplitPoint = DayPoint & { parts: Record<string, number> | null };
export type TimePoint = { t: number; v: number | null };
export type Span = { kind: "workout" | "sleep" | "nap"; label: string; start: number; end: number };

/** A key-statistics row or tile (KeyStatRow). */
export type KeyStat = {
  key: string;
  label: string;
  metric: Metric<number>;
  unit?: string;
  /** Mean over the 30 days before the selected day (or the comparison period). */
  average: number | null;
  sd?: number;
  direction: GoodDirection | "none";
  status?: SleepStatus;
  chip?: { tone: ChipTone; text: string };
  caption?: string;
  /** Detail route without `?d=`; the UI adds the day. */
  href?: string;
  /** Overrides the format the unit implies (extra metrics). */
  format?: FormatKey;
};

export type ZoneRow = {
  zone: number;
  label: string;
  min: number;
  max: number | null;
  seconds: number;
  /** Activity only: the mean seconds and share (0-1) in this zone over the person's last 30 days of the same kind. */
  typical?: { seconds: number; share: number };
};
export type StackedSegment = { key: string; label: string; count: number; color: string };

/** DriverList item. `delta` is in the list's unit; lists are sorted by |delta| descending. */
export type DriverItem = {
  key: string;
  label: string;
  delta: number;
  effect?: "positive" | "negative" | "none";
  yes?: number;
  no?: number;
  ci?: [number, number];
};

export type TimelineItem =
  | { kind: "sleep" | "nap"; id: string; day: string; minutes: number; start: number; end: number }
  | {
      kind: "activity";
      id: string;
      day: string;
      name: string;
      activityKind: ActivityKind;
      strain: Metric<number>;
      start: number;
      end: number;
      /** Recorded distance, or null when the workout has none (strength, a phone-less session). */
      distanceKm: number | null;
      /** Seconds per km, runs and walks with a distance only. */
      paceS: number | null;
    };

export type SleepPlanVM = {
  needMin: number;
  parts: { baselineMin: number; strainMin: number; debtMin: number; napMin: number };
  /** Tomorrow's typical wake, epoch ms. */
  wakeAt: number;
  weekend: boolean;
  /** Minutes the bedtimes leave to fall asleep (the typical latency of recent nights); 0 without staged nights. */
  latencyMin: number;
  plans: { key: "peak" | "perform" | "get_by"; label: string; share: number; sleepMin: number; bedtimeAt: number }[];
};

export type EnergyBankVM = {
  current: number;
  /** Garmin's Body Battery band of `current`: 5–25 very low, 26–50 low, 51–75 medium, 76–100 high. */
  band: EnergyBand;
  /** The level at wake. */
  startLevel: number;
  /** Wake, epoch ms. */
  startAt: number;
  until: number;
  charged: number;
  /** Negative. */
  drained: number;
  /** Every 5 minutes from where the day's curve starts (midnight when it carries on from yesterday, else wake). */
  curve: TimePoint[];
  drains: { label: string; kind: "workout" | "activity" | "stress"; start: number; amount: number }[];
  naps: { start: number; end: number }[];
};

// ── Home ─────────────────────────────────────────────────────────────────────

/** The stats Home's own cards read (HomeVM.cardStats). */
export type CardStatKey = "hrv" | "rhr" | "resp" | "steps" | "calories";

export type HomeVM = {
  day: string;
  today: string;
  isToday: boolean;
  /** 30 days ending today (extended back to include `day`). */
  strip: { day: string; recovery: number | null }[];
  dials: {
    sleep: Metric<number>;
    recovery: Metric<number>;
    /** A percent. */
    strain: Metric<number>;
    strainTarget: [number, number] | null;
    soFar: boolean;
    /** The one reason line under the dials: Recovery's, else Sleep's, else Strain's. */
    reason: { reason: ReasonCode; nightsLeft?: number } | null;
  };
  monitorAlert: { kind: "flagged" | "illness"; count: number; names: string[] } | null;
  monitor: Metric<{ inRange: number; total: number; flagged: number }>;
  stress: Metric<{ value: number; level: StressLevel; at: number | null; dayAverage: boolean }>;
  /** Mobile: `detected` are workouts stage 1 found from raised heart rate with none recorded; shown dashed, never scored. */
  activities: { title: string; items: TimelineItem[]; detected: DetectedItem[] };
  energyBank: Metric<EnergyBankVM>;
  tonight: Metric<SleepPlanVM>;
  keyStats: KeyStat[];
  /**
   * The numbers Home's own cards read whatever My Dashboard shows (Your week's Recovery vitals, the Goals card's steps
   * and calories), each against its 30-day average.
   */
  cardStats: Record<CardStatKey, KeyStat>;
  /** My Dashboard's editor: the default list (v1 rows, or phone metrics without a band) and the metrics with no data in 30 days. */
  dashboard: { defaults: DashboardKey[]; empty: DashboardKey[] };
  /** No heart rate on the day but the phone counted steps (spec §11 CD2): those stats lead Home. Null otherwise. */
  phone: KeyStat[] | null;
  weeklyTeaser: { period: string; start: string; end: string } | null;
  /** Morning outlook before 17:00 today, day in review after it and on past days (inferred I15); null with no data. */
  outlook: { kind: "outlook" | "review"; title: string; body: string } | null;
  /** Today's coach cards (Strain Coach, Recovery, Sleep), in order; empty on past days. */
  insights: { key: "strain" | "recovery" | "sleep"; title: string; body: string; href: string }[];
  /** The 7 days ending on `day`: was a check-in logged. */
  journalWeek: { day: string; done: boolean }[];
  /** The 7 days ending on `day`, oldest first: Strain % and Recovery %. */
  strainRecovery: { day: string; strain: number | null; recovery: number | null }[];
};

// ── Recovery ─────────────────────────────────────────────────────────────────

export type Contributor = {
  key: "hrv" | "rhr" | "resp" | "sleep" | "skinTemp";
  label: string;
  unit: string;
  metric: Metric<number>;
  baseline: { mean: number; sd: number } | null;
  /** Points this input moved today's Recovery (marginal; rows do not sum to the score). */
  points: number | null;
  direction: GoodDirection;
};

export type RecoveryVM = {
  day: string;
  isToday: boolean;
  recovery: Metric<number>;
  band: Band | null;
  contributors: Contributor[];
  insight: string | null;
  trend: Trend;
  drivers: Metric<DriverItem[]>;
  forecast: Metric<{ value: number; low: number; high: number; band: Band }>;
};

// ── Strain and Activity ──────────────────────────────────────────────────────

export type HrChart = { points: TimePoint[]; zones: ZoneRow[]; spans: Span[]; now: number | null };

export type ActivityItem = Extract<TimelineItem, { kind: "activity" }>;

/**
 * Mobile: a stretch of sustained elevated heart rate with no workout recorded (src/core/algorithms/autoWorkout.ts),
 * labelled by its steps. Shown, never scored; it has no detail screen.
 */
export type DetectedItem = {
  kind: "walk" | "run" | "cardio";
  /** "Walking", "Running", "Other cardio". */
  label: string;
  start: number;
  end: number;
  avgHr: number;
  maxHr: number;
  /** A percent, display only. */
  strain: number | null;
  steps: number | null;
};

/** Mobile: one kind's Activity Cost (src/core/algorithms/activityCost.ts); `change` and `nextMorning` are Recovery points. */
export type ActivityCostEntry = { kind: ActivityKind; name: string; sessions: number } & (
  | { reason: null; change: number; nextMorning: number; daysToBaseline: number | null; confidence: "building" | "solid" }
  | { reason: "not_enough_data" }
);

/** Mobile: what each kind of workout costs next-morning Recovery, over all history. */
export type ActivityCostVM = {
  /** Mean Recovery the kinds are measured against; null with no Recovery yet. */
  baseline: number | null;
  /** "rest": days with no workout in the week before; "all": every day (too few rest days). */
  baselineKind: "rest" | "all";
  /** Workouts with a next-morning Recovery a kind needs before it is measured. */
  minSessions: number;
  items: ActivityCostEntry[];
};

/** `/activities`: recorded activity and sleep grouped by day, newest first. */
export type ActivitiesVM = {
  today: string;
  /** How many days back the list reaches. */
  days: number;
  groups: { day: string; items: TimelineItem[]; minutes: number; steps: number | null; dayStrain: number | null; detected: DetectedItem[] }[];
  /** True when workouts or sleep exist before the window, so "Show older" has something to load. */
  older: boolean;
  /** Mobile: Activity Cost for every kind; null before the pipeline has stored it. */
  cost: ActivityCostVM | null;
};

export type StrainVM = {
  day: string;
  isToday: boolean;
  strain: Metric<number>;
  soFar: boolean;
  target: Metric<{ low: number; high: number; estimate: boolean; acwrRule: "capped" | "lifted" | null }>;
  summary: KeyStat[];
  coach: string | null;
  hr: Metric<HrChart>;
  zones: Metric<ZoneRow[]>;
  maxHr: number;
  /** How the zones are set: five on % of max heart rate (the Pulse engine's). */
  zoneNote: string;
  activities: ActivityItem[];
  trend: Trend;
  /**
   * 30 days ending on the day: total kcal split into resting, everyday movement and workouts, which add up to the total
   * (calorieSplit in strain.ts: active capped at the total, workouts at active).
   */
  calories: SplitPoint[];
  /** 60 days ending on the day: minutes of recorded workouts (0 on any day without one, data or not). */
  workouts: Trend;
};

export type ActivityVM = {
  id: string;
  day: string;
  name: string;
  kind: ActivityKind;
  start: number;
  end: number;
  strain: Metric<number>;
  /**
   * The strain's split between heart rate and muscular load, whole percents summing to 100 (WHOOP shows the same
   * split since 2026); null unless the session carries a muscular load.
   */
  loadSplit: { cardioPct: number; muscularPct: number } | null;
  /** Version 19: Garmin-style Aerobic Training Effect and the Recovery Time it added (queries/training.ts); null without one. */
  trainingEffect: import("./training").TrainingEffectVM | null;
  dayStrain: number | null;
  stats: KeyStat[];
  insight: string | null;
  hr: Metric<HrChart>;
  zones: Metric<ZoneRow[]>;
  maxHr: number;
  /** How the zones are set: five on % of max heart rate (the Pulse engine's). */
  zoneNote: string;
  hrr: Metric<{ value: number; tone: ChipTone; label: string }>;
  /** Mobile: this kind's Activity Cost and the Recovery the morning after this workout; null before the pipeline stored one. */
  cost: (Omit<ActivityCostVM, "items"> & { item: ActivityCostEntry; nextMorning: number | null }) | null;
};

// ── Sleep ────────────────────────────────────────────────────────────────────

export type SleepVM = {
  day: string;
  isToday: boolean;
  performance: Metric<number>;
  summary: KeyStat[];
  insight: string | null;
  /** null: a session without stages (Hypnogram empty copy). */
  stages: Metric<{
    bed: number;
    wake: number;
    segments: { stage: "awake" | "rem" | "light" | "deep"; start: number; end: number }[];
    rows: { stage: "awake" | "rem" | "light" | "deep"; label: string; pct: number; minutes: number; typical: [number, number] }[];
  }> | null;
  /** Hours asleep in the main sleep, against the prior 30 nights' mean (spec §7.5, §11 R9). */
  hours: Metric<{ asleepMin: number; average: number | null; sd?: number }>;
  /** Heart rate per minute across the main sleep, padded 15 minutes each side; a null minute is a gap. */
  nightHr: Metric<{ bed: number; wake: number; points: TimePoint[] }>;
  hoursVsNeed: Metric<{
    asleepMin: number;
    needMin: number;
    parts: { baselineMin: number; strainMin: number; debtMin: number; napMin: number };
    calibrating: boolean;
  }>;
  /** The last five nights' bed and wake times against the usual ones (WHOOP's Sleep Consistency chart); a missing night is null. */
  consistency: Metric<{
    pct: number;
    average: number | null;
    /**
     * Minutes from local midnight: bed negative when before it (22:30 is -90), wake positive. `typicalBed` and
     * `typicalWake` are that night's optimal times: the median of the 14 nights before it (WHOOP's moving dashed lines).
     */
    nights: ({ day: string; label: string; bed: number; wake: number; typicalBed: number | null; typicalWake: number | null } | null)[];
  }>;
  /** Deep and REM minutes per night, 30 nights ending on the day (WHOOP's Restorative sleep bars). */
  restorative: SplitPoint[];
  /** Sleep efficiency per night, % (WHOOP's Sleep efficiency trend). */
  efficiencyTrend: Trend;
  details: KeyStat[];
  debtTrend: Trend;
  planner: Metric<SleepPlanVM & { weekdayWake: boolean }>;
};

// ── Health ───────────────────────────────────────────────────────────────────

export type VitalKey = "resp" | "spo2" | "restingHr" | "hrv" | "skinTempDev";
export type Vital = {
  key: VitalKey;
  label: string;
  short: string;
  unit: string;
  metric: Metric<number>;
  range: { low: number; high: number } | null;
  status: "in_range" | "high" | "low" | "no_data";
  chip: { tone: ChipTone; text: string } | null;
  /** 30 days ending on the day, for the vital sheet. */
  trend: Trend;
};

export type HealthHubVM = {
  day: string;
  /** `paceDelta`: this week's Pace of Aging minus last week's; null without both. `pace` is null without 21 of 30 days. */
  healthspan: Metric<{ pulseAge: number; deltaYears: number; pace: number | null; paceDelta: number | null }>;
  monitor: Metric<{ vitals: { key: VitalKey; short: string; status: Vital["status"] }[]; inRange: number; total: number }>;
  stress: Metric<{ highMin: number; typicalHighMin: number | null; /** Today’s weekday, short ("Mon"). */ weekday: string; spark: TimePoint[] }>;
  fitness: Metric<{ vo2max: number; category: string; percentile: number; acwr: number | null; acwrTone: ChipTone | null }>;
  /** The newest band reading (epoch ms), today or not. */
  heartRate: { t: number; bpm: number } | null;
};
/** Alias: the task's name for the Health hub view model. */
export type HealthVM = HealthHubVM;

/** Minute-mean heart rate (`t` epoch ms, a null minute is a gap) and the newest sample; the live route's answer too. */
export type HeartRateLive = { points: TimePoint[]; latest: { t: number; bpm: number } | null };

export type HeartRateVM = HeartRateLive & {
  day: string;
  isToday: boolean;
  /** The day's end, epoch ms: live points stop there. */
  end: number;
  restingHr: number | null;
  /** The day's zone bounds for the chart's bands; the open top zone ends at `maxHr`. */
  zoneBands: ZoneRow[];
  maxHr: number;
  zones: Metric<ZoneRow[]>;
  zoneNote: string;
};

export type HealthspanContributor = {
  key: string;
  group: "sleep" | "strain" | "fitness";
  label: string;
  unit: string;
  metric: Metric<number>;
  target: number;
  years: number | null;
  domain: [number, number];
  higherIsBetter: boolean;
  caption?: string;
  explanation: string;
  source: string;
};

export type HealthspanVM = {
  day: string;
  weekStart: string;
  weekEnd: string;
  /** The stored day the result comes from (the shown week's Sunday, or the latest day). */
  asOf: string;
  nextUpdateInDays: number;
  age: number;
  /** `pace` is the weekly value (Mondays), null with fewer than 21 of the last 31 days scored for Recovery (`paceDays`). */
  result: Metric<{ pulseAge: number; deltaYears: number; pace: number | null; paceDays: number | null; paceProvisional: boolean; vo2maxSource: "run" | "daily" | "estimate" | null }>;
  insight: { title: string; body: string } | null;
  /** Pulse Age at each week end. */
  history: DayPoint[];
  contributors: HealthspanContributor[];
};

export type MonitorVM = {
  day: string;
  isToday: boolean;
  count: Metric<{ inRange: number; total: number; status: "within" | "out" | "illness"; outOfRange: number }>;
  illness: { level: string; score: number } | null;
  vitals: Vital[];
  heartRhythm: HeartRhythm;
  /** Weight and body fat always; blood glucose and core temperature only once the owner has ever had one. */
  measurements: Measurement[];
};

/** One ECG reading. `result` is Google's ResultClassification; `label`, `tone` and `explanation` are its copy. */
export type EcgReading = {
  id: string;
  /** Epoch ms. */
  at: number;
  day: string;
  /** Local "HH:mm". */
  time: string;
  result: string;
  label: string;
  tone: ChipTone;
  explanation: string;
  avgBpm: number | null;
};

/** Heart-rhythm records up to the selected day. */
export type HeartRhythm = {
  /** Newest first. */
  ecg: EcgReading[];
  irn: { count: number; /** Epoch ms of the newest. */ latestAt: number | null; latestDay: string | null };
};

/** The latest reading on or before the selected day, against the mean of readings in the 30 days before it. */
export type Measurement = KeyStat & { format: FormatKey };

export type StressVM = {
  day: string;
  isToday: boolean;
  gauge: Metric<{ value: number; level: StressLevel; at: number | null; dayAverage: boolean }>;
  insight: string | null;
  chart: Metric<{ points: TimePoint[]; spans: Span[]; now: number | null }>;
  levels: Metric<{
    lowMin: number;
    mediumMin: number;
    highMin: number;
    typicalDeltaMin: number | null;
    weekday: string;
    /** Mean minutes per level over the same weekday in the last 4 weeks; null without one. */
    typical: { lowMin: number; mediumMin: number; highMin: number } | null;
  }>;
  trend: Trend;
};

export type FitnessVM = {
  /** `source`: a measured value, Fitbit's estimate, or (mobile) Pulse's own estimate when there is neither. */
  vo2: Metric<{ value: number; source: "run" | "daily" | "estimate"; sourceDay: string; percentile: number; category: string; ageBand: string; sex: "male" | "female" }>;
  /** Mobile: Fitness Age from resting heart rate and activity (Nes 2011, after noop), and the VO2 max it estimates. */
  fitnessAge: Metric<{ fitnessAge: number; age: number; vo2max: number; method: "nes" | "uth"; activityIndex: number; restingHr: number; day: string }>;
  trend: Trend;
  trainingLoad: Metric<{ acwr: number; status: "detraining" | "optimal" | "pushing" | "high_risk"; tone: ChipTone }>;
  /** 90 days of CTL ("Fitness"), ATL ("Fatigue") and TSB ("Form"). */
  load: { day: string; ctl: number | null; atl: number | null; tsb: number | null }[];
  loadReason: { reason: ReasonCode; nightsLeft?: number } | null;
};

// ── Journal ──────────────────────────────────────────────────────────────────

export type JournalTag = { tag: string; label: string; group: "evening" | "recovery" | "context" | "custom"; isDefault: boolean; hidden: boolean };

/** More › Behaviours: every tag in check-in order, hidden ones included, with its answered-day count. */
export type BehavioursVM = { tags: (JournalTag & { answers: number })[] };

export type JournalVM = {
  day: string;
  today: string;
  strip: { day: string; done: boolean }[];
  tags: JournalTag[];
  checkIn: { done: boolean; entries: Record<string, number>; yes: { tag: string; label: string }[] };
  teaser: { text: string; ready: boolean };
  history: { day: string; yes: string[] }[];
};

export type ImpactMetricKey = "recovery" | "hrv" | "sleep";
export type JournalInsightsVM = {
  metric: ImpactMetricKey;
  unit: "%" | "SD";
  items: (DriverItem & { avgWith: number | null; avgWithout: number | null })[];
  needsMore: { key: string; label: string; yes: number; no: number }[];
};

// ── Reports ──────────────────────────────────────────────────────────────────

export type ReportVM = {
  period: string;
  kind: "week" | "month";
  start: string;
  end: string;
  partial: boolean;
  prev: string | null;
  next: string | null;
  latestWeek: string | null;
  latestMonth: string | null;
  dials: { key: "sleep" | "recovery" | "strain"; label: string; metric: Metric<number>; delta: number | null }[];
  insight: string | null;
  bands: Metric<StackedSegment[]>;
  averages: KeyStat[];
  trainingBalance: Metric<{ status: "balanced" | "overreaching" | "undertrained"; word: string; acwr: number; line: string }>;
  topImpacts: DriverItem[];
  bestWorst: { label: "Best day" | "Worst day"; day: string; recovery: number; strain: number | null }[] | null;
};

// ── More and Settings ────────────────────────────────────────────────────────

/** Matches the ShellStatus context. */
export type ShellStatusVM = {
  mode: "demo" | "google";
  sync: { state: "ok" | "syncing" | "stale" | "error"; lastSuccessAt: number | null };
  connection: "connected" | "not_connected" | "not_linked" | "no_device" | "importing" | "auth_revoked" | "stale";
  importProgress?: { done: number; total: number };
  today: string;
  firstDay?: string;
  timeZone?: string;
  /** Consecutive worn days ending `asOf` (today, or yesterday early in the day); null at 0. */
  streak: { days: number; asOf: string } | null;
};

export type SettingsVM = {
  mode: "demo" | "google";
  source: {
    label: "Demo data" | "Google Health";
    status: "demo" | "not_connected" | "not_linked" | "no_device" | "connected" | "revoked";
    needsPermissions?: boolean;
  };
  import: { done: number; total: number } | null;
  sync: { key: string; label: string; lastSuccessAt: number | null; status: "ok" | "stale" | "error" | "never"; error: string | null }[];
  profile: { birthDate: string; age: number; sex: "male" | "female"; maxHr: number; maxHrSource: "set" | "learned" | "estimated"; timeZone: string; heightCm: number | null; waistCm: number | null };
  version: string;
  scoringVersion: number;
};

export type MoreVM = {
  latestWeek: { period: string; start: string; end: string } | null;
  latestMonth: { period: string; start: string; end: string } | null;
  /** Periods with data, for the archive row's caption. */
  reportCount: number;
  /** Behaviours on the check-in sheet, and all of them. */
  behaviours: { shown: number; total: number };
  mode: "demo" | "google";
  version: string;
  scoringVersion: number;
};

/** Your data `/more/data`. */
export type YourDataVM = {
  /** First day with scores; null before any data. */
  first: string | null;
  /** Days in the daily-scores export. */
  days: number;
  /** Rows in the journal export. */
  answers: number;
  /** The database's size on the phone in bytes; null where nothing is kept on disk. */
  storageBytes: number | null;
  mode: "demo" | "google";
};

// ── Calendar (DateSwitcher month panel) ─────────────────────────────────────

/** One day's three headline scores; null when the day has none. Strain is a percent. */
export type CalendarDayVM = { day: string; recovery: number | null; strain: number | null; sleep: number | null };
/** Every day of `month` ("YYYY-MM"), first to last. */
export type CalendarMonthVM = { month: string; days: CalendarDayVM[] };
