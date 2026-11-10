// readAll over a mocked Health Connect: paging, and a malformed record left out without failing the read. The one write
// (a recorded workout's session) and its delete, gated on the write permission.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteRecordsByUuids, getGrantedPermissions, insertRecords, readRecords, requestPermission } from "react-native-health-connect";
import { deleteExercise, readAll, saveExercise, skippedTypes, skippedWarning } from "./connect";

vi.mock("react-native", () => ({ Platform: { OS: "android" }, PermissionsAndroid: { check: vi.fn() } }));
vi.mock("react-native-health-connect", () => ({ initialize: vi.fn(async () => true), readRecords: vi.fn(), getGrantedPermissions: vi.fn(async () => []), requestPermission: vi.fn(async () => []), insertRecords: vi.fn(async () => ["hc-1"]), deleteRecordsByUuids: vi.fn(async () => {}) }));

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

describe("the workout write", () => {
  const write = [{ accessType: "write", recordType: "ExerciseSession" }];
  const workout = { clientRecordId: "w-1", start: T0, end: T0 + 30 * MIN, exerciseType: 79, title: "Walking" };
  beforeEach(() => {
    vi.mocked(getGrantedPermissions).mockReset().mockResolvedValue([] as never);
    vi.mocked(insertRecords).mockClear();
    vi.mocked(deleteRecordsByUuids).mockClear();
    vi.mocked(requestPermission).mockClear();
  });

  it("saves nothing without the write permission, and never asks for it on the way", async () => {
    expect(await saveExercise(workout)).toBeNull();
    expect(insertRecords).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("writes the session with the workout's id as its client id, so a retry replaces it", async () => {
    vi.mocked(getGrantedPermissions).mockResolvedValue(write as never);
    expect(await saveExercise(workout)).toBe("hc-1");
    expect(vi.mocked(insertRecords).mock.calls[0][0]).toEqual([expect.objectContaining({
      recordType: "ExerciseSession", exerciseType: 79, title: "Walking", startTime: new Date(T0).toISOString(), endTime: new Date(T0 + 30 * MIN).toISOString(),
      metadata: { clientRecordId: "w-1", clientRecordVersion: 1 },
    })]);
  });

  it("deletes only with the permission (asking for it), and otherwise throws so the caller keeps its copy", async () => {
    await expect(deleteExercise("hc-1")).rejects.toThrow("healthPermission");
    expect(requestPermission).toHaveBeenCalled();
    expect(deleteRecordsByUuids).not.toHaveBeenCalled();
    vi.mocked(getGrantedPermissions).mockResolvedValue(write as never);
    await deleteExercise("hc-1");
    expect(deleteRecordsByUuids).toHaveBeenCalledWith("ExerciseSession", ["hc-1"], []);
  });
});
