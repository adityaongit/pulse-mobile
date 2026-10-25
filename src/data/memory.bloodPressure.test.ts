import { describe, expect, it } from "vitest";
import { openMemoryStore } from "./memory";
import { seedDemo } from "./seed";

describe("bloodPressureReadings store", () => {
  it("upserts, filters by upToDate, preserves manual rows on clearRange, and deletes by id", async () => {
    const store = openMemoryStore();
    await store.upsertBloodPressureReadings([
      {
        id: "hc-bp-1",
        timestampMs: 1_710_403_200_000,
        date: "2026-03-14",
        systolicMmHg: 120,
        diastolicMmHg: 78,
        pulseBpm: 60,
        posture: "sitting",
        source: "health_connect",
      },
      {
        id: "manual-bp-1",
        timestampMs: 1_710_489_600_000,
        date: "2026-03-15",
        systolicMmHg: 118,
        diastolicMmHg: 76,
        pulseBpm: 58,
        posture: "sitting",
        source: "manual",
      },
    ]);

    expect((await store.getBloodPressureReadings()).map((r) => r.id)).toEqual(["hc-bp-1", "manual-bp-1"]);
    expect((await store.getBloodPressureReadings("2026-03-14")).map((r) => r.id)).toEqual(["hc-bp-1"]);

    await store.clearImported({ from: "2026-03-14", to: "2026-03-15" }, 0, 2_000_000_000);
    expect((await store.getBloodPressureReadings()).map((r) => r.id)).toEqual(["manual-bp-1"]);

    await store.deleteBloodPressureReading("manual-bp-1");
    expect(await store.getBloodPressureReadings()).toEqual([]);
  });

  it("seeds deterministic cuff calibration rows in seedDemo", async () => {
    const store = openMemoryStore();
    await seedDemo(store, { today: "2026-03-14", days: 90, now: 1_780_000_000, timeZone: "UTC" });
    const rows = await store.getBloodPressureReadings();
    expect(rows.length).toBe(3);
    expect(rows.map((r) => [r.systolicMmHg, r.diastolicMmHg])).toEqual([
      [119, 77],
      [121, 78],
      [118, 76],
    ]);
  });
});
