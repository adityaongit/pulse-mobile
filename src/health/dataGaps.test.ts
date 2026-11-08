// The data-gap checks over the demo seed on the in-memory store, scored by the pipeline: Health Connect's records
// (mocked, built from what the seed stored) against Pulse's rows, the empty-type probe, and stuck headline scores.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { ScoreRow } from "@/data/store";
import type { Metrics, Profile } from "@/data/types";
import { addDays } from "@/lib/time";
import { runPipeline } from "@/pipeline";
import { summarize, type RawRecord } from "./dataCheckSummary";
import { importMismatches, runDataGapChecks, stuckScores } from "./dataGaps";

const hc = vi.hoisted(() => ({ raw: {} as Record<string, unknown[]>, empty: new Set<string>() }));
const telemetry = vi.hoisted(() => ({ once: vi.fn(async () => true), report: vi.fn(async () => {}) }));
vi.mock("@/lib/telemetry", () => telemetry);
vi.mock("./connect", () => ({
  permissionState: async () => ({ granted: ["Steps", "RestingHeartRate", "HeartRateVariabilityRmssd", "Distance", "SleepSession", "BloodGlucose"], missing: [], history: true, background: true }),
  readAll: async (type: string) => hc.raw[type] ?? [],
  hasRecords: async (type: string) => !hc.empty.has(type),
}));

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = new Date("2026-10-02T14:00:00+05:30");
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
const fitbit = { dataOrigin: "com.fitbit.FitbitMobile", device: { type: 1 } };
const at = (day: string, t: string) => `${day}T${t}+05:30`;

let store: MemoryStore;
let metrics: Map<string, Metrics>;
/** The six whole days the check counts, oldest first. */
const DAYS = Array.from({ length: 6 }, (_, i) => addDays(TODAY, i - 6));

beforeAll(async () => {
  store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW.getTime() / 1000, days: 35 });
  await runPipeline(store, PROFILE, { today: TODAY });
  metrics = new Map((await store.allMetrics()).map((m) => [m.day, m]));
});

/** Health Connect holding what Pulse stored: steps and resting HR as one record a day. */
function rawFromStore(): Record<string, RawRecord[]> {
  const days = DAYS.filter((d) => metrics.get(d)?.steps != null);
  return {
    Steps: days.map((d) => ({ metadata: fitbit, startTime: at(d, "12:00:00"), endTime: at(d, "12:30:00"), count: metrics.get(d)!.steps })),
    RestingHeartRate: days.map((d) => ({ metadata: fitbit, time: at(d, "08:00:00"), beatsPerMinute: metrics.get(d)!.rhrBpm ?? 60 })),
  };
}

describe("importMismatches", () => {
  it("is quiet when Health Connect and Pulse agree", async () => {
    const raw = rawFromStore();
    const checked = summarize(raw, [], [...metrics.values()], [], [TODAY, ...DAYS], TZ);
    expect(await importMismatches(checked, TODAY)).toEqual([]);
  });

  it("counts the days Pulse stored nothing or a value no source has, leaving out today and single odd days", async () => {
    const raw = rawFromStore();
    // HRV in Health Connect for four days; Pulse's own for the last two, far from it.
    raw.HeartRateVariabilityRmssd = DAYS.slice(-4).map((d) => ({ metadata: fitbit, time: at(d, "03:00:00"), heartRateVariabilityMillis: 400 }));
    // Distance on one day only: one odd day is not reported.
    raw.Distance = [{ metadata: fitbit, startTime: at(DAYS[0], "09:00:00"), endTime: at(DAYS[0], "10:00:00"), distance: { inMeters: 5000 } }];
    // Today has records Pulse has not stored yet.
    raw.Steps.push({ metadata: fitbit, startTime: at(TODAY, "09:00:00"), endTime: at(TODAY, "10:00:00"), count: 99_999 });
    const rows = [...metrics.values()].map((m) => (DAYS.slice(-4, -2).includes(m.day) ? { ...m, hrvMs: null } : m));
    const checked = summarize(raw, [], rows, [], [TODAY, ...DAYS], TZ);
    expect(await importMismatches(checked, TODAY)).toEqual([{ metric: "hrv", days: 4 }]);
  });
});

describe("stuckScores", () => {
  const yesterday = addDays(TODAY, -1);
  const recent = () => store.scoresIn({ from: addDays(yesterday, -13), to: yesterday });
  const stuck = (rows: ScoreRow[], days: string[], reason: "no_hrv_last_night" | "calibrating") =>
    rows.map((r) => (days.includes(r.day) && r.recovery ? { ...r, recovery: { ...r.recovery, value: null, reason } } : r));

  it("finds nothing on the demo person's recent days", async () => {
    expect(await stuckScores(await recent(), yesterday)).toEqual([]);
  });

  it("reports a score held on one reason for three worn days or more", async () => {
    const rows = stuck(await recent(), [yesterday, addDays(yesterday, -1), addDays(yesterday, -2)], "no_hrv_last_night");
    expect(await stuckScores(rows, yesterday)).toEqual([{ score: "recovery", reason: "no_hrv_last_night", days: 3 }]);
  });

  it("leaves out two days, calibrating, and days the band was off", async () => {
    const rows = await recent();
    expect(await stuckScores(stuck(rows, [yesterday, addDays(yesterday, -1)], "no_hrv_last_night"), yesterday)).toEqual([]);
    expect(await stuckScores(stuck(rows, [yesterday, addDays(yesterday, -1), addDays(yesterday, -2)], "calibrating"), yesterday)).toEqual([]);
    const off = stuck(rows, [yesterday, addDays(yesterday, -1), addDays(yesterday, -2)], "no_hrv_last_night").map((r) =>
      r.day === addDays(yesterday, -1) ? { ...r, strain: r.strain && { ...r.strain, hrCount: 0 }, sleep: r.sleep && { ...r.sleep, main: null } } : r,
    );
    expect((await stuckScores(off, yesterday)).find((s) => s.score === "recovery")).toBeUndefined();
  });
});

describe("runDataGapChecks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hc.raw = rawFromStore();
    hc.empty = new Set();
  });

  it("reports mismatches and empty core types by name and count only", async () => {
    hc.raw.Distance = DAYS.slice(-3).map((d) => ({ metadata: fitbit, startTime: at(d, "09:00:00"), endTime: at(d, "10:00:00"), distance: { inMeters: 123_456 } }));
    hc.empty = new Set(["Distance", "BloodGlucose", "HeartRate"]);
    await runDataGapChecks(store, TZ, NOW);
    const calls = telemetry.report.mock.calls as unknown as [string, Record<string, unknown>?][];
    expect(calls).toContainEqual(["import.mismatch.distance", { days: 3 }]);
    // Distance is granted and empty; glucose is an optional extra and heart rate is not granted.
    expect(calls.filter(([code]) => code.startsWith("import.empty."))).toEqual([["import.empty.Distance"]]);
    expect(JSON.stringify(calls)).not.toMatch(/123|456/);
  });

  it("runs only when the day's gate allows", async () => {
    telemetry.once.mockResolvedValueOnce(false);
    await runDataGapChecks(store, TZ, NOW);
    expect(telemetry.report).not.toHaveBeenCalled();
  });
});
