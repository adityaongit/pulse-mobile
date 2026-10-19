import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import type { BloodPressureReading } from "@/data/types";
import { getBloodPressureSummary } from "./bloodPressure";
import type { QueryCtx } from "./common";

const TZ = "UTC";
const DAY = "2026-10-02";

function makeCtx(store: MemoryStore): QueryCtx {
  return {
    store,
    timeZone: TZ,
    profile: {
      birthDate: "1990-01-01",
      sex: "male",
      heightCm: 180,
      maxHr: 190,
      timeZone: TZ,
    },
    today: DAY,
    now: Date.parse(`${DAY}T14:00:00Z`) / 1000,
    sync: {
      firstDay: null,
      lastSyncTs: null,
      lastError: null,
    },
  };
}

describe("getBloodPressureSummary", () => {
  it("returns honest empty state when no readings exist", async () => {
    const store = new MemoryStore();
    const ctx = makeCtx(store);
    const summary = await getBloodPressureSummary(DAY, ctx);

    expect(summary.day).toBe(DAY);
    expect(summary.latest.value).toBeNull();
    expect(summary.latest.reason).toBe("no_data");
    expect(summary.readings).toHaveLength(0);
    expect(summary.latestPrior).toBeNull();
    expect(summary.dayStats).toBeNull();
    expect(summary.baseline).toBeNull();
    expect(summary.history).toHaveLength(30);
    expect(summary.history.every((p) => p.systolic === null && p.diastolic === null)).toBe(true);
    expect(summary.distribution).toEqual({
      normal: 0,
      elevated: 0,
      stage1: 0,
      stage2: 0,
      crisis: 0,
    });
  });

  it("extracts latest reading and calculates day statistics", async () => {
    const store = new MemoryStore();
    const ctx = makeCtx(store);
    const midTs = Date.parse(`${DAY}T00:00:00Z`) / 1000;

    const readings: BloodPressureReading[] = [
      {
        id: "bp-1",
        day: DAY,
        ts: midTs + 8 * 3600, // 08:00
        systolicMmhg: 118,
        diastolicMmhg: 78,
        quality: "manual",
        importedAt: 1,
      },
      {
        id: "bp-2",
        day: DAY,
        ts: midTs + 16 * 3600, // 16:00
        systolicMmhg: 124,
        diastolicMmhg: 82,
        quality: "manual",
        importedAt: 1,
      },
    ];
    await store.upsertBloodPressure(readings);

    const summary = await getBloodPressureSummary(DAY, ctx);
    expect(summary.latest.value).not.toBeNull();
    // Latest reading by ts is bp-2
    expect(summary.latest.value?.id).toBe("bp-2");
    expect(summary.latest.value?.systolic).toBe(124);
    expect(summary.latest.value?.diastolic).toBe(82);
    expect(summary.latest.value?.category).toBe("stage1"); // 82 diastolic is stage 1
    expect(summary.latest.value?.time).toBe("16:00");

    // All readings returned newest first
    expect(summary.readings).toHaveLength(2);
    expect(summary.readings[0].id).toBe("bp-2");
    expect(summary.readings[1].id).toBe("bp-1");

    // Day stats
    expect(summary.dayStats).toEqual({
      avgSystolic: 121,
      avgDiastolic: 80,
      minSystolic: 118,
      maxSystolic: 124,
      minDiastolic: 78,
      maxDiastolic: 82,
      count: 2,
    });
  });

  it("strictly enforces causality: ignores readings on future days", async () => {
    const store = new MemoryStore();
    const ctx = makeCtx(store);
    const midTs = Date.parse(`${DAY}T00:00:00Z`) / 1000;

    await store.upsertBloodPressure([
      {
        id: "bp-today",
        day: DAY,
        ts: midTs + 10 * 3600,
        systolicMmhg: 115,
        diastolicMmhg: 75,
        quality: "manual",
        importedAt: 1,
      },
      {
        id: "bp-tomorrow",
        day: "2026-10-03",
        ts: midTs + 30 * 3600,
        systolicMmhg: 160,
        diastolicMmhg: 100,
        quality: "manual",
        importedAt: 1,
      },
    ]);

    const summary = await getBloodPressureSummary(DAY, ctx);
    expect(summary.latest.value?.id).toBe("bp-today");
    expect(summary.readings).toHaveLength(1);
    expect(summary.distribution.stage2).toBe(0); // Future stage 2 reading must not leak
  });

  it("calculates 30-day baseline and latestPrior when today has no readings", async () => {
    const store = new MemoryStore();
    const ctx = makeCtx(store);
    const priorDay = "2026-10-01";
    const midTs = Date.parse(`${priorDay}T00:00:00Z`) / 1000;

    await store.upsertBloodPressure([
      {
        id: "bp-prior",
        day: priorDay,
        ts: midTs + 12 * 3600,
        systolicMmhg: 110,
        diastolicMmhg: 70,
        quality: "manual",
        importedAt: 1,
      },
    ]);

    const summary = await getBloodPressureSummary(DAY, ctx);
    expect(summary.latest.value).toBeNull();
    expect(summary.latest.reason).toBe("no_data");
    expect(summary.latestPrior).not.toBeNull();
    expect(summary.latestPrior?.id).toBe("bp-prior");
    expect(summary.baseline).toEqual({
      avgSystolic: 110,
      avgDiastolic: 70,
      count: 1,
    });
    expect(summary.distribution.normal).toBe(1);
  });
});
