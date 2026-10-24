// readAll over a mocked Health Connect: paging, and a malformed record left out without failing the read.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRecords } from "react-native-health-connect";
import { readAll, skippedTypes, skippedWarning } from "./connect";

vi.mock("react-native", () => ({ Platform: { OS: "android" }, PermissionsAndroid: { check: vi.fn() } }));
vi.mock("react-native-health-connect", () => ({ initialize: vi.fn(async () => true), readRecords: vi.fn() }));

type Opts = { timeRangeFilter: { startTime: string; endTime: string }; pageToken?: string };
const T0 = Date.parse("2026-10-01T00:00:00Z");
const MIN = 60_000;
/** One record a minute for a day; the one at minute 500 is malformed, as Hevy's zero-length segment was. */
const records = Array.from({ length: 1440 }, (_, i) => ({ startTime: new Date(T0 + i * MIN).toISOString(), bad: i === 500 }));

/** Health Connect: records starting in the filter, two pages at most, and the client's IllegalArgumentException on a bad one. */
function healthConnect(opts: Opts) {
  const [from, to] = [Date.parse(opts.timeRangeFilter.startTime), Date.parse(opts.timeRangeFilter.endTime)];
  const hit = records.filter((r) => Date.parse(r.startTime) >= from && Date.parse(r.startTime) < to);
  if (hit.some((r) => r.bad)) return Promise.reject(Object.assign(new Error("startTime must be before endTime."), { code: "ARGUMENT_VALIDATION_ERROR" }));
  const half = Math.ceil(hit.length / 2);
  return Promise.resolve(opts.pageToken ? { records: hit.slice(half) } : { records: hit.slice(0, half), pageToken: half < hit.length ? "next" : undefined });
}

const read = vi.mocked(readRecords);
const day = { start: new Date(T0), end: new Date(T0 + 1440 * MIN) };

beforeEach(() => {
  read.mockReset();
  read.mockImplementation(((_: string, o: Opts) => healthConnect(o)) as never);
});

describe("readAll", () => {
  it("leaves out only the malformed record, in order, without duplicates, and reports its range", async () => {
    const skipped: { start: Date; end: Date }[] = [];
    const out = (await readAll("ExerciseSession", day, { onSkipped: (r) => skipped.push(r) })) as unknown as typeof records;
    expect(out.map((r) => r.startTime)).toEqual(records.filter((r) => !r.bad).map((r) => r.startTime));
    expect(skipped).toHaveLength(1);
    expect(skipped[0].end.getTime() - skipped[0].start.getTime()).toBe(1);
    expect(skipped[0].start.toISOString()).toBe(records[500].startTime);
  });

  it("passes any other failure straight through", async () => {
    read.mockRejectedValue(Object.assign(new Error("no access"), { code: "PERMISSION_ERROR" }));
    await expect(readAll("ExerciseSession", day)).rejects.toThrow("no access");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("names the skipped types from the sync's warnings", () => {
    expect(skippedTypes(["permission_missing:Steps", skippedWarning("ExerciseSession"), skippedWarning("SleepSession")])).toEqual(["SleepSession", "ExerciseSession"]);
  });
});
