import { describe, expect, it } from "vitest";
import { trimp } from "@/core/engine/strain";
import { parseRecordedWorkout, parseWorkoutSample, summarizeWorkout, type RecordedWorkout, type WorkoutSample } from "./workout";

export const fixtureWorkout = (patch: Partial<RecordedWorkout> = {}): RecordedWorkout => ({
  schemaVersion: 1, id: "session-1", type: "walk", status: "completed", startedAt: 1_000_000,
  endedAt: 1_060_000, updatedAt: 1_060_000, activeMs: 60_000, revision: 1, seq: 61, epoch: 1,
  deviceId: "AA:BB:CC:DD:EE:FF", deviceName: "Test sensor", timeZone: "UTC",
  restingHr: 55, maxHr: 190, sex: "male", estimatedMaxHr: false, algorithmVersion: 1,
  link: "off", lastBpm: null, lastSampleAt: 1_060_000, error: null, ...patch,
});
const point = (seq: number, elapsedMs: number, bpm = 140, epoch = 1): WorkoutSample => ({ seq, elapsedMs, bpm, epoch, t: 1_000_000 + elapsedMs, rrMs: [] });

describe("personal workout metrics", () => {
  it("replays the existing TRIMP kernel and weights averages by observed time", () => {
    const samples = Array.from({ length: 61 }, (_, i) => point(i + 1, i * 1000));
    const result = summarizeWorkout(fixtureWorkout(), samples);
    expect(result.load.value).toBeCloseTo(trimp([{ bpm: 140, seconds: 60 }], 55, 190, "male")!, 10);
    expect(result.observedMs).toBe(60_000);
    expect(result.avgHr).toBe(140);
    expect(result.zoneSeconds.reduce((a, b) => a + b, 0)).toBe(60);
    expect(result.load.provisional).toBe(false);
  });
  it("does not reward disconnects, pauses, unobserved tails or a single reading", () => {
    const session = fixtureWorkout({ activeMs: 120_000 });
    const samples = [point(1, 0), point(2, 1000), point(3, 50_000), point(4, 51_000), point(5, 52_000, 140, 2), point(6, 53_000, 140, 2)];
    const result = summarizeWorkout(session, samples);
    expect(result.observedMs).toBe(3000);
    expect(result.trace.filter((p) => p.bpm === null)).toHaveLength(2);
    expect(result.load.provisional).toBe(true);
    expect(summarizeWorkout(session, [point(1, 0)]).load.value).toBeNull();
    expect(summarizeWorkout(session, []).avgHr).toBeNull();
  });
  it("rejects out-of-order/duplicate samples and impossible jumps", () => {
    const result = summarizeWorkout(fixtureWorkout(), [point(1, 0), point(2, 1000), point(2, 1000), point(1, 500), point(3, 2000, 230), point(4, 3000), point(5, 4000)]);
    expect(result.observedMs).toBe(2000);
    expect(result.maxHr).toBe(140);
  });
  it("keeps load missing for absent or invalid calibration", () => {
    const samples = [point(1, 0), point(2, 1000)];
    for (const patch of [{ restingHr: null }, { sex: null }, { maxHr: null }, { maxHr: 55 }, { restingHr: 0 }]) {
      expect(summarizeWorkout(fixtureWorkout(patch), samples).load).toMatchObject({ value: null, reason: "no_data" });
    }
    expect(summarizeWorkout(fixtureWorkout({ estimatedMaxHr: true }), samples).load.provisional).toBe(true);
  });
  it("uses monotonic session time when the phone wall clock changes", () => {
    const samples = [point(1, 0), { ...point(2, 1000), t: 1 }, { ...point(3, 2000), t: 9_000_000 }];
    const result = summarizeWorkout(fixtureWorkout(), samples);
    expect(result.observedMs).toBe(2000);
    expect(result.trace.map((p) => p.t)).toEqual([1_000_000, 1_001_000, 1_002_000]);
  });
  it("validates corrupt native records without replacing them with empty history", () => {
    expect(() => parseRecordedWorkout({ ...fixtureWorkout(), id: "../outside" })).toThrow();
    expect(() => parseRecordedWorkout({ ...fixtureWorkout(), activeMs: -1 })).toThrow();
    expect(() => parseWorkoutSample({ ...point(1, 0), bpm: NaN })).toThrow();
  });
});
