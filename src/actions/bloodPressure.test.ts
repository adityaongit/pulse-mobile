import { describe, expect, it } from "vitest";
import { openMemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import { deleteBloodPressureCalibration, logBloodPressureCalibration } from "./bloodPressure";

describe("bloodPressure actions", () => {
  it("logs a valid manual cuff calibration, runs the pipeline, and deletes it cleanly", async () => {
    const store = openMemoryStore();
    const profile = await seedDemo(store, { today: "2026-03-14", days: 35, now: 1_780_000_000, timeZone: "UTC" });
    let changedCount = 0;
    const deps = { store, profile, onChanged: () => changedCount++ };

    const row = await logBloodPressureCalibration(
      {
        systolicMmHg: 122,
        diastolicMmHg: 78,
        pulseBpm: 60,
        posture: "sitting",
        timestampMs: Date.parse("2026-03-14T08:30:00Z"),
      },
      deps,
    );

    expect(row).toMatchObject({
      date: "2026-03-14",
      systolicMmHg: 122,
      diastolicMmHg: 78,
      pulseBpm: 60,
      posture: "sitting",
      source: "manual",
    });
    expect(changedCount).toBe(1);

    const stored = await store.getBloodPressureReadings();
    expect(stored.some((r) => r.id === row.id)).toBe(true);

    await deleteBloodPressureCalibration(row.id, deps);
    expect(changedCount).toBe(2);
    expect((await store.getBloodPressureReadings()).some((r) => r.id === row.id)).toBe(false);
  });

  it("rejects out-of-range or inverted pressures via Zod validation", async () => {
    const store = openMemoryStore();
    const profile = await seedDemo(store, { today: "2026-03-14", days: 10, now: 1_780_000_000, timeZone: "UTC" });
    const deps = { store, profile };

    await expect(
      logBloodPressureCalibration({ systolicMmHg: 50, diastolicMmHg: 40 }, deps),
    ).rejects.toThrow();

    await expect(
      logBloodPressureCalibration({ systolicMmHg: 110, diastolicMmHg: 115 }, deps),
    ).rejects.toThrow("Systolic pressure must exceed diastolic pressure.");
  });
});
