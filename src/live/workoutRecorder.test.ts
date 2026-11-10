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
    store: { workouts: null as unknown },
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
vi.mock("@/state/app", () => ({ appStore: () => fake.store, refresh: fake.sync, rescore: fake.sync }));
vi.mock("@/health/connect", () => ({ saveExercise: fake.saveExercise, deleteExercise: fake.deleteExercise, readAll: vi.fn(async () => []) }));
vi.mock("@/health/import", () => ({ mapExercises: () => [] }));
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

  it("saves a finished workout to Health Connect once, keeps its id and syncs", async () => {
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
    expect(fake.saveExercise).toHaveBeenCalledTimes(1);
    expect(fake.saveExercise.mock.calls[0][0]).toMatchObject({ clientRecordId: "live" });
    expect((await (fake.store.workouts as MemoryWorkoutStore).get("live"))?.hcId).toBe("hc-1");
    expect(fake.sync).toHaveBeenCalled();
    await r.refresh();
    expect(fake.saveExercise).toHaveBeenCalledTimes(1);
  });

  it("deletes the Health Connect copy with the workout", async () => {
    const store = fake.store.workouts as MemoryWorkoutStore;
    await store.ingest({ ...session("done"), status: "completed", endedAt: 5_000, hcId: "hc-9" } as RecordedWorkout, [], 0);
    const r = await recorder();
    await r.discard("done");
    expect(fake.deleteExercise).toHaveBeenCalledWith("hc-9");
    expect(await store.get("done")).toBeNull();
  });
});
