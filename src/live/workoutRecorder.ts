import { AppState } from "react-native";
import { i18n } from "@/i18n/config";
import { appStore, isSyncing, refresh as syncNow, rescore } from "@/state/app";
import { mapExercises, MIN_EXERCISE_SEC } from "@/health/import";
import { localDay } from "@/lib/time";
import { deleteExercise, exerciseWriteAllowed, readAll, saveExercise } from "@/health/connect";
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
  /** Workouts being discarded: never saved to Health Connect, even when the discard finishes a running one first. */
  private discarding = new Set<string>();
  /** Workouts being saved to Health Connect, so a retry never runs beside the first attempt. */
  private exporting = new Set<string>();
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private patch(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }

  mount = (): (() => void) => {
    void this.refresh().then(() => this.retryExports());
    this.timer = setInterval(() => { if (AppState.currentState === "active" && (this.state.active || this.state.loading || this.state.error === "storage")) void this.refresh(); }, 1000);
    const subscription = AppState.addEventListener("change", (status) => { if (status === "active") void this.refresh().then(() => this.retryExports()); });
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
      // Not awaited: the save, the read-back and the rescore can wait on a running sync, and Finish must not.
      void this.export(session.id);
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
    // A run already under way may have read the dirty days before this one: joined, it would leave the day unscored.
    const joined = isSyncing();
    await rescore();
    if (joined) await rescore();
  }
  /**
   * Saves a finished workout's session to Health Connect (where Google Health reads it), keeps its id, and imports it
   * back so it shows as an activity like any other. Without the write permission, or when the save fails, the workout
   * stays on the phone and retryExports tries again when the app comes back. Never for one being discarded, and never
   * under MIN_EXERCISE_SEC (wall clock, as the import counts): the import would drop it, leaving a session in Google
   * Health that Pulse never shows.
   */
  private async export(id: string): Promise<void> {
    if (this.discarding.has(id) || this.exporting.has(id)) return;
    this.exporting.add(id);
    try {
      const store = appStore().workouts;
      const session = await store.get(id);
      if (!session || session.status !== "completed" || session.hcId || session.endedAt === null) return;
      if (session.endedAt - session.startedAt < MIN_EXERCISE_SEC * 1000) return;
      const hcId = await saveExercise({
        clientRecordId: session.id,
        start: session.startedAt,
        end: session.endedAt,
        exerciseType: HC_EXERCISE[session.type],
        title: i18n.t(`workouts:recorder.types.${session.type}`),
      });
      if (!hcId) return;
      // Discarded while it was being saved: take it back out.
      if (this.discarding.has(id) || !(await store.get(id))) { await deleteExercise(hcId).catch(() => {}); return; }
      await store.ingest({ ...session, hcId }, [], await store.cursor(session.id));
      // Discarded between the check above and that write (which upserts the row back): undo both.
      if (this.discarding.has(id)) { await deleteExercise(hcId).catch(() => {}); await store.remove(id); return; }
      // The activity page waits on this: store the session as the import would and score its day only (about a
      // second), instead of a whole sync (every type, then scoring). The full sync follows for the band's heart rate.
      await this.storeImported(hcId, session).catch(() => {});
      void syncNow().catch(() => {});
    } catch (error) {
      void reportError("workout.export_failed", error);
    } finally {
      this.exporting.delete(id);
    }
  }
  /**
   * Saves the finished workouts that stayed on the phone (no permission then, or a failed save) once Pulse may write.
   * Only ones recorded with this flow (they carry their strain setup) and long enough for the import: older recordings
   * were never meant for Health Connect.
   */
  private async retryExports(): Promise<void> {
    try {
      const stuck = (await appStore().workouts.list(25)).filter((w) => w.status === "completed" && !w.hcId && w.strainSetup && w.endedAt !== null && w.endedAt - w.startedAt >= MIN_EXERCISE_SEC * 1000);
      if (!stuck.length || !(await exerciseWriteAllowed(false))) return;
      for (const w of stuck) await this.export(w.id);
    } catch {
      // The Store not open yet, or Health Connect unavailable: the next foreground tries again.
    }
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
  /** Runs one command at a time; resolves true when it ran to the end, false when it failed or another was running. */
  private async action(run: () => Promise<void>): Promise<boolean> {
    if (this.state.busy) return false;
    this.patch({ busy: true, error: null });
    try { if (this.polling) await this.polling; await run(); return true; }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      const known = ["nativeUnavailable", "activeWorkout", "bluetoothPermission", "bluetoothOff", "invalidSession", "notificationPermission", "healthPermission", "healthUnavailable"];
      const code = known.find((c) => message.includes(c)) ?? "commandFailed";
      // The person's own states (Bluetooth off, a permission refused) are not failures worth a report.
      if (code === "commandFailed" || code === "invalidSession" || code === "nativeUnavailable") void report("workout.command_failed", { code, kind: errorKind(error) });
      this.patch({ error: code });
      return false;
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
   * journal is drained and acknowledged before the row goes and a later poll cannot bring it back; it is never saved to
   * Health Connect on the way. One Pulse saved there is deleted there first (and from the imported activities), and when
   * that fails (no permission, Health Connect unavailable) the workout stays, so Delete can be tried again.
   */
  discard = (id: string) => this.action(async () => {
    this.discarding.add(id);
    try {
      if (this.state.active?.id === id) await this.ingest(parseRecordedWorkout(await workoutNative.command(id, "finish")));
      const app = appStore();
      const session = await app.workouts.get(id);
      if (session?.hcId) {
        await deleteExercise(session.hcId);
        await app.deleteExercises([session.hcId]);
        await app.markIntradayDirty([localDay(session.startedAt / 1000, session.timeZone)]);
        // As after a save: a run already under way may have read the dirty days before this one.
        const joined = isSyncing();
        void rescore().then(() => (joined ? rescore() : undefined)).catch(() => {});
      }
      await app.workouts.remove(id);
      if (this.selectedId === id) this.selectedId = null;
    } finally {
      this.discarding.delete(id);
    }
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
