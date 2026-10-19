import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import type { BloodPressureReading } from "@/data/types";
import { getBloodPressureSummary } from "./bloodPressure";
import type { QueryCtx } from "./common";

const TZ = "UTC";

async function makeCtx(store: MemoryStore, today = "2026-05-15"): Promise<QueryCtx> {
  return {
    store,
    timeZone: TZ,
    profile: { birthDate: "1990-01-01", sex: "male", maxHr: 185, heightCm: 175, timeZone: TZ },
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

describe("getBloodPressureSummary", () => {
  it("returns no_data when no readings exist", async () => {
    const store = new MemoryStore();
    const ctx = await makeCtx(store);
    const summary = await getBloodPressureSummary("2026-05-15", ctx);

    expect(summary.day).toBe("2026-05-15");
    expect(summary.isToday).toBe(true);
    expect(summary.latest.value).toBeNull();
    expect(summary.latest.reason).toBe("no_data");
    expect(summary.latestPrior).toBeNull();
    expect(summary.baseline).toBeNull();
    expect(summary.readings).toEqual([]);
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

  it("extracts readings on day, selects latest, and computes 30-day baseline and distribution", async () => {
    const store = new MemoryStore();
    const readings: BloodPressureReading[] = [
      // Day 1 (prior reading within 30-day window)
      makeReading("r-1", "2026-05-01", "09:00:00", 116, 76),
      // Day 2 (prior reading within 30-day window) - stage 1
      makeReading("r-2", "2026-05-05", "10:00:00", 132, 84),
      // Day 3 (prior reading within 30-day window) - elevated
      makeReading("r-3", "2026-05-10", "08:00:00", 124, 78),
      // Target day: 2 readings
      makeReading("r-4", "2026-05-15", "07:30:00", 118, 77),
      makeReading("r-5", "2026-05-15", "18:30:00", 122, 79), // later -> selected
    ];

    await store.insertBloodPressure(readings);
    const ctx = await makeCtx(store, "2026-05-15");
    const summary = await getBloodPressureSummary("2026-05-15", ctx);

    // Latest reading on day
    expect(summary.latest.value).toMatchObject({
      id: "r-5",
      systolic: 122,
      diastolic: 79,
      category: "elevated",
      time: "18:30",
      bodyPosition: "sitting",
      measurementLocation: "left_upper_arm",
    });

    // All readings on target day (newest first)
    expect(summary.readings).toHaveLength(2);
    expect(summary.readings[0].id).toBe("r-5");
    expect(summary.readings[1].id).toBe("r-4");

    // 30-day baseline over prior days (strictly causal: excludes target day)
    // 3 prior readings: 116/76, 132/84, 124/78 -> avgSys: 372 / 3 = 124, avgDia: 238 / 3 = 79
    expect(summary.baseline).toEqual({
      avgSystolic: 124,
      avgDiastolic: 79,
      count: 3,
    });

    // Distribution:
    // r-1: 116/76 (normal)
    // r-2: 132/84 (stage1)
    // r-3: 124/78 (elevated)
    // r-4: 118/77 (normal)
    // r-5: 122/79 (elevated)
    expect(summary.distribution).toEqual({
      normal: 2,
      elevated: 2,
      stage1: 1,
      stage2: 0,
      crisis: 0,
    });

    // History contains points for the days with readings
    const ptMay1 = summary.history.find((p) => p.day === "2026-05-01");
    expect(ptMay1).toBeDefined();
    expect(ptMay1?.systolic).toBe(116);
    expect(ptMay1?.diastolic).toBe(76);
    expect(ptMay1?.category).toBe("normal");

    const ptMay15 = summary.history.find((p) => p.day === "2026-05-15");
    expect(ptMay15?.systolic).toBe(122);
    expect(ptMay15?.diastolic).toBe(79);
  });

  it("provides latestPrior when target day has no readings", async () => {
    const store = new MemoryStore();
    const readings: BloodPressureReading[] = [
      makeReading("r-1", "2026-05-10", "09:00:00", 118, 78),
    ];
    await store.insertBloodPressure(readings);

    const ctx = await makeCtx(store, "2026-05-15");
    const summary = await getBloodPressureSummary("2026-05-15", ctx);

    expect(summary.latest.value).toBeNull();
    expect(summary.latest.reason).toBe("no_data");
    expect(summary.latestPrior).toMatchObject({
      id: "r-1",
      day: "2026-05-10",
      systolic: 118,
      diastolic: 78,
      category: "normal",
      time: "09:00",
    });
  });
});
