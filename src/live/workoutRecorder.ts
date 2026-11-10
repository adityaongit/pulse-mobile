import { AppState } from "react-native";
import { i18n } from "@/i18n/config";
import { appStore, refresh as syncNow, rescore } from "@/state/app";
import { mapExercises } from "@/health/import";
import { localDay } from "@/lib/time";
import { deleteExercise, readAll, saveExercise } from "@/health/connect";
import { liveBle } from "@/health/ble";
import { askNotificationPermission } from "@/background/notify";
import { errorKind, report, reportError } from "@/lib/telemetry";
import { workoutNative, workoutNativeAvailable } from "../../modules/pulse-workouts";
import { HC_EXERCISE, parseRecordedWorkout, parseWorkoutSample, type RecordedWorkout, type WorkoutSample, type WorkoutType } from "./workout";

export type WorkoutCalibration = Pick<RecordedWorkout, "restingHr" | "maxHr" | "sex" | "estimatedMaxHr" | "timeZone">;
type State = { active: RecordedWorkout | null; viewed: RecordedWorkout | null; samples: WorkoutSample[]; history: RecordedWorkout[]; busy: boolean; loading: boolean; error: string | null };
type Page = { samples: WorkoutSample[]; offset: number; more: boolean };

/** One app-wide coordinator. Navigation only subscribes: it never owns or finishes a recording. */
class WorkoutRecorder {
  private state: State = { active: null, viewed: null, samples: [], history: [], busy: false, loading: true, error: null };
  private listeners = new Set<() => void>();
  private owner: string | null = null;
  private polling: Promise<void> | null = null;
  private historyLimit = 25;
  private selectedId: string | null = null;
  private activeSamples = new Map<number, WorkoutSample>();
  private timer: ReturnType<typeof setInterval> | null = null;
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private patch(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }

  mount = (): (() => void) => {
    void this.refresh();
    this.timer = setInterval(() => { if (AppState.currentState === "active" && (this.state.active || this.state.loading || this.state.error === "storage")) void this.refresh(); }, 1000);
    const subscription = AppState.addEventListener("change", (status) => { if (status === "active") void this.refresh(); });
    return () => { if (this.timer) clearInterval(this.timer); this.timer = null; subscription.remove(); };
  };
  private ingest(session: RecordedWorkout): Promise<void> {
    return this.drain(session).catch((error: unknown) => {
      void reportError("workout.ingest_failed", error);
      throw error;
    });
  }
  private async drain(session: RecordedWorkout): Promise<void> {
    const store = appStore().workouts;
    let offset = await store.cursor(session.id);
    let drained = false;
    for (;;) {
      const page = JSON.parse(await workoutNative.samples(session.id, offset)) as Page;
      if (!Number.isSafeInteger(page.offset) || page.offset < offset || !Array.isArray(page.samples)) throw new Error("invalidCursor");
      const samples = page.samples.map(parseWorkoutSample);
      await store.ingest(session, samples, page.offset);
      if (session.id === this.owner) for (const point of samples) this.activeSamples.set(point.seq, point);
      drained = !page.more;
      if (!page.more || page.offset === offset) break;
      offset = page.offset;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    // Acknowledging deletes the native journal, so only once every committed sample is in the Store.
    if (session.status === "completed" && drained) {
      await workoutNative.acknowledge(session.id, session.revision);
      await this.export(session.id);
    }
  }
  /** Reads back the one session Pulse wrote, maps it with the import's mapper, stores it and rescores its day. */
  private async storeImported(hcId: string, session: RecordedWorkout): Promise<void> {
    const end = session.endedAt ?? session.updatedAt;
    const records = (await readAll("ExerciseSession", { start: new Date(session.startedAt - 60_000), end: new Date(end + 60_000) })).filter((r) => r.metadata?.id === hcId);
    if (!records.length) return;
    const app = appStore();
    const tz = session.timeZone;
    await app.upsertExercises(mapExercises(records, [], [], tz));
    await app.markIntradayDirty([localDay(session.startedAt / 1000, tz)]);
    await rescore();
  }
  /**
   * Saves a finished workout's session to Health Connect (where Google Health reads it), keeps its id, and syncs so the
   * import brings it back as an activity like any other. Without the write permission the workout stays on the phone.
   */
  private async export(id: string): Promise<void> {
    const store = appStore().workouts;
    const session = await store.get(id);
    if (!session || session.status !== "completed" || session.hcId || session.endedAt === null) return;
    const hcId = await saveExercise({
      clientRecordId: session.id,
      start: session.startedAt,
      end: session.endedAt,
      exerciseType: HC_EXERCISE[session.type],
      title: i18n.t(`workouts:recorder.types.${session.type}`),
    }).catch(() => null);
    if (!hcId) return;
    await store.ingest({ ...session, hcId }, [], await store.cursor(session.id));
    // The activity page waits on this: store the session as the import would and score today only (about a second),
    // instead of a whole sync (every type, then scoring). The full sync follows for the band's heart rate.
    await this.storeImported(hcId, session).catch(() => {});
    void syncNow().catch(() => {});
  }
  refresh = (): Promise<void> => {
    if (this.polling) return this.polling;
    if (this.state.busy) return Promise.resolve();
    const task = this.poll().catch((error: unknown) => {
      // Boot may not yet have opened the Store. Subsequent polls retry; write failures are always visible.
      if (!(error instanceof Error && error.message === "store_not_open")) {
        void report("workout.storage_failed", { kind: errorKind(error) });
        this.patch({ error: "storage", loading: false });
      }
    }).finally(() => { this.polling = null; });
    this.polling = task;
    return task;
  };
  private async poll() {
    const store = appStore().workouts;
    if (workoutNativeAvailable && await workoutNative.resetPending()) return;
    if (!workoutNativeAvailable) { this.patch({ loading: false }); return; }
    const raw = await workoutNative.active();
    const current = raw ? parseRecordedWorkout(raw) : null;
    const active = current?.status === "completed" ? null : current;
    if (active && this.owner !== active.id) {
      await liveBle.suspendForWorkout();
      this.owner = active.id;
      this.activeSamples = new Map((await store.samples(active.id)).map((p) => [p.seq, p]));
    }
    if (active) await this.ingest(active);
    const pending = JSON.parse(await workoutNative.pending()) as unknown[];
    if (!Array.isArray(pending)) throw new Error("invalidSession");
    for (const row of pending) {
      const session = parseRecordedWorkout(row);
      if (session.id !== active?.id) await this.ingest(session);
    }
    const previous = this.state.active;
    if (!active && this.owner) {
      this.owner = null;
      liveBle.releaseWorkout();
      this.selectedId = previous?.id ?? this.selectedId;
    }
    const viewed = active ?? (this.selectedId ? await store.get(this.selectedId) : null);
    const samples = active ? [...this.activeSamples.values()].sort((a, b) => a.seq - b.seq) : viewed ? await store.samples(viewed.id) : [];
    const history = await store.list(this.historyLimit);
    // The same list (same object) unless a workout changed, so screens that load from it don't reload every second.
    const same = history.length === this.state.history.length && history.every((w, i) => sameRow(w, this.state.history[i]));
    this.patch({ active, viewed, samples, history: same ? this.state.history : history, loading: false, error: this.state.error === "storage" ? null : this.state.error });
  }
  private async action(run: () => Promise<void>) {
    if (this.state.busy) return;
    this.patch({ busy: true, error: null });
    try { if (this.polling) await this.polling; await run(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      const known = ["nativeUnavailable", "activeWorkout", "bluetoothPermission", "bluetoothOff", "invalidSession", "notificationPermission"];
      const code = known.find((c) => message.includes(c)) ?? "commandFailed";
      // The person's own states (Bluetooth off, a permission refused) are not failures worth a report.
      if (code === "commandFailed" || code === "invalidSession" || code === "nativeUnavailable") void report("workout.command_failed", { code, kind: errorKind(error) });
      this.patch({ error: code });
    } finally { this.patch({ busy: false }); await this.refresh(); }
  }
  /** `calibration` may carry the start setup (workoutStart.ts); every field is kept on the session. */
  start = (type: WorkoutType, calibration: WorkoutCalibration & Partial<Pick<RecordedWorkout, "strainSetup" | "target" | "body">>) => this.action(async () => {
    if (!workoutNativeAvailable) throw new Error("nativeUnavailable");
    await this.requireNotification();
    const band = liveBle.getSnapshot();
    const device = band.device ?? band.remembered;
    if (!device) throw new Error("bluetoothPermission");
    await liveBle.suspendForWorkout();
    try {
      const labels = {
        ...Object.fromEntries((["title", "recording", "waiting", "paused", "pause", "resume", "finish"] as const).map((key) => [key, i18n.t(`workouts:recorder.${key}`)])),
        // The notification card's title and zone labels (native String.format fills %d).
        name: i18n.t(`workouts:recorder.types.${type}`),
        zone: i18n.t("workouts:live.zone", { zone: "%d" }),
      };
      const session = parseRecordedWorkout(await workoutNative.start({ ...calibration, type, deviceId: device.id, deviceName: device.name, algorithmVersion: 1, labels }));
      this.owner = session.id;
      this.selectedId = null;
      this.activeSamples.clear();
      this.patch({ active: session, viewed: session, samples: [] });
    } catch (error) {
      if (!(await workoutNative.active().catch(() => null))) liveBle.releaseWorkout();
      throw error;
    }
  });
  command = (action: "pause" | "resume" | "finish") => this.action(async () => {
    const active = this.state.active;
    if (!active) return;
    if (action === "resume") await this.requireNotification();
    const session = parseRecordedWorkout(await workoutNative.command(active.id, action));
    await this.ingest(session);
    if (session.status === "completed") this.selectedId = session.id;
  });
  /**
   * Deletes a workout (Discard while it runs, Delete afterwards). A running one is finished first, so the native
   * journal is drained and acknowledged before the row goes and a later poll cannot bring it back.
   */
  discard = (id: string) => this.action(async () => {
    if (this.state.active?.id === id) await this.ingest(parseRecordedWorkout(await workoutNative.command(id, "finish")));
    // Also out of Health Connect (and so Google Health and the next import) when Pulse had saved it there.
    const hcId = (await appStore().workouts.get(id))?.hcId;
    if (hcId) { await deleteExercise(hcId); void syncNow().catch(() => {}); }
    await appStore().workouts.remove(id);
    if (this.selectedId === id) this.selectedId = null;
  });
  private async requireNotification() {
    if (await askNotificationPermission() !== "granted" || !await workoutNative.notificationsEnabled()) {
      throw new Error("notificationPermission");
    }
  }
  view = (id: string | null) => {
    if (this.state.active) return;
    this.selectedId = id;
    this.patch({ error: null });
    void this.refresh();
  };
  clearView = () => {
    this.selectedId = null;
    this.activeSamples.clear();
    this.patch({ active: null, viewed: null, samples: [], history: [], error: null, loading: false });
  };
  /** Resolves once a poll already under way ends; a reset waits on it so no ingest lands after the clear. */
  settle = (): Promise<void> => this.polling ?? Promise.resolve();
  more = () => { this.historyLimit += 25; void this.refresh(); };
}

/** Whether a history row is unchanged for the screens: same workout, revision, state and Health Connect id. */
const sameRow = (a: RecordedWorkout, b: RecordedWorkout | undefined) =>
  !!b && a.id === b.id && a.revision === b.revision && a.status === b.status && a.hcId === b.hcId && a.updatedAt === b.updatedAt;

export const workoutRecorder = new WorkoutRecorder();
