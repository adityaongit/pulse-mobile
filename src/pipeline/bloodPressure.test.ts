import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { emptyMetrics, type Profile } from "@/data/types";
import { runPipeline } from "@/pipeline";

const TZ = "UTC";
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 185, heightCm: 175, timeZone: TZ };

describe("Pipeline blood pressure scoring", () => {
  it("scores blood pressure from daily readings into health_monitor", async () => {
    const store = new MemoryStore();
    const day = "2026-05-10";

    // Insert blood pressure reading
    await store.insertBloodPressure([
      {
        id: "bp-1",
        ts: Date.parse(`${day}T08:30:00Z`) / 1000,
        day,
        systolicMmhg: 118,
        diastolicMmhg: 76,
        bodyPosition: "sitting",
        measurementLocation: "left_upper_arm",
        quality: "direct",
        importedAt: Date.now() / 1000,
      },
    ]);

    await runPipeline(store, PROFILE, { today: day });

    const scores = await store.scoresIn({ from: day, to: day });
    expect(scores).toHaveLength(1);
    const hm = scores[0].health_monitor;
    expect(hm).not.toBeNull();
    expect(hm?.bloodPressure).toEqual({
      systolic: 118,
      diastolic: 76,
      category: "normal",
      readingId: "bp-1",
      ts: Date.parse(`${day}T08:30:00Z`) / 1000,
    });
  });

  it("selects the latest reading when multiple readings exist on the same day", async () => {
    const store = new MemoryStore();
    const day = "2026-05-11";

    // Insert two readings at different times
    await store.insertBloodPressure([
      {
        id: "bp-morning",
        ts: Date.parse(`${day}T07:30:00Z`) / 1000,
        day,
        systolicMmhg: 115,
        diastolicMmhg: 75,
        quality: "direct",
        importedAt: Date.now() / 1000,
      },
      {
        id: "bp-evening",
        ts: Date.parse(`${day}T19:45:00Z`) / 1000,
        day,
        systolicMmhg: 135,
        diastolicMmhg: 85,
        quality: "direct",
        importedAt: Date.now() / 1000,
      },
    ]);

    await runPipeline(store, PROFILE, { today: day });

    const scores = await store.scoresIn({ from: day, to: day });
    const hm = scores[0].health_monitor;
    expect(hm?.bloodPressure).toEqual({
      systolic: 135,
      diastolic: 85,
      category: "stage1",
      readingId: "bp-evening",
      ts: Date.parse(`${day}T19:45:00Z`) / 1000,
    });
  });

  it("stores null bloodPressure when no readings exist on that day", async () => {
    const store = new MemoryStore();
    const day = "2026-05-12";

    // Insert sleep session so the day is scored by pipeline
    await store.upsertSessions(
      [
        {
          id: "s-1",
          day,
          startTs: Date.parse(`${day}T00:00:00Z`) / 1000,
          endTs: Date.parse(`${day}T07:00:00Z`) / 1000,
          isMain: true,
          processed: true,
          stagesStatus: null,
          asleepMin: 400,
          awakeMin: 20,
          deepMin: 80,
          lightMin: 240,
          remMin: 80,
        },
      ],
      [],
    );

    await runPipeline(store, PROFILE, { today: day });

    const scores = await store.scoresIn({ from: day, to: day });
    expect(scores).toHaveLength(1);
    const hm = scores[0].health_monitor;
    expect(hm).not.toBeNull();
    expect(hm?.bloodPressure).toBeNull();
  });

  it("leaves Pulse Age identical when FEATURES.bpPulseAge is false", async () => {
    const store = new MemoryStore();
    const days = ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08", "2026-05-09", "2026-05-10"];
    for (const d of days) {
      await store.upsertMetrics([
        {
          ...emptyMetrics(d),
          rhrBpm: 58,
          steps: 9000,
          vo2maxDaily: 45,
          hrvMs: 50,
          hrvDeepMs: 55,
          respBpm: 14,
          weightKg: 75,
          bodyFatPct: 16,
        },
      ]);
      await store.upsertSessions(
        [
          {
            id: `s-${d}`,
            day: d,
            startTs: Date.parse(`${d}T00:00:00Z`) / 1000,
            endTs: Date.parse(`${d}T07:30:00Z`) / 1000,
            isMain: true,
            processed: true,
            stagesStatus: null,
            asleepMin: 430,
            awakeMin: 20,
            deepMin: 80,
            lightMin: 260,
            remMin: 90,
          },
        ],
        [],
      );
    }

    await runPipeline(store, PROFILE, { today: "2026-05-10" });
    const withoutBp = (await store.scoresIn({ from: "2026-05-10", to: "2026-05-10" }))[0].healthspan;

    await store.insertBloodPressure(
      Array.from({ length: 12 }, (_, i) => {
        const d = days[i % 4];
        return {
          id: `bp-pa-${i}`,
          ts: Date.parse(`${d}T08:00:00Z`) / 1000 + i * 60,
          day: d,
          systolicMmhg: 145,
          diastolicMmhg: 92,
          bodyPosition: "sitting",
          measurementLocation: "left_upper_arm",
          quality: "direct" as const,
          importedAt: 1700000000,
        };
      }),
    );

    await runPipeline(store, PROFILE, { today: "2026-05-10" });
    const withBp = (await store.scoresIn({ from: "2026-05-10", to: "2026-05-10" }))[0].healthspan;
    expect(withBp).toEqual(withoutBp);
  });
});
