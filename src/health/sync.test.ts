// The sync without a device: Health Connect's reads are mocked over fixed records, the Store is in memory. Checks the
// importer-version re-import (it replaces what an old import wrote) and the single source behaviour (every app kept).
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => void storage.set(k, v),
    multiSet: async (kv: [string, string][]) => kv.forEach(([k, v]) => storage.set(k, v)),
    multiRemove: async (ks: string[]) => ks.forEach((k) => storage.delete(k)),
  },
}));
// connect.ts asks Android for the history permission; vitest can't load react-native itself.
vi.mock("react-native", () => ({ Platform: { OS: "android" }, PermissionsAndroid: { check: vi.fn(async () => false) } }));
vi.mock("react-native-health-connect", () => ({
  getChanges: vi.fn(async () => ({ nextChangesToken: "tok", upsertionChanges: [], deletionChanges: [], hasMore: false, changesTokenExpired: false })),
}));
vi.mock("@/health/connect", async (actual) => ({
  ...(await actual<typeof import("@/health/connect")>()),
  ensureInitialized: vi.fn(async () => true),
  permissionState: vi.fn(),
  readAll: vi.fn(),
}));

const { MemoryStore } = await import("@/data/memory");
const { emptyMetrics } = await import("@/data/types");
const { permissionState, readAll } = await import("@/health/connect");
const { IMPORT_VERSION, dayOfStoredRecords, fullReason, syncHealthConnect, windowPlan } = await import("./sync");
const { IMPORT_STATE_KEY } = await import("./importState");

const TZ = "UTC";
const NOW = new Date("2026-10-07T12:00:00Z");
const FITBIT = "com.fitbit.FitbitMobile";
const sec = (iso: string) => Date.parse(iso) / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();
const meta = (id: string, dataOrigin: string, type?: number) => ({ id, dataOrigin, ...(type != null && { device: { type } }) });

/** Fixed Health Connect contents. */
function fixture() {
  const steps: object[] = [];
  const calories: object[] = [];
  const sleep: object[] = [];
  for (const day of ["2026-10-03", "2026-10-04", "2026-10-06", "2026-10-07"]) {
    // The band: a 5-minute walk of 120 steps a minute. The phone (Fitbit app, phone device): the same walk as one hour.
    for (let i = 0; i < 5; i++) {
      steps.push({ metadata: meta(`b-${day}-${i}`, FITBIT, 6), startTime: `${day}T10:0${i}:00Z`, endTime: `${day}T10:0${i + 1}:00Z`, count: 120 });
    }
    steps.push({ metadata: meta(`p-${day}`, FITBIT, 2), startTime: `${day}T10:00:00Z`, endTime: `${day}T11:00:00Z`, count: 590 });
    calories.push({ metadata: meta(`c-${day}`, FITBIT), startTime: `${day}T00:00:00Z`, endTime: `${day}T10:00:00Z`, energy: { inKilocalories: 1000 } });
    sleep.push({ metadata: meta(`s-${day}`, FITBIT, 6), startTime: iso(sec(`${day}T00:00:00Z`) - 3600), endTime: `${day}T06:00:00Z`, stages: [] });
  }
  // 2026-10-05: only another app wrote anything.
  steps.push({ metadata: meta("other-05", "com.oneplus.health", 2), startTime: "2026-10-05T09:00:00Z", endTime: "2026-10-05T10:00:00Z", count: 3000 });
  calories.push({ metadata: meta("other-cal-05", "com.oneplus.health"), startTime: "2026-10-05T00:00:00Z", endTime: "2026-10-05T10:00:00Z", energy: { inKilocalories: 900 } });
  return { Steps: steps, TotalCaloriesBurned: calories, SleepSession: sleep } as Record<string, { metadata: { dataOrigin: string }; startTime: string; endTime: string }[]>;
}

const hc = { readAll: vi.mocked(readAll), permissionState: vi.mocked(permissionState) };
const NO_CHANGES = { nextChangesToken: "tok", upsertionChanges: [], deletionChanges: [], hasMore: false, changesTokenExpired: false };
/** A write since the last sync, on `day`: the window is read again (no deletion, which would re-import it all). */
const WRITTEN = (day: string) => ({ nextChangesToken: "tok2", upsertionChanges: [{ record: { startTime: `${day}T00:00:00Z` } }], deletionChanges: [], hasMore: false, changesTokenExpired: false });

beforeEach(async () => {
  storage.clear();
  vi.clearAllMocks();
  vi.mocked((await import("react-native-health-connect")).getChanges).mockResolvedValue(NO_CHANGES as never);
  const data = fixture();
  hc.permissionState.mockResolvedValue({ granted: ["Steps", "TotalCaloriesBurned", "SleepSession", "HeartRate"], missing: [], history: true, background: true });
  hc.readAll.mockImplementation(startTimeRead(data));
});

/**
 * Health Connect's read (AOSP RecordHelper.getReadTableWhereClause): the records whose START (an instant record's time)
 * falls in [start, end), not every record overlapping the range.
 */
const startTimeRead = (data: Record<string, { metadata: { dataOrigin: string }; startTime?: string; time?: string }[]>) =>
  (async (type: string, range: { start: Date; end: Date }, _page?: number) =>
    (data[type] ?? []).filter((r) => {
      const t = Date.parse((r.startTime ?? r.time)!);
      return t >= range.start.getTime() && t < range.end.getTime();
    })) as never;

async function staleStore() {
  const store = new MemoryStore();
  await store.setProfile({ birthDate: "1999-06-01", sex: "male", maxHr: null, heightCm: 173, timeZone: TZ });
  // What the first importer wrote: the per-minute maxima summed (1,150 steps), the band's and the phone's calories
  // added, a phone-only day, a derived minute count and a stray per-minute step.
  await store.upsertMetrics(
    ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"].map((day) => ({ ...emptyMetrics(day), steps: day === "2026-10-05" ? 3000 : 1150, calories: 4700 })),
  );
  await store.upsertDailyValues([{ day: "2026-10-05", key: "light_minutes", value: 60 }]);
  await store.putSteps([{ ts: sec("2026-10-05T15:00:00Z"), v: 40 }]);
  await store.upsertExercises([{ id: "phone-walk", day: "2026-10-06", startTs: sec("2026-10-06T08:00:00Z"), endTs: sec("2026-10-06T08:30:00Z"), type: "WALKING", name: null, calories: null, distanceM: null }]);
  await store.setSyncState({ lastSyncTs: sec("2026-10-07T06:00:00Z"), firstDay: "2026-10-03", lastError: null });
  storage.set("pulse.hc.changesToken", "old");
  storage.set(IMPORT_STATE_KEY, JSON.stringify({ version: 1, policy: "all" }));
  return store;
}

describe("fullReason", () => {
  const base = { requested: false, lastSyncTs: 1, hasNights: true, hasToken: true, newlyGranted: 0, imported: { version: IMPORT_VERSION } };
  it("names why a sync reads the whole window, and is null when it does not", () => {
    expect(fullReason(base)).toBeNull();
    expect(fullReason({ ...base, hasToken: false })).toBe("no_changes_token");
    expect(fullReason({ ...base, newlyGranted: 2 })).toBe("newly_granted_types");
    expect(fullReason({ ...base, hasNights: false })).toBe("no_nights");
    expect(fullReason({ ...base, imported: null })).toBe("no_import_state");
    expect(fullReason({ ...base, imported: { version: IMPORT_VERSION - 1 } })).toBe("importer_version");
  });
});

describe("windowPlan", () => {
  const base = { requested: false, lastSyncTs: 1, hasNights: true, hasToken: true, newlyGranted: 0 };
  it("re-imports when the importer version changed, or nothing was recorded", () => {
    expect(windowPlan({ ...base, imported: { version: IMPORT_VERSION } })).toEqual({ full: false, reimport: false });
    expect(windowPlan({ ...base, imported: { version: IMPORT_VERSION - 1 } })).toEqual({ full: true, reimport: true });
    expect(windowPlan({ ...base, imported: null })).toEqual({ full: true, reimport: true });
  });
  it("reads the full window without re-importing for the old reasons", () => {
    const imported = { version: IMPORT_VERSION };
    expect(windowPlan({ ...base, imported, requested: true })).toEqual({ full: true, reimport: false });
    expect(windowPlan({ ...base, imported, hasToken: false })).toEqual({ full: true, reimport: false });
    expect(windowPlan({ ...base, imported, newlyGranted: 1 })).toEqual({ full: true, reimport: false });
    expect(windowPlan({ ...base, imported, hasNights: false })).toEqual({ full: true, reimport: false });
  });
});

describe("syncHealthConnect re-import", () => {
  it("replaces what the old importer wrote for every day in the window, keeping every app and the largest source per day", async () => {
    const store = await staleStore();
    const r = await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    expect(r.counts).toMatchObject({ reimport: 1, full: 1 });
    expect(r.from).toBe("2026-10-03");
    // The largest source per day (the band's 600 steps against the phone's 590, not 1,150 added up); the other app's day stays.
    const metrics = new Map((await store.allMetrics()).map((m) => [m.day, m]));
    expect(metrics.get("2026-10-04")).toMatchObject({ steps: 600, calories: 1000 });
    expect(metrics.get("2026-10-06")).toMatchObject({ steps: 600, calories: 1000 });
    expect(metrics.get("2026-10-05")).toMatchObject({ steps: 3000, calories: 900 });
    // Stale derived values, per-minute steps and workouts in the window are replaced too.
    expect((await store.readSteps(sec("2026-10-05T00:00:00Z"), sec("2026-10-06T00:00:00Z"))).some((s) => s.v === 40)).toBe(false);
    expect((await store.allExercises()).map((e) => e.id)).toEqual([]);
    // The derived minutes come from the band's own minutes: 5 light ones, not the phone's 60.
    const derived = await store.dailyValues({ from: "2026-10-06", to: "2026-10-06" });
    expect(derived.find((v) => v.key === "light_minutes")?.value).toBe(5);
    // The phone's spread steps are kept too (every app's records are): the band's five minutes, the largest per minute, then the rest of the hour.
    const minutes = (await store.readSteps(sec("2026-10-06T00:00:00Z"), sec("2026-10-07T00:00:00Z"))).map((s) => s.v);
    expect(minutes).toHaveLength(60);
    expect(minutes.slice(0, 5)).toEqual([120, 120, 120, 120, 120]);
    expect(JSON.parse(storage.get(IMPORT_STATE_KEY)!)).toEqual({ version: IMPORT_VERSION });
  });

  it("re-imports once: the next sync is incremental again", async () => {
    const store = await staleStore();
    await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    const again = await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    expect(again.counts.reimport).toBeUndefined();
    expect(again.counts.full).toBeUndefined();
  });

  it("leaves days out of stage 1 when a sync brings the same samples again, and puts back a day whose samples changed", async () => {
    const store = await staleStore();
    await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    expect((await store.takeIntradayDirty()).length).toBeGreaterThan(0);

    // Health Connect reports a change (another record, written again), so the window is read; its samples are the same.
    const { getChanges } = await import("react-native-health-connect");
    const changed = { nextChangesToken: "tok2", upsertionChanges: [{ record: { startTime: "2026-10-07T00:00:00Z" } }], deletionChanges: [], hasMore: false, changesTokenExpired: false };
    vi.mocked(getChanges).mockResolvedValue(changed as never);
    await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    expect(await store.takeIntradayDirty()).toEqual([]);

    const data = fixture();
    data.Steps.push({ metadata: { id: "b-late", dataOrigin: FITBIT, device: { type: 6 } }, startTime: "2026-10-07T11:00:00Z", endTime: "2026-10-07T11:01:00Z", count: 90 } as never);
    hc.readAll.mockImplementation(startTimeRead(data));
    await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    expect(await store.takeIntradayDirty()).toEqual(["2026-10-07"]);
  });

  it("reads nothing when Health Connect reports no change since the last sync on the same day", async () => {
    const { getChanges } = await import("react-native-health-connect");
    vi.mocked(getChanges).mockResolvedValue({ nextChangesToken: "tok", upsertionChanges: [], deletionChanges: [], hasMore: false, changesTokenExpired: false } as never);
    const store = await staleStore();
    await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    hc.readAll.mockClear();
    const later = new Date(NOW.getTime() + 15 * 60_000);
    const r = await syncHealthConnect(store, { timeZone: TZ, now: later, historyDays: 5 });
    expect(r.unchanged).toBe(true);
    expect(hc.readAll).not.toHaveBeenCalled();
    expect((await store.getSyncState()).lastSyncTs).toBe(later.getTime() / 1000);

    // A deletion is a change: the window is read again.
    vi.mocked(getChanges).mockResolvedValue({ nextChangesToken: "tok3", upsertionChanges: [], deletionChanges: [{ recordId: "x" }], hasMore: false, changesTokenExpired: false } as never);
    const again = await syncHealthConnect(store, { timeZone: TZ, now: later, historyDays: 5 });
    expect(again.unchanged).toBeUndefined();
    expect(hc.readAll).toHaveBeenCalled();
  });

  it("a record deleted in Health Connect takes what it made with it: the window is replaced, no whole re-import", async () => {
    const { getChanges } = await import("react-native-health-connect");
    const store = await staleStore();
    await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    // Something an earlier sync brought in that Health Connect no longer has, inside the sync window (the last 3 days).
    await store.upsertDailyValues([{ day: "2026-10-06", key: "calories_in", value: 642 }]);
    await store.upsertExercises([{ id: "gone", day: "2026-10-06", startTs: sec("2026-10-06T08:00:00Z"), endTs: sec("2026-10-06T08:30:00Z"), type: "RUNNING", name: null, calories: null, distanceM: null }]);
    const later = new Date(NOW.getTime() + 15 * 60_000);
    vi.mocked(getChanges).mockResolvedValue({ nextChangesToken: "tok2", upsertionChanges: [], deletionChanges: [{ recordId: "x" }], hasMore: false, changesTokenExpired: false } as never);
    const r = await syncHealthConnect(store, { timeZone: TZ, now: later, historyDays: 5 });
    expect(r.counts.reimport).toBeUndefined();
    expect(r.counts.full).toBeUndefined();
    expect(r.counts.deleted).toBe(1);
    expect((await store.dailyValues()).some((v) => v.key === "calories_in")).toBe(false);
    expect((await store.allExercises()).some((e) => e.id === "gone")).toBe(false);
  });

  it("a deleted record Pulse holds reaches back to its day, however old", async () => {
    const { getChanges } = await import("react-native-health-connect");
    const store = await staleStore();
    await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    await store.upsertExercises([{ id: "old-run", day: "2026-10-03", startTs: sec("2026-10-03T08:00:00Z"), endTs: sec("2026-10-03T08:30:00Z"), type: "RUNNING", name: null, calories: null, distanceM: null }]);
    await store.upsertDailyValues([{ day: "2026-10-03", key: "calories_in", value: 500 }]);
    const later = new Date(NOW.getTime() + 15 * 60_000);
    vi.mocked(getChanges).mockResolvedValue({ nextChangesToken: "tok2", upsertionChanges: [], deletionChanges: [{ recordId: "old-run" }], hasMore: false, changesTokenExpired: false } as never);
    const r = await syncHealthConnect(store, { timeZone: TZ, now: later, historyDays: 5 });
    expect(r.from).toBe("2026-10-03");
    expect((await store.allExercises()).some((e) => e.id === "old-run")).toBe(false);
    expect((await store.dailyValues()).some((v) => v.day === "2026-10-03" && v.key === "calories_in")).toBe(false);
  });

  it("finds the day of a stored workout, night or log by the deleted record's id", async () => {
    const store = new MemoryStore();
    await store.upsertExercises([{ id: "w1", day: "2026-10-02", startTs: 1, endTs: 2, type: "RUNNING", name: null, calories: null, distanceM: null }]);
    await store.addLoggedEntries([{ id: "hc-food-f1", type: "nutrition-log", ts: 3, day: "2026-09-30", data: {}, createdAt: 3, source: "health_connect" }]);
    expect(await dayOfStoredRecords(store, ["unknown"])).toBeNull();
    expect(await dayOfStoredRecords(store, ["w1"])).toBe("2026-10-02");
    expect(await dayOfStoredRecords(store, ["w1", "f1"])).toBe("2026-09-30");
    expect(await dayOfStoredRecords(store, [])).toBeNull();
  });

  it("still reads an import state stored by an older app, with a policy: current version, no re-import", async () => {
    const store = await staleStore();
    await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    storage.set(IMPORT_STATE_KEY, JSON.stringify({ version: IMPORT_VERSION, policy: "fitbit_only" }));
    const r = await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    expect(r.counts.reimport).toBeUndefined();
  });

  it("an install that stored an older version re-imports once under the single behaviour", async () => {
    const store = await staleStore();
    storage.set(IMPORT_STATE_KEY, JSON.stringify({ version: IMPORT_VERSION - 1, policy: "fitbit_only" }));
    const r = await syncHealthConnect(store, { timeZone: TZ, now: NOW, historyDays: 5 });
    expect(r.counts.reimport).toBe(1);
    expect(JSON.parse(storage.get(IMPORT_STATE_KEY)!)).toEqual({ version: IMPORT_VERSION });
  });
});

// Health Connect returns a record only to the read its start falls in (startTimeRead above), so a read from a local
// midnight misses the night that began the evening before, and a day's read misses a record begun the day before.
describe("syncHealthConnect under Health Connect's start-time reads", () => {
  const band = (id: string) => meta(id, FITBIT, 6);
  const stage = (startTime: string, endTime: string, s: number) => ({ startTime, endTime, stage: s });
  const D = "2026-10-05";

  /** Two staged nights around D (A ends on D, begun at 23:00 the evening before), a nap on D, their nightly readings. */
  function nights() {
    const SleepSession = [
      { metadata: band("nightA"), startTime: "2026-10-04T23:00:00Z", endTime: "2026-10-05T07:00:00Z", stages: [stage("2026-10-04T23:00:00Z", "2026-10-05T01:00:00Z", 4), stage("2026-10-05T01:00:00Z", "2026-10-05T03:00:00Z", 5), stage("2026-10-05T03:00:00Z", "2026-10-05T07:00:00Z", 6)] },
      { metadata: band("nap"), startTime: "2026-10-05T14:00:00Z", endTime: "2026-10-05T14:40:00Z", stages: [stage("2026-10-05T14:00:00Z", "2026-10-05T14:40:00Z", 4)] },
      { metadata: band("nightB"), startTime: "2026-10-05T23:00:00Z", endTime: "2026-10-06T07:00:00Z", stages: [stage("2026-10-05T23:00:00Z", "2026-10-06T01:00:00Z", 4), stage("2026-10-06T01:00:00Z", "2026-10-06T03:00:00Z", 5), stage("2026-10-06T03:00:00Z", "2026-10-06T07:00:00Z", 6)] },
    ];
    // Night A's HRV: 70 ms before midnight, 40 after (the night's mean is 55).
    const HeartRateVariabilityRmssd = [
      ...["2026-10-04T23:15:00Z", "2026-10-04T23:45:00Z"].map((time, i) => ({ metadata: band(`hrv-a${i}`), time, heartRateVariabilityMillis: 70 })),
      ...["2026-10-05T01:00:00Z", "2026-10-05T03:00:00Z"].map((time, i) => ({ metadata: band(`hrv-b${i}`), time, heartRateVariabilityMillis: 40 })),
    ];
    const RespiratoryRate = [
      { metadata: band("resp-a"), time: "2026-10-04T23:10:00Z", rate: 14 },
      { metadata: band("resp-b"), time: "2026-10-05T23:10:00Z", rate: 18 },
    ];
    const SkinTemperature = [
      { metadata: band("skin-a"), startTime: "2026-10-04T23:00:00Z", endTime: "2026-10-05T07:00:00Z", baseline: { inCelsius: 34 }, deltas: [{ time: "2026-10-05T03:00:00Z", delta: { inCelsius: 0.5 } }] },
      { metadata: band("skin-b"), startTime: "2026-10-05T23:00:00Z", endTime: "2026-10-06T07:00:00Z", baseline: { inCelsius: 34 }, deltas: [{ time: "2026-10-06T03:00:00Z", delta: { inCelsius: -0.2 } }] },
    ];
    // Hourly heart-rate series, a sample a minute: 55 bpm asleep, 70 awake.
    const HeartRate: object[] = [];
    for (let h = sec("2026-10-02T00:00:00Z"); h < sec("2026-10-08T18:00:00Z"); h += 3600) {
      const samples = Array.from({ length: 60 }, (_, m) => {
        const t = h + m * 60;
        return { time: iso(t), beatsPerMinute: SleepSession.some((s) => t >= sec(s.startTime) && t < sec(s.endTime)) ? 55 : 70 };
      });
      HeartRate.push({ metadata: band(`hr-${h}`), startTime: iso(h), endTime: iso(h + 3600), samples });
    }
    return { SleepSession, HeartRateVariabilityRmssd, RespiratoryRate, SkinTemperature, HeartRate } as never;
  }

  async function profiled() {
    const store = new MemoryStore();
    await store.setProfile({ birthDate: "1999-06-01", sex: "male", maxHr: null, heightCm: 173, timeZone: TZ });
    return store;
  }
  const granted = (types: string[]) => hc.permissionState.mockResolvedValue({ granted: types, missing: [], history: true, background: true } as never);

  async function dayOf(store: InstanceType<typeof MemoryStore>, day: string) {
    const m = (await store.allMetrics()).find((x) => x.day === day);
    const sessions = (await store.allSessions()).filter((s) => s.day === day).map((s) => `${s.id}:${s.isMain ? "main" : "nap"}`).sort();
    const values = Object.fromEntries((await store.dailyValues({ from: day, to: day })).map((v) => [v.key, v.value]));
    return { hrvMs: m?.hrvMs, respBpm: m?.respBpm, nightlyTempC: m?.nightlyTempC, tempBaselineC: m?.tempBaselineC, sessions, sedentary: values.sedentary_minutes };
  }

  it("an incremental sync keeps the night begun before its window: its first day reads as the full import left it", async () => {
    hc.readAll.mockImplementation(startTimeRead(nights()));
    granted(["SleepSession", "HeartRate", "HeartRateVariabilityRmssd", "RespiratoryRate", "SkinTemperature"]);
    const store = await profiled();
    await syncHealthConnect(store, { timeZone: TZ, now: new Date("2026-10-08T12:00:00Z"), historyDays: 7 });
    const full = await dayOf(store, D);
    expect(full).toMatchObject({ hrvMs: 55, respBpm: 14, nightlyTempC: 34.5, tempBaselineC: 34, sessions: ["nap:nap", "nightA:main"] });
    // Three days after the last sync: D is the window's first day.
    vi.mocked((await import("react-native-health-connect")).getChanges).mockResolvedValue(WRITTEN("2026-10-08") as never);
    const r = await syncHealthConnect(store, { timeZone: TZ, now: new Date("2026-10-08T18:00:00Z"), historyDays: 7 });
    expect(r.from).toBe(D);
    expect(r.counts.full).toBeUndefined();
    // It read 40 ms (after midnight only), the next night's breathing rate, no skin temperature, the nap as the night,
    // and the night's seven hours after midnight as sedentary.
    expect(await dayOf(store, D)).toEqual(full);
    // The lead day (D − 1) caught only part of its night: none of its rows were rewritten from it.
    expect((await store.allSessions()).filter((s) => s.day === "2026-10-04")).toEqual([]);
  });

  it("a heart-rate or steps record running over midnight keeps its samples after it, also on the window's first day", async () => {
    // Half-hour-shifted series (23:30 to 00:30 crosses every midnight), and a 20-minute walk record over D's midnight.
    const HeartRate: object[] = [];
    for (let h = sec("2026-10-01T00:30:00Z"); h < sec("2026-10-08T12:00:00Z"); h += 3600) {
      HeartRate.push({ metadata: band(`hr-${h}`), startTime: iso(h), endTime: iso(h + 3600), samples: Array.from({ length: 60 }, (_, k) => ({ time: iso(h + k * 60), beatsPerMinute: 60 })) });
    }
    const Steps = [
      { metadata: band("walk-midnight"), startTime: "2026-10-04T23:50:00Z", endTime: "2026-10-05T00:10:00Z", count: 200 },
      { metadata: band("walk-morning"), startTime: "2026-10-05T10:00:00Z", endTime: "2026-10-05T10:05:00Z", count: 500 },
    ];
    hc.readAll.mockImplementation(startTimeRead({ HeartRate, Steps } as never));
    granted(["HeartRate", "Steps"]);
    const store = await profiled();
    await syncHealthConnect(store, { timeZone: TZ, now: new Date("2026-10-08T12:00:00Z"), historyDays: 7 });
    // D's first half hour came with the record begun on D − 1; the window's first day's (Oct 2) with the lead's.
    expect(await store.readHr(sec("2026-10-05T00:00:00Z"), sec("2026-10-05T00:30:00Z"))).toHaveLength(30);
    expect(await store.readHr(sec("2026-10-02T00:00:00Z"), sec("2026-10-02T00:30:00Z"))).toHaveLength(30);
    // The walk's ten minutes after midnight are D's: 100 of its steps, plus the morning's 500.
    expect((await store.readSteps(sec("2026-10-05T00:00:00Z"), sec("2026-10-05T00:10:00Z"))).map((s) => s.v)).toEqual(Array(10).fill(10));
    const steps = new Map((await store.allMetrics()).map((m) => [m.day, m.steps]));
    expect(steps.get("2026-10-04")).toBe(100);
    expect(steps.get(D)).toBe(600);
  });

  it("a period begun before the window isn't doubled by one rebuilt from its flow days", async () => {
    const female = meta("p1", FITBIT);
    const data = {
      SleepSession: [{ metadata: band("n1"), startTime: "2026-10-02T00:00:00Z", endTime: "2026-10-02T07:00:00Z", stages: [] }],
      MenstruationPeriod: [{ metadata: female, startTime: "2026-10-01T00:00:00Z", endTime: "2026-10-07T00:00:00Z" }],
      MenstruationFlow: ["01", "02", "03", "04", "05", "06"].map((d) => ({ metadata: meta(`f${d}`, FITBIT), time: `2026-10-${d}T08:00:00Z`, flow: 2 })),
    };
    hc.readAll.mockImplementation(startTimeRead(data as never));
    granted(["SleepSession", "MenstruationPeriod", "MenstruationFlow"]);
    const store = await profiled();
    const periods = async () => (await store.loggedEntries(0, 100)).filter((e) => e.type === "menstrual-period").map((e) => [e.id, e.data]);
    await syncHealthConnect(store, { timeZone: TZ, now: new Date("2026-10-08T12:00:00Z"), historyDays: 10 });
    const once = await periods();
    expect(once).toHaveLength(1);
    // The incremental sync's window starts on Oct 5, inside the period: its flow days are still the period's.
    vi.mocked((await import("react-native-health-connect")).getChanges).mockResolvedValue(WRITTEN("2026-10-08") as never);
    const r = await syncHealthConnect(store, { timeZone: TZ, now: new Date("2026-10-08T18:00:00Z"), historyDays: 10 });
    expect(r.from).toBe(D);
    expect(await periods()).toEqual(once);
  });

  it("syncs blood pressure records through syncHealthConnect into the store", async () => {
    const bpData = {
      BloodPressure: [
        {
          metadata: { id: "bp-sync-1", dataOrigin: "com.omronhealthcare.omronconnect" },
          time: "2026-10-06T14:30:00Z",
          systolic: { inMillimetersOfMercury: 124 },
          diastolic: { inMillimetersOfMercury: 82 },
        },
      ],
    };
    hc.readAll.mockImplementation(startTimeRead(bpData as never));
    granted(["BloodPressure"]);
    const store = await profiled();
    const res = await syncHealthConnect(store, { timeZone: TZ, now: new Date("2026-10-08T12:00:00Z"), historyDays: 7 });
    expect(res.counts.bloodPressure).toBe(1);
    const stored = await store.allBloodPressure();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: "bp-sync-1",
      systolicMmhg: 124,
      diastolicMmhg: 82,
      sourceApplication: "com.omronhealthcare.omronconnect",
    });
  });
});
