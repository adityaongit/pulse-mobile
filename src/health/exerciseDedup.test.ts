import { describe, expect, it } from "vitest";
import { finish } from "@/lib/yield";
import { uniqueExercises } from "./exerciseDedup";

const record = (id: string, source = "com.fitbit", start = 0, end = 1800, type = 8, title?: string) => ({
  metadata: { id, dataOrigin: source },
  startTime: new Date(start * 1000).toISOString(),
  endTime: new Date(end * 1000).toISOString(),
  exerciseType: type,
  title,
});
const ids = (records: ReturnType<typeof record>[]) => finish(uniqueExercises(records)).map((r) => r.metadata.id);

describe("cross-source exercise duplicates", () => {
  it("keeps one near-identical session, preferring a supplied title regardless of read order", () => {
    const a = record("a");
    const b = record("b", "com.samsung", 15, 1810, 8, "Morning ride");
    expect(ids([a, b])).toEqual(["b"]);
    expect(ids([b, a])).toEqual(["b"]);
  });

  it("preserves sessions from one source, unknown sources, different sports and partial overlaps", () => {
    for (const b of [record("b"), record("b", ""), record("b", "com.samsung", 0, 1800, 56), record("b", "com.samsung", 900, 2700)]) {
      expect(ids([record("a"), b])).toHaveLength(2);
    }
  });

  it("does not collapse a short workout inside a longer one or adjacent sessions", () => {
    expect(ids([record("a"), record("b", "com.samsung", 60, 300)])).toHaveLength(2);
    expect(ids([record("a"), record("b", "com.samsung", 1800, 3600)])).toHaveLength(2);
  });

  it("collapses a copy up to five minutes apart from another app or another device of the same app", () => {
    const watch = { ...record("watch", "com.fitbit", 240, 2040), metadata: { id: "watch", dataOrigin: "com.fitbit", device: { manufacturer: "Fitbit", model: "Air", type: 1 } } };
    expect(ids([record("phone"), watch])).toEqual(["phone"]);
    // One app trims the first and last four minutes of an hour-long ride the other app records in full.
    expect(ids([record("ride", "com.fitbit", 0, 3600), record("copy", "com.strava", 240, 3600)])).toHaveLength(1);
    // Just beyond the tolerance, and two sessions on the same app and device, stay separate.
    expect(ids([record("a"), record("b", "com.samsung", 301, 2101)])).toHaveLength(2);
    expect(ids([record("a"), record("b", "com.fitbit", 240, 2040)])).toHaveLength(2);
  });

  it("merges equivalent sport codes and a generic other workout", () => {
    expect(ids([record("run", "com.fitbit", 0, 1800, 56), record("treadmill", "com.samsung", 60, 1800, 57)])).toHaveLength(1);
    expect(ids([record("bike", "com.fitbit", 0, 1800, 8), record("stationary", "com.samsung", 0, 1800, 9)])).toHaveLength(1);
    expect(ids([record("generic", "com.fitbit", 0, 1800, 0), record("run2", "com.samsung", 0, 1800, 56)])).toHaveLength(1);
    // A different sport is still a different session even at the same window.
    expect(ids([record("run3", "com.fitbit", 0, 1800, 56), record("bike2", "com.samsung", 0, 1800, 8)])).toHaveLength(2);
  });

  it("merges a strength session whatever the two apps call it, but not two unknown sports", () => {
    // Health app says weightlifting (81), Hevy says strength training (70), or names a lift. All one session.
    expect(ids([record("health", "com.google.android.apps.fitness", 0, 2700, 81), record("hevy", "com.hevy", 60, 2700, 70)])).toHaveLength(1);
    expect(ids([record("health2", "com.google.android.apps.fitness", 0, 2700, 70), record("bench", "com.hevy", 60, 2700, 6)])).toHaveLength(1);
    // Two codes the map does not know must stay separate: `undefined === undefined` is not a match.
    expect(ids([record("breath", "com.google.android.apps.fitness", 0, 2700, 33), record("surf", "com.hevy", 60, 2700, 72)])).toHaveLength(2);
  });
});
