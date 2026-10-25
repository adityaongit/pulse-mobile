/**
 * Screen view-model queries, ported from Pulse's src/server/queries. Every query takes a `QueryCtx` (ctx.ts) and reads
 * the Store; the VM shapes (types.ts) are the web app's, verbatim, so the ported UI consumes them unchanged.
 *
 * Queries
 *   getHome(day, ctx, opts?)            → HomeVM           Home: dials, strip, monitor, stress, timeline, Energy Bank, tonight, key stats
 *   getRecovery(day, ctx)               → RecoveryVM       Recovery: score, band, contributors, drivers, forecast, 182-day trend
 *   getSleep(day, ctx)                  → SleepVM          Sleep: performance, hypnogram, night HR, consistency, planner, trends
 *   getStrain(day, ctx)                 → StrainVM         Strain: score, target, coach, HR chart, zones, activities, calories, workouts
 *   getActivities(days, ctx)            → ActivitiesVM     Workouts grouped by day, newest first
 *   getActivity(id, ctx)                → ActivityVM|null  One workout: stats, HR window, zones with typicals, HRR
 *   getHealthHub(ctx) / getHealth(ctx)  → HealthHubVM      Health hub: Pulse Age, monitor, stress, fitness, latest HR
 *   getHealthspan(day, ctx)             → HealthspanVM     Pulse Age for the ISO week, contributors, 26-week history
 *   getMonitor(day, ctx, rows?)         → MonitorVM        Health Monitor: five vitals with ranges, illness, measurements
 *   getStress(day, ctx)                 → StressVM         Stress Monitor: gauge, chart, levels against the same weekday
 *   getFitness(ctx)                     → FitnessVM        VO2 max, ACWR, 90 days of CTL/ATL/TSB
 *   getHeartRate(day, ctx)              → HeartRateVM      Minute-mean HR for the day, zones
 *   hrMinutes(ctx, from, to)            → HeartRateLive    Minute-mean HR over a window (the live chart's feed)
 *   getTrends(metric, ctx)              → TrendsVM         One metric over 365 days with W/M/6M/1Y averages
 *   getMetricDetail(key, day, ctx) / getMetric → MetricDetailVM (MetricVM)  A metric's own screen with its sections
 *   getCalendarMonth(month, ctx)        → CalendarMonthVM  Recovery, Strain and Sleep for every day of a month
 *
 * VM types (types.ts): HomeVM, RecoveryVM, StrainVM, ActivitiesVM, ActivityVM, SleepVM, HealthHubVM (HealthVM),
 * HeartRateVM, HeartRateLive, HealthspanVM, MonitorVM, StressVM, FitnessVM, CalendarMonthVM, CalendarDayVM, plus the
 * building blocks (Metric, KeyStat, Trend, DayPoint, SplitPoint, TimePoint, Span, ZoneRow, DriverItem, TimelineItem,
 * SleepPlanVM, EnergyBankVM, Contributor, Vital, HealthspanContributor, Measurement, HeartRhythm, EcgReading) and the
 * web's remaining VM types kept for the UI (JournalVM, ReportVM, SettingsVM, MoreVM, ShellStatusVM, YourDataVM…).
 * TrendsVM lives in trends.ts and MetricDetailVM in metric.ts, as on the web.
 */
export type { QueryCtx } from "./ctx";
export * from "./types";
export {
  type DayRow,
  type ExerciseRow,
  type MetricsRow,
  ACTIVITY_NAME,
  activityItem,
  activityKind,
  distanceOf,
  firstDay,
  lastStored,
  loadDays,
  loadSeries,
  maxHrOf,
  recoveryMetric,
  sleepMetric,
  strainMetric,
  stressNow,
  timeline,
  timelineOf,
  todayOf,
} from "./common";
export { getHome, type HomeOptions, VITAL_LABEL, REVIEW_FROM_MIN, dashboardDefault, dashboardKeys, keyStats, illnessRaised, latestReport } from "./home";
export { getRecovery, driverItems, driverLabel, contributors, insightOf as recoveryInsight } from "./recovery";
export { getSleep, nightHrOf, consistencyOf, insightOf as sleepInsight } from "./sleep";
export { getStrain, STRAIN_EXTRAS, calorieSplit, coach, zoneBounds, zoneNote, zoneRows, hrChart, hrChartOf } from "./strain";
export { getActivities, ACTIVITY_PAGE_DAYS } from "./activities";
export { getActivity, withTypical } from "./activity";
export {
  getTraining,
  getHrvStatus,
  trainingEffectVM,
  type TrainingVM,
  type TrainingReadinessVM,
  type RecoveryTimeVM,
  type TrainingStatusVM,
  type TrainingEffectVM,
  type HrvStatusVM,
} from "./training";
export { getHealthHub, getHealth, getHealthspan, getMonitor, getStress, getFitness, getHeartRate, hrMinutes, acwrStatus, ECG_RESULT, NO_RESULT } from "./health";
export { getTrends, parseTrendMetric, TREND_GROUPS, TREND_METRICS, type TrendGroup, type TrendMetric, type TrendMetricKey, type TrendsVM } from "./trends";
export {
  getMetricDetail,
  getMetric,
  DETAIL_KEYS,
  isDetailKey,
  rangeStats,
  STEP_TARGET,
  WEEKLY_TARGET,
  type DetailKey,
  type Extreme,
  type Hour,
  type MetricDetailVM,
  type MetricVM,
  type Point,
  type RangeStats,
  type Section,
} from "./metric";
export { getCalendarMonth, MONTH } from "./calendar";
export {
  type BloodPressureItem,
  type BloodPressurePoint,
  type BloodPressureSummary,
  getBloodPressureSummary,
} from "./bloodPressure";
export {
  type VascularDriverKey,
  getVascular,
  getVascularViewModel,
} from "./vascular";
export {
  type DashboardKey,
  type BodyKey,
  type ExtraKey,
  type ExtraMetric,
  type FormatKey,
  type TrendRange,
  type LoggedEntry,
  type LogType,
  DASHBOARD_DEFAULT,
  DASHBOARD_GROUPS,
  DASHBOARD_LABEL,
  DASHBOARD_METRICS,
  BODY_METRICS,
  EXTRA_KEYS,
  EXTRA_METRICS,
  PHONE_DEFAULT,
  PHONE_STATS,
  RANGE_DAYS,
  RANGES,
  isDashboardKey,
  extraMetric,
  metricHref,
} from "./_lib";
