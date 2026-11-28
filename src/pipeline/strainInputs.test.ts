// Strain's inputs from history (version 15): the max HR learned from workout heart rate, and Day Strain's waking floor.
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import type { Exercise, HrSample, Profile } from "@/data/types";
import { addDays, localMidnight } from "@/lib/time";
import { LEARNED_MAX_HR_CHECKED_KEY, LEARNED_MAX_HR_KEY, learnedMaxHr, pipelineOptions, resolveMaxHr, runPipeline } from "./index";
import { wakingFloorFrom } from "./stage1";

const TZ = "UTC";
const TODAY = "2026-10-07";
/** 40 on TODAY: Tanaka's 208 − 0.7 × 40 = 180. */
const PROFILE: Profile = { birthDate: "1986-06-01", sex: "male", maxHr: null, heightCm: 180, timeZone: TZ };

/** A 20-minute workout on `day` at 1 Hz: 1,190 readings climbing to 10 under `peak`, then ten at `peak` (the top 0.8 %). */
async function workout(store: MemoryStore, day: string, peak: number, id = `w-${day}`) {
  const start = localMidnight(day, TZ) + 18 * 3600;
  const hr: HrSample[] = Array.from({ length: 1200 }, (_, i) => ({ ts: start + i, bpm: i < 1190 ? peak - 50 + Math.floor((i * 40) / 1190) : peak }));
  await store.putHr(hr);
  const e: Exercise = { id, day, startTs: start, endTs: start + 1199, type: "RUNNING", name: null, calories: null, distanceM: null };
  await store.upsertExercises([e]);
}

describe("learned max HR", () => {
  it("is the 99.5th percentile of workout heart rate when it beats Tanaka's 180", async () => {
    const store = new MemoryStore();
    await workout(store, TODAY, 196);
    expect(await learnedMaxHr(store, PROFILE, TODAY)).toBe(196);
    expect(resolveMaxHr(PROFILE, TODAY, 196)).toBe(196);
    expect((await pipelineOptions(store, PROFILE, TODAY)).profile.maxHr).toBe(196);
  });

  it("ignores heart rate outside workouts: a spike while not exercising never moves it", async () => {
    const store = new MemoryStore();
    await workout(store, TODAY, 186);
    const night = localMidnight(TODAY, TZ) + 3 * 3600;
    await store.putHr(Array.from({ length: 900 }, (_, i) => ({ ts: night + i, bpm: 215 })));
    expect(await learnedMaxHr(store, PROFILE, TODAY)).toBe(186);
  });

  it("stays at Tanaka's while workouts never reach it", async () => {
    const store = new MemoryStore();
    await workout(store, TODAY, 175);
    const learned = await learnedMaxHr(store, PROFILE, TODAY);
    expect(resolveMaxHr(PROFILE, TODAY, learned)).toBe(180);
  });

  it("checks weekly, rises only by 2 bpm or more, and never falls", async () => {
    const store = new MemoryStore();
    await workout(store, TODAY, 196);
    expect(await learnedMaxHr(store, PROFILE, TODAY)).toBe(196);
    // A harder workout two days later (the first one since deleted in Fitbit) isn't read until a week has passed.
    await store.deleteExercises([`w-${TODAY}`]);
    await workout(store, addDays(TODAY, 2), 199, "w2");
    expect(await learnedMaxHr(store, PROFILE, addDays(TODAY, 2))).toBe(196);
    expect(await learnedMaxHr(store, PROFILE, addDays(TODAY, 7))).toBe(199);
    // One bpm more is too small a change to rescore the history for.
    await workout(store, addDays(TODAY, 8), 200, "w3");
    await store.deleteExercises(["w2"]);
    expect(await learnedMaxHr(store, PROFILE, addDays(TODAY, 14))).toBe(199);
    // A year on, with no hard workout left in the window, it keeps the highest it learned.
    expect(await learnedMaxHr(store, PROFILE, addDays(TODAY, 400))).toBe(199);
    const latest = await store.dailyValues({ from: "latest", to: "latest" });
    expect(latest.find((v) => v.key === LEARNED_MAX_HR_KEY)?.value).toBe(199);
    expect(latest.find((v) => v.key === LEARNED_MAX_HR_CHECKED_KEY)).toBeDefined();
  });

  it("is not used, nor stored, with the profile's own max HR", async () => {
    const store = new MemoryStore();
    await workout(store, TODAY, 196);
    const own = { ...PROFILE, maxHr: 185 };
    expect(await learnedMaxHr(store, own, TODAY)).toBeNull();
    expect((await pipelineOptions(store, own, TODAY)).profile.maxHr).toBe(185);
    expect(await store.dailyValues({ from: "latest", to: "latest" })).toEqual([]);
  });

  it("needs 600 workout readings", async () => {
    const store = new MemoryStore();
    const start = localMidnight(TODAY, TZ) + 18 * 3600;
    await store.putHr(Array.from({ length: 500 }, (_, i) => ({ ts: start + i, bpm: 198 })));
    await store.upsertExercises([{ id: "short", day: TODAY, startTs: start, endTs: start + 499, type: "RUNNING", name: null, calories: null, distanceM: null }]);
    expect(await learnedMaxHr(store, PROFILE, TODAY)).toBeNull();
  });
});

describe("a very long workout (issue #70)", () => {
  // 300,000 readings in one session (a workout left running for days at 1 Hz). Spreading them into one call's arguments
  // (push(...xs), Math.max(...xs)) overflowed the stack, "Maximum call stack size exceeded", and the history never scored.
  const N = 300_000;
  async function longWorkout(store: MemoryStore) {
    const day = addDays(TODAY, -4);
    const start = localMidnight(day, TZ) + 18 * 3600;
    await store.putHr(Array.from({ length: N }, (_, i) => ({ ts: start + i, bpm: 120 + (i % 77) })));
    await store.upsertExercises([{ id: "long", day, startTs: start, endTs: start + N - 1, type: "RUNNING", name: null, calories: null, distanceM: null }]);
  }

  it("learns max HR from it", async () => {
    const store = new MemoryStore();
    await longWorkout(store);
    expect(await learnedMaxHr(store, PROFILE, TODAY)).toBe(196);
  });

  it("scores the days it spans", async () => {
    const store = new MemoryStore();
    await longWorkout(store);
    await expect(runPipeline(store, PROFILE, { today: TODAY })).resolves.toBeDefined();
  });
});

describe("Day Strain's waking floor", () => {
  it("is the median of the days before, at 3 dp, missing days skipped", () => {
    expect(wakingFloorFrom([0.12, null, 0.15, undefined, 0.13])).toBe(0.13);
    expect(wakingFloorFrom([0.12, 0.13])).toBe(0.125);
    expect(wakingFloorFrom([0.12345])).toBe(0.123);
  });

  it("is capped at 40 % of the reserve, and null without any day", () => {
    expect(wakingFloorFrom([0.5, 0.6, 0.45])).toBe(0.4);
    expect(wakingFloorFrom([])).toBeNull();
    expect(wakingFloorFrom([null, undefined])).toBeNull();
  });
});
