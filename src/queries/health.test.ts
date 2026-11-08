// Health Monitor's view over the 180-day demo seed: each vital's number, status and the count agree.
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { BloodPressureReading, Profile } from "@/data/types";
import { addDays } from "@/lib/time";
import { runPipeline } from "@/pipeline";
import type { QueryCtx } from "./ctx";
import { getMonitor } from "./health";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
let ctx: QueryCtx;

beforeAll(async () => {
  const store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  await runPipeline(store, PROFILE, { today: TODAY });
  // The day's own readings drift from the night values Recovery read (as Health Connect's daily records do): the screen
  // must still show the value the monitor judged.
  const metrics = await store.allMetrics();
  await store.upsertMetrics(metrics.map((m) => ({ ...m, respBpm: m.respBpm == null ? null : m.respBpm + 4, hrvMs: m.hrvMs == null ? null : m.hrvMs * 2 })));
  ctx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: NOW, sync: { lastSyncTs: NOW, firstDay: addDays(TODAY, -179), lastError: null } };
}, 120_000);

describe("getMonitor", () => {
  it("judges the number it shows: a vital's status matches its value against its range, and the count matches the statuses", async () => {
    for (let k = 0; k < 90; k++) {
      const vm = await getMonitor(addDays(TODAY, -k), ctx);
      for (const v of vm.vitals) {
        if (v.status === "no_data" || !v.range || v.metric.value === null) continue;
        const within = v.metric.value >= v.range.low && v.metric.value <= v.range.high;
        expect(within, `${vm.day} ${v.key}: ${v.metric.value} against [${v.range.low}, ${v.range.high}] is ${v.status}`).toBe(v.status === "in_range");
      }
      if (vm.count.value) {
        expect(vm.count.value.inRange).toBe(vm.vitals.filter((v) => v.status === "in_range").length);
        expect(vm.count.value.outOfRange).toBe(vm.vitals.filter((v) => v.status === "high" || v.status === "low").length);
      }
    }
  });
});

async function makeCtx(store: MemoryStore, today = "2026-05-15"): Promise<QueryCtx> {
  return {
    store,
    timeZone: "UTC",
    profile: { birthDate: "1990-01-01", sex: "male", maxHr: 185, heightCm: 175, timeZone: "UTC" },
    today,
    now: Date.parse(`${today}T12:00:00Z`) / 1000,
    sync: await store.getSyncState(),
  };
}

function makeReading(
  id: string,
  day: string,
  timeStr: string,
  sys: number,
  dia: number,
): BloodPressureReading {
  return {
    id,
    day,
    ts: Date.parse(`${day}T${timeStr}Z`) / 1000,
    systolicMmhg: sys,
    diastolicMmhg: dia,
    bodyPosition: "sitting",
    measurementLocation: "left_upper_arm",
    quality: "direct",
    importedAt: Date.now() / 1000,
  };
}

describe("getMonitor with blood pressure", () => {
  it("includes blood pressure as 6th vital and attaches bloodPressure summary", async () => {
    const store = new MemoryStore();
    const reading = makeReading("bp-1", "2026-05-15", "08:15:00", 118, 76);
    await store.insertBloodPressure([reading]);

    const ctx = await makeCtx(store, "2026-05-15");
    const vm = await getMonitor("2026-05-15", ctx);

    // 6 vitals: resp, spo2, restingHr, hrv, skinTempDev, bp
    expect(vm.vitals).toHaveLength(6);
    const bpVital = vm.vitals.find((v) => v.key === "bp");
    expect(bpVital).toBeDefined();
    expect(bpVital?.label).toBe("Blood pressure");
    expect(bpVital?.short).toBe("BP");
    expect(bpVital?.unit).toBe("mmHg");
    expect(bpVital?.customValue).toBe("118/76");
    expect(bpVital?.status).toBe("in_range");
    expect(bpVital?.chip).toEqual({ tone: "optimal", text: "Normal" });
    expect(bpVital?.bp).toEqual({
      systolic: 118,
      diastolic: 76,
      category: "normal",
    });

    // Summary attached to monitor
    expect(vm.bloodPressure).toBeDefined();
    expect(vm.bloodPressure.latest.value).toMatchObject({
      id: "bp-1",
      systolic: 118,
      diastolic: 76,
      category: "normal",
      time: "08:15",
    });
  });

  it("handles elevated or hypertension stages with appropriate chips and status", async () => {
    const store = new MemoryStore();
    const reading = makeReading("bp-stage2", "2026-05-15", "14:00:00", 145, 92);
    await store.insertBloodPressure([reading]);

    const ctx = await makeCtx(store, "2026-05-15");
    const vm = await getMonitor("2026-05-15", ctx);

    const bpVital = vm.vitals.find((v) => v.key === "bp");
    expect(bpVital?.status).toBe("high");
    expect(bpVital?.chip).toEqual({ tone: "alert", text: "Stage 2" });
    expect(bpVital?.bp?.category).toBe("stage2");
  });

  it("shows prior reading chip when current day has no reading but prior exists", async () => {
    const store = new MemoryStore();
    const reading = makeReading("bp-prior", "2026-05-10", "11:00:00", 124, 78);
    await store.insertBloodPressure([reading]);

    const ctx = await makeCtx(store, "2026-05-15");
    const vm = await getMonitor("2026-05-15", ctx);

    const bpVital = vm.vitals.find((v) => v.key === "bp");
    expect(bpVital?.status).toBe("no_data");
    expect(bpVital?.customValue).toBeUndefined();
    expect(bpVital?.chip).toEqual({ tone: "neutral", text: "Prior: 124/78" });
    expect(bpVital?.bp).toBeNull();
  });
});
