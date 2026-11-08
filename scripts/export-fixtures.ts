// Exports parity fixtures for the native port (pulse-android, docs/plan.md § 6): the 180-day demo seeded into the
// in-memory Store at a fixed instant, the rows the seed wrote, everything the pipeline stored, and the screen view
// models for a fixed set of dates, as JSON. Deterministic: two runs write byte-identical files.
//
//   pnpm export-fixtures [outDir]      (default ~/personal/pulse-android/fixtures/demo)
//
// JSON rules: object keys sorted, `undefined` fields omitted, NaN and ±Infinity written as the strings "NaN",
// "Infinity" and "-Infinity". Arrays keep their order (rows are sorted by their key first). A file whose JSON is over
// 1 MB is written gzipped (`.json.gz`).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { initI18n } from "@/i18n/config";
import { MemoryStore } from "@/data/memory";
import { DEMO_PROFILE, SCENARIO, seedDemo } from "@/data/seed";
import type { SeriesKind } from "@/data/store";
import type { Profile } from "@/data/types";
import { addDays, localMidnight } from "@/lib/time";
import { TREND_VIEW_RANGES } from "@/lib/trend";
import { PLAN_DEFAULTS } from "@/core/algorithms/weeklyPlan";
import { NO_CUSTOM } from "@/nutrition/targets";
import { runPipeline, SCORING_VERSION } from "@/pipeline";
import * as Q from "@/queries";
import type { QueryCtx } from "@/queries";
import { getActivityCost } from "@/queries/activityCost";
import { CHART_METRICS, DAY_VIEW, getChartDay, getChartSeries, type DayView } from "@/queries/chart";
import { getHomeDashboard } from "@/queries/homeExtras";
import { getDayLog } from "@/queries/journalExtras";
import { getBehaviours, getJournal, getJournalInsights } from "@/queries/journal";
import { getLog } from "@/queries/log";
import { getActivityExtras, getNap, getRecoveryExtras, getSleepExtras } from "@/queries/mobileExtras";
import { getNutrition } from "@/queries/nutrition";
import { getReport, getReportArchive } from "@/queries/reports";
import { getMore, getSettings, getYourData } from "@/queries/settings";
import { getWearStreak } from "@/queries/shell";
import { sleepGoalView } from "@/queries/sleepGoal";
import { getTrendView, TREND_VIEW, type TrendViewKey } from "@/queries/trendView";
import { getWeeklyPlan } from "@/queries/weeklyPlan";

// The pipeline tests' demo (src/pipeline/pipeline.test.ts): Friday 2026-10-02 14:00 IST, max HR 183, height 178 cm.
const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
const SERIES: SeriesKind[] = ["hr", "still_hr", "stress", "energy_bank"];
const GZIP_OVER = 1_000_000;

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(process.argv[2] ?? path.join(os.homedir(), "personal/pulse-android/fixtures/demo"));

/** A JSON-safe copy: keys sorted, undefined dropped (null in arrays, as JSON.stringify), non-finite numbers as strings. */
function norm(x: unknown): unknown {
  if (typeof x === "number") return Number.isFinite(x) ? x : String(x);
  if (x === null || typeof x !== "object") return x;
  if (x instanceof Map || x instanceof Set) throw new Error("Map or Set in a fixture: convert it first");
  if (Array.isArray(x)) return x.map((v) => (v === undefined ? null : norm(v)));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x).sort()) {
    const v = (x as Record<string, unknown>)[k];
    if (v !== undefined && typeof v !== "function") out[k] = norm(v);
  }
  return out;
}

const files: { file: string; bytes: number }[] = [];

/** Writes `name`.json (or .json.gz when large); an array goes one element per line so diffs stay readable. */
function write(name: string, value: unknown) {
  const v = norm(value);
  const json = Array.isArray(v) ? (v.length ? `[\n${v.map((r) => JSON.stringify(r)).join(",\n")}\n]\n` : "[]\n") : `${JSON.stringify(v)}\n`;
  const gz = Buffer.byteLength(json) > GZIP_OVER;
  const file = `${name}.json${gz ? ".gz" : ""}`;
  const full = path.join(OUT, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.rmSync(gz ? full.slice(0, -3) : `${full}.gz`, { force: true });
  const data = gz ? zlib.gzipSync(json, { level: 9 }) : Buffer.from(json);
  fs.writeFileSync(full, data);
  files.push({ file, bytes: data.length });
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

async function main() {
  initI18n("en");
  const store = new MemoryStore();
  const seedProfile = await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  await store.setProfile(PROFILE);

  // ── Inputs: what the seed wrote ───────────────────────────────────────────
  const sessions = (await store.allSessions()).sort((a, b) => a.startTs - b.startTs || cmp(a.id, b.id));
  const all = { lo: -Number.MAX_SAFE_INTEGER, hi: Number.MAX_SAFE_INTEGER };
  write("input/metrics", (await store.allMetrics()).sort((a, b) => cmp(a.day, b.day)));
  write("input/sessions", sessions);
  write("input/segments", await store.segmentsFor(sessions.map((s) => s.id)));
  write("input/exercises", (await store.allExercises()).sort((a, b) => a.startTs - b.startTs || cmp(a.id, b.id)));
  write("input/dailyValues", (await store.dailyValues()).sort((a, b) => cmp(a.day, b.day) || cmp(a.key, b.key)));
  write("input/journal", (await store.allJournal()).sort((a, b) => cmp(a.day, b.day) || cmp(a.tag, b.tag)));
  write("input/healthRecords", await store.healthRecords());
  write("input/loggedEntries", (await store.loggedEntries(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).reverse());
  write("input/journalTags", await store.journalTags());
  write("input/hr", await store.readHr(all.lo, all.hi));
  write("input/hrv", await store.readHrv(all.lo, all.hi));
  write("input/steps", await store.readSteps(all.lo, all.hi));
  const syncState = await store.getSyncState();
  write("input/syncState", syncState);

  // ── Pipeline output ───────────────────────────────────────────────────────
  const run = await runPipeline(store, PROFILE, { today: TODAY });
  const scores = await store.scoresIn({ from: "0000-00-00", to: "9999-99-99" });
  write("output/scores", scores);
  const series = [];
  for (const r of scores) for (const kind of SERIES) {
    const data = await store.getSeries(r.day, kind);
    if (data) series.push({ day: r.day, kind, data });
  }
  write("output/series", series);
  write("output/reports", await store.getReports());
  write("output/activityCost", await store.getActivityCost());
  write("output/checkpoint", { json: await store.getCheckpoint() });
  write("output/run", run);
  write("output/dailyValues", (await store.dailyValues()).sort((a, b) => cmp(a.day, b.day) || cmp(a.key, b.key)));

  // ── View models ───────────────────────────────────────────────────────────
  const ctx: QueryCtx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: NOW, sync: await store.getSyncState() };
  const anchor = scores[0].day;
  const at = (i: number) => addDays(anchor, i);
  const exercises = (await store.allExercises()).sort((a, b) => a.startTs - b.startTs || cmp(a.id, b.id));
  const workoutDay = [...exercises].reverse().find((e) => e.day < TODAY)!.day;
  const firstRecovery = scores.find((r) => r.recovery?.value != null)?.day ?? at(SCENARIO.calibratingDays);
  const DAYS: Record<string, string> = {
    today: TODAY,
    yesterday: addDays(TODAY, -1),
    daysAgo30: addDays(TODAY, -30),
    firstScored: anchor,
    firstRecovery,
    workout: workoutDay,
    illnessPeak: at(SCENARIO.illness.start + 2),
    bandOff: at(SCENARIO.bandOff.day + 1),
    noHrvNight: at(SCENARIO.noHrvNight),
    shortSleepEnd: at(SCENARIO.shortSleep.end),
  };
  const days = [...new Set(Object.values(DAYS))];

  const calls: Record<string, { query: string; args: unknown[]; result: unknown }[]> = {};
  const skipped: { query: string; reason: string }[] = [];
  const call = async (query: string, args: unknown[], fn: () => Promise<unknown>) => {
    (calls[query] ??= []).push({ query, args, result: await fn() });
  };

  for (const d of days) {
    await call("getHome", [d], () => Q.getHome(d, ctx));
    await call("getHomeDashboard", [d, null], () => getHomeDashboard(d, ctx, null));
    await call("getRecovery", [d], () => Q.getRecovery(d, ctx));
    await call("getRecoveryExtras", [d], () => getRecoveryExtras(d, ctx));
    const sleep = await Q.getSleep(d, ctx);
    (calls.getSleep ??= []).push({ query: "getSleep", args: [d], result: sleep });
    await call("getSleepExtras", [d, sleep.stages], () => getSleepExtras(d, ctx, sleep.stages));
    await call("getStrain", [d], () => Q.getStrain(d, ctx));
    await call("getTraining", [d], () => Q.getTraining(d, ctx));
    await call("getHrvStatus", [d], () => Q.getHrvStatus(d, ctx));
    await call("getHealthspan", [d], () => Q.getHealthspan(d, ctx));
    await call("getMonitor", [d], () => Q.getMonitor(d, ctx));
    await call("getStress", [d], () => Q.getStress(d, ctx));
    await call("getHeartRate", [d], () => Q.getHeartRate(d, ctx));
    await call("getDayLog", [d], () => getDayLog(d, ctx));
    await call("getJournal", [d], () => getJournal(d, ctx));
    await call("getWeeklyPlan", [d, PLAN_DEFAULTS], () => getWeeklyPlan(d, ctx, PLAN_DEFAULTS));
    for (const v of Object.keys(DAY_VIEW) as DayView[]) await call("getChartDay", [v, d], () => getChartDay(v, d, ctx));
  }
  for (const k of Q.DETAIL_KEYS)
    for (const d of [TODAY, DAYS.daysAgo30]) await call("getMetricDetail", [k, d], () => Q.getMetricDetail(k, d, ctx));
  for (const m of Q.TREND_METRICS) await call("getTrends", [m.key], () => Q.getTrends(m.key, ctx));
  for (const k of Object.keys(TREND_VIEW) as TrendViewKey[])
    for (const r of TREND_VIEW_RANGES) for (const off of [0, 1]) await call("getTrendView", [k, TODAY, r, off], () => getTrendView(k, TODAY, r, off, ctx));
  for (const m of CHART_METRICS) await call("getChartSeries", [m.key], () => getChartSeries(m.key, ctx));
  for (const month of ["2026-04", "2026-08", "2026-09", "2026-10"]) await call("getCalendarMonth", [month], () => Q.getCalendarMonth(month, ctx));
  for (const n of [Q.ACTIVITY_PAGE_DAYS, 180]) await call("getActivities", [n], () => Q.getActivities(n, ctx));
  const recent = exercises.filter((e) => e.day >= addDays(TODAY, -13) || e.day === workoutDay);
  for (const e of recent) {
    await call("getActivity", [e.id], () => Q.getActivity(e.id, ctx));
    await call("getActivityExtras", [e.id], () => getActivityExtras(e.id, ctx));
  }
  const naps = sessions.filter((s) => !s.isMain).slice(-5);
  for (const s of naps) await call("getNap", [s.id], () => getNap(s.id, ctx));
  if (!naps.length) skipped.push({ query: "getNap", reason: "the demo seed has no naps" });
  for (const p of (await store.getReports()).map((r) => r.period)) await call("getReport", [p], () => getReport(p, ctx));
  await call("getReportArchive", [], () => getReportArchive(ctx));
  for (const k of ["week", "month"] as const) await call("latestReport", [k], () => Q.latestReport(ctx, k));
  for (const m of ["recovery", "hrv", "sleep"] as const) await call("getJournalInsights", [m], () => getJournalInsights(m, ctx));
  await call("getBehaviours", [], () => getBehaviours(ctx));
  await call("getHealthHub", [], () => Q.getHealthHub(ctx));
  await call("getFitness", [], () => Q.getFitness(ctx));
  await call("hrMinutes", [NOW - 3 * 3600, NOW], () => Q.hrMinutes(ctx, NOW - 3 * 3600, NOW));
  const mid = localMidnight(DAYS.yesterday, TZ);
  await call("hrMinutes", [mid, mid + 86_400], () => Q.hrMinutes(ctx, mid, mid + 86_400));
  await call("getActivityCost", [], () => getActivityCost(ctx));
  await call("sleepGoalView", [], () => sleepGoalView(ctx));
  await call("getWearStreak", [], () => getWearStreak(ctx));
  await call("getNutrition", [NO_CUSTOM], () => getNutrition(ctx, NO_CUSTOM));
  await call("getLog", [{ demo: true }], () => getLog(ctx, { demo: true }));
  await call("dashboardDefault", [], () => Q.dashboardDefault(ctx));
  await call("firstDay", [], () => Q.firstDay(ctx));
  await call("lastStored", [TODAY], () => Q.lastStored(ctx, TODAY));
  await call("getSettings", [], () => getSettings(ctx));
  await call("getMore", ["demo"], () => getMore(ctx, "demo"));
  await call("getYourData", ["demo"], () => getYourData(ctx, "demo"));
  skipped.push(
    { query: "getHealth, getMetric", reason: "aliases of getHealthHub and getMetricDetail" },
    { query: "getGoalsDay", reason: "its Goals default (DEFAULT_GOALS) lives in src/state/goals.ts, which imports AsyncStorage and React" },
    { query: "exportFile, dailyTable, journalTable", reason: "data export (CSV/JSON files), not a screen view model" },
  );

  const views = Object.keys(calls).sort();
  for (const q of views) write(`views/${q}`, calls[q]);

  const git = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  const importVersion = /export const IMPORT_VERSION = (\d+)/.exec(fs.readFileSync(path.join(ROOT, "src/health/sync.ts"), "utf8"));
  files.sort((a, b) => cmp(a.file, b.file));
  write("meta", {
    source: "pulse-mobile scripts/export-fixtures.ts",
    pulseMobileCommit: git("rev-parse", "HEAD"),
    pulseMobileDirty: git("status", "--porcelain", "--", "src", "scripts", "app.json") !== "",
    node: process.version,
    profile: PROFILE,
    seedProfile,
    seedOptions: { today: TODAY, timeZone: TZ, now: NOW, days: 180 },
    demoProfile: DEMO_PROFILE,
    zone: TZ,
    today: TODAY,
    now: NOW,
    scoringVersion: SCORING_VERSION,
    importVersion: importVersion ? Number(importVersion[1]) : null,
    language: "en",
    locale: "en-US",
    display: { units: "metric", hours: 24 },
    dates: DAYS,
    queries: views.map((q) => ({ query: q, calls: calls[q].length })),
    skipped,
    json: {
      keys: "sorted",
      undefined: "omitted (null inside arrays)",
      nonFinite: 'NaN, Infinity and -Infinity are the strings "NaN", "Infinity", "-Infinity"',
      gzip: `files over ${GZIP_OVER} bytes of JSON are .json.gz`,
      arrays: "one element per line",
    },
    files,
  });
  for (const f of files) console.log(`${String(f.bytes).padStart(10)}  ${f.file}`);
  console.log(`${files.reduce((s, f) => s + f.bytes, 0)} bytes in ${files.length} files → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
