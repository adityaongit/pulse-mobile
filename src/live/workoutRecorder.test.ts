// The recorder without a phone: the native journal is a small fake, the Store is in memory.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryWorkoutStore } from "@/data/workouts";
import type { RecordedWorkout, WorkoutSample } from "./workout";

const fake = vi.hoisted(() => {
  type Session = { meta: Record<string, unknown>; samples: Record<string, unknown>[]; pending: boolean };
  const journal = new Map<string, Session>();
  return {
    journal,
    activeId: null as string | null,
    pageSize: 2,
    /** Holds every samples() call until released, to catch a poll mid-ingest. */
    gate: null as Promise<void> | null,
    store: { workouts: null as unknown, deleteExercises: vi.fn(async (_ids: string[]) => {}), markIntradayDirty: vi.fn(async (_days: string[]) => {}), upsertExercises: vi.fn(async () => {}) },
    writeAllowed: true,
    sync: vi.fn(async () => {}),
    saveExercise: vi.fn(async (_w: { clientRecordId: string; exerciseType: number }): Promise<string | null> => "hc-1"),
    deleteExercise: vi.fn(async (_id: string) => {}),
    native: {
      notificationsEnabled: vi.fn(async () => true),
      start: vi.fn(async (_config: unknown): Promise<string> => { throw new Error("unused"); }),
      command: vi.fn(async (_id: string, _action: string): Promise<string> => { throw new Error("unused"); }),
      active: vi.fn(async () => (fake.activeId ? JSON.stringify(journal.get(fake.activeId)!.meta) : null)),
      pending: vi.fn(async () => JSON.stringify([...journal.values()].filter((s) => s.pending).map((s) => s.meta))),
      samples: vi.fn(async (id: string, offset: number) => {
        if (fake.gate) await fake.gate;
        const all = journal.get(id)?.samples ?? [];
        const next = Math.min(all.length, offset + fake.pageSize);
        return JSON.stringify({ samples: all.slice(offset, next), offset: next, more: next < all.length });
      }),
      acknowledge: vi.fn(async (id: string, revision: number) => {
        const s = journal.get(id);
        if (s && s.meta.status === "completed" && s.meta.revision === revision) journal.delete(id);
      }),
      resetPending: vi.fn(async () => false),
      beginReset: vi.fn(async () => {}),
      finishReset: vi.fn(async () => {}),
    },
    ble: {
      getSnapshot: vi.fn(() => ({ device: { id: "AA:BB:CC:DD:EE:FF", name: "Band" }, remembered: null })),
      suspendForWorkout: vi.fn(async () => {}),
      releaseWorkout: vi.fn(),
    },
  };
});

vi.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) } }));
vi.mock("../../modules/pulse-workouts", () => ({ workoutNative: fake.native, workoutNativeAvailable: true }));
vi.mock("@/health/ble", () => ({ liveBle: fake.ble }));
vi.mock("@/background/notify", () => ({ askNotificationPermission: vi.fn(async () => "granted") }));
vi.mock("@/state/app", () => ({ appStore: () => fake.store, refresh: fake.sync, rescore: fake.sync, isSyncing: () => false }));
vi.mock("@/health/connect", () => ({ saveExercise: fake.saveExercise, deleteExercise: fake.deleteExercise, readAll: vi.fn(async () => []), exerciseWriteAllowed: vi.fn(async () => fake.writeAllowed) }));
vi.mock("@/health/import", () => ({ mapExercises: () => [], MIN_EXERCISE_SEC: 120 }));
vi.mock("@/lib/telemetry", () => ({ report: vi.fn(), reportError: vi.fn(), errorKind: () => "unknown" }));
vi.mock("@/i18n/config", () => ({ i18n: { t: (key: string) => key } }));

const session = (id: string, patch: Partial<RecordedWorkout> = {}): RecordedWorkout => ({
  schemaVersion: 1, id, type: "run", status: "recording", startedAt: 1_000, endedAt: null, updatedAt: 1_000, activeMs: 0,
  revision: 1, seq: 0, epoch: 0, deviceId: "AA:BB:CC:DD:EE:FF", deviceName: "Band", timeZone: "UTC", restingHr: 55,
  maxHr: 190, sex: "male", estimatedMaxHr: false, algorithmVersion: 1, link: "live", lastBpm: null, lastSampleAt: null,
  error: null, ...patch,
});
const sample = (seq: number): WorkoutSample => ({ seq, t: 1_000 + seq * 1_000, elapsedMs: seq * 1_000, bpm: 100 + seq, epoch: 0, rrMs: [] });
function put(meta: RecordedWorkout, count: number, pending = true) {
  fake.journal.set(meta.id, { meta: { ...meta }, samples: Array.from({ length: count }, (_, i) => sample(i + 1)), pending });
}

let store: MemoryWorkoutStore;
async function recorder() {
  vi.resetModules();
  return (await import("./workoutRecorder")).workoutRecorder;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.journal.clear();
  fake.activeId = null;
  fake.pageSize = 2;
  fake.gate = null;
  fake.writeAllowed = true;
  fake.deleteExercise.mockImplementation(async () => {});
  store = new MemoryWorkoutStore();
  fake.store.workouts = store;
});

describe("WorkoutRecorder", () => {
  it("pages a completed session into the Store and then acknowledges it", async () => {
    put(session("done", { status: "completed", revision: 4, endedAt: 9_000 }), 5);
    const r = await recorder();
    await r.refresh();
    expect(fake.native.samples.mock.calls.map((c) => c[1])).toEqual([0, 2, 4]);
    expect((await store.samples("done")).map((s) => s.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(await store.cursor("done")).toBe(5);
    expect(fake.native.acknowledge).toHaveBeenCalledWith("done", 4);
    expect(fake.journal.has("done")).toBe(false);
    expect(r.getSnapshot().history.map((w) => w.id)).toEqual(["done"]);
  });

  it("resumes the active session from the Store's cursor", async () => {
    put(session("live"), 3);
    fake.activeId = "live";
    const r = await recorder();
    await r.refresh();
    fake.journal.get("live")!.samples.push(sample(4));
    fake.native.samples.mockClear();
    await r.refresh();
    expect(fake.native.samples.mock.calls[0]).toEqual(["live", 3]);
    expect(r.getSnapshot().samples.map((s) => s.seq)).toEqual([1, 2, 3, 4]);
    expect(fake.native.acknowledge).not.toHaveBeenCalled();
  });

  it("never acknowledges a completed session it could not drain", async () => {
    put(session("stuck", { status: "completed" }), 3);
    fake.native.samples.mockImplementationOnce(async () => JSON.stringify({ samples: [], offset: 0, more: true }));
    const r = await recorder();
    await r.refresh();
    expect(fake.native.acknowledge).not.toHaveBeenCalled();
    expect(fake.journal.has("stuck")).toBe(true);
  });

  it("holds the band's live link while a session is active and gives it back after", async () => {
    put(session("live"), 1);
    fake.activeId = "live";
    const r = await recorder();
    await r.refresh();
    await r.refresh();
    expect(fake.ble.suspendForWorkout).toHaveBeenCalledTimes(1);
    expect(fake.ble.releaseWorkout).not.toHaveBeenCalled();
    expect(r.getSnapshot().active?.id).toBe("live");

    fake.journal.get("live")!.meta.status = "completed";
    fake.journal.get("live")!.meta.revision = 2;
    fake.activeId = null;
    await r.refresh();
    expect(fake.ble.releaseWorkout).toHaveBeenCalledTimes(1);
    expect(r.getSnapshot().active).toBeNull();
    expect(r.getSnapshot().viewed?.id).toBe("live");
    expect(fake.native.acknowledge).toHaveBeenCalledWith("live", 2);
  });

  it("settle waits for a poll that is still ingesting, so a reset clears after it", async () => {
    put(session("done", { status: "completed" }), 2);
    let open!: () => void;
    fake.gate = new Promise<void>((resolve) => { open = resolve; });
    const r = await recorder();
    void r.refresh();
    let settled = false;
    const settling = r.settle().then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    open();
    await settling;
    expect((await store.samples("done")).length).toBe(2);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it("settle resolves at once with no poll under way", async () => {
    const r = await recorder();
    await expect(r.settle()).resolves.toBeUndefined();
  });

  it("maps a native rejection to its code and releases the band when nothing started", async () => {
    const r = await recorder();
    fake.native.start.mockRejectedValueOnce(new Error("activeWorkout"));
    await r.start("run", { restingHr: 55, maxHr: 190, sex: "male", estimatedMaxHr: false, timeZone: "UTC" });
    expect(r.getSnapshot().error).toBe("activeWorkout");
    expect(fake.ble.suspendForWorkout).toHaveBeenCalled();
    expect(fake.ble.releaseWorkout).toHaveBeenCalled();

    fake.native.start.mockRejectedValueOnce(new Error("commandTimeout"));
    await r.start("run", { restingHr: 55, maxHr: 190, sex: "male", estimatedMaxHr: false, timeZone: "UTC" });
    expect(r.getSnapshot().error).toBe("commandFailed");
    expect(r.getSnapshot().busy).toBe(false);
  });

  it("finishes the active session and acknowledges it once ingested", async () => {
    put(session("live"), 2);
    fake.activeId = "live";
    const r = await recorder();
    await r.refresh();
    fake.native.command.mockImplementationOnce(async (id) => {
      const s = fake.journal.get(id)!;
      s.meta = { ...s.meta, status: "completed", revision: 3, endedAt: 5_000 };
      fake.activeId = null;
      return JSON.stringify(s.meta);
    });
    await r.command("finish");
    expect(fake.native.acknowledge).toHaveBeenCalledWith("live", 3);
    expect(r.getSnapshot().active).toBeNull();
    expect(r.getSnapshot().viewed?.status).toBe("completed");
    expect(r.getSnapshot().error).toBeNull();
  });

  it("saves a finished workout to Health Connect once, keeps its id and syncs, without holding Finish", async () => {
    put(session("live"), 2);
    fake.activeId = "live";
    const r = await recorder();
    await r.refresh();
    fake.native.command.mockImplementationOnce(async (id) => {
      const s = fake.journal.get(id)!;
      s.meta = { ...s.meta, status: "completed", revision: 3, endedAt: 200_000 };
      fake.activeId = null;
      return JSON.stringify(s.meta);
    });
    expect(await r.command("finish")).toBe(true);
    await vi.waitFor(() => expect(fake.sync).toHaveBeenCalled());
    expect(fake.saveExercise).toHaveBeenCalledTimes(1);
    expect(fake.saveExercise.mock.calls[0][0]).toMatchObject({ clientRecordId: "live" });
    expect((await (fake.store.workouts as MemoryWorkoutStore).get("live"))?.hcId).toBe("hc-1");
    await r.refresh();
    expect(fake.saveExercise).toHaveBeenCalledTimes(1);
  });

  it("keeps a workout under two minutes (wall clock) on the phone: the import would drop it", async () => {
    put(session("short", { status: "completed", revision: 2, endedAt: 100_000 }), 1);
    const r = await recorder();
    await r.refresh();
    await new Promise((res) => setTimeout(res, 0));
    expect(fake.saveExercise).not.toHaveBeenCalled();
  });

  it("never saves a running workout it is discarding to Health Connect", async () => {
    put(session("live"), 2);
    fake.activeId = "live";
    const r = await recorder();
    await r.refresh();
    fake.native.command.mockImplementationOnce(async (id) => {
      const s = fake.journal.get(id)!;
      s.meta = { ...s.meta, status: "completed", revision: 3, endedAt: 200_000 };
      fake.activeId = null;
      return JSON.stringify(s.meta);
    });
    expect(await r.discard("live")).toBe(true);
    await new Promise((res) => setTimeout(res, 0));
    expect(fake.saveExercise).not.toHaveBeenCalled();
    expect(await store.get("live")).toBeNull();
  });

  it("saves a workout that stayed on the phone once Pulse may write, when the app comes back", async () => {
    fake.writeAllowed = false;
    fake.saveExercise.mockResolvedValueOnce(null);
    put(session("done", { status: "completed", revision: 2, endedAt: 200_000, strainSetup: { restingHr: 55, maxHr: 190, base: null, sex: "male" } }), 1);
    const r = await recorder();
    r.mount()();
    await vi.waitFor(() => expect(fake.native.acknowledge).toHaveBeenCalled());
    await new Promise((res) => setTimeout(res, 0));
    expect((await store.get("done"))?.hcId ?? null).toBeNull();
    fake.writeAllowed = true;
    r.mount()();
    await vi.waitFor(async () => expect((await store.get("done"))?.hcId).toBe("hc-1"));
  });

  it("deletes the Health Connect copy, and the imported activity, with the workout", async () => {
    await store.ingest({ ...session("done"), status: "completed", endedAt: 200_000, hcId: "hc-9" } as RecordedWorkout, [], 0);
    const r = await recorder();
    expect(await r.discard("done")).toBe(true);
    expect(fake.deleteExercise).toHaveBeenCalledWith("hc-9");
    expect(fake.store.deleteExercises).toHaveBeenCalledWith(["hc-9"]);
    expect(fake.store.markIntradayDirty).toHaveBeenCalledWith(["1970-01-01"]);
    expect(await store.get("done")).toBeNull();
  });

  it("keeps the workout when Health Connect cannot delete its copy, and says why", async () => {
    await store.ingest({ ...session("done"), status: "completed", endedAt: 200_000, hcId: "hc-9" } as RecordedWorkout, [], 0);
    fake.deleteExercise.mockRejectedValueOnce(new Error("healthPermission"));
    const r = await recorder();
    expect(await r.discard("done")).toBe(false);
    expect(r.getSnapshot().error).toBe("healthPermission");
    expect(await store.get("done")).not.toBeNull();
    expect(fake.store.deleteExercises).not.toHaveBeenCalled();
  });
});
