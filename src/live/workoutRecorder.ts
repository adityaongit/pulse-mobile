import { AppState } from "react-native";
import { i18n } from "@/i18n/config";
import { appStore } from "@/state/app";
import { liveBle } from "@/health/ble";
import { askNotificationPermission } from "@/background/notify";
import { workoutNative, workoutNativeAvailable } from "../../modules/pulse-workouts";
import { parseRecordedWorkout, parseWorkoutSample, type RecordedWorkout, type WorkoutSample, type WorkoutType } from "./workout";

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
  private async ingest(session: RecordedWorkout): Promise<void> {
    const store = appStore().workouts;
    let offset = await store.cursor(session.id);
    for (;;) {
      const page = JSON.parse(await workoutNative.samples(session.id, offset)) as Page;
      if (!Number.isSafeInteger(page.offset) || page.offset < offset || !Array.isArray(page.samples)) throw new Error("invalidCursor");
      const samples = page.samples.map(parseWorkoutSample);
      await store.ingest(session, samples, page.offset);
      if (session.id === this.owner) for (const point of samples) this.activeSamples.set(point.seq, point);
      if (!page.more || page.offset === offset) break;
      offset = page.offset;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (session.status === "completed") await workoutNative.acknowledge(session.id, session.revision);
  }
  refresh = (): Promise<void> => {
    if (this.polling) return this.polling;
    if (this.state.busy) return Promise.resolve();
    const task = this.poll().catch((error: unknown) => {
      // Boot may not yet have opened the Store. Subsequent polls retry; write failures are always visible.
      if (!(error instanceof Error && error.message === "store_not_open")) this.patch({ error: "storage", loading: false });
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
    this.patch({ active, viewed, samples, history: await store.list(this.historyLimit), loading: false, error: this.state.error === "storage" ? null : this.state.error });
  }
  private async action(run: () => Promise<void>) {
    if (this.state.busy) return;
    this.patch({ busy: true, error: null });
    try { if (this.polling) await this.polling; await run(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      const known = ["nativeUnavailable", "activeWorkout", "bluetoothPermission", "bluetoothOff", "invalidSession", "notificationPermission"];
      this.patch({ error: known.find((code) => message.includes(code)) ?? "commandFailed" });
    } finally { this.patch({ busy: false }); await this.refresh(); }
  }
  start = (type: WorkoutType, calibration: WorkoutCalibration) => this.action(async () => {
    if (!workoutNativeAvailable) throw new Error("nativeUnavailable");
    await this.requireNotification();
    const band = liveBle.getSnapshot();
    const device = band.device ?? band.remembered;
    if (!device) throw new Error("bluetoothPermission");
    await liveBle.suspendForWorkout();
    try {
      const labels = Object.fromEntries((["title", "recording", "waiting", "paused", "pause", "resume", "finish"] as const).map((key) => [key, i18n.t(`workouts:recorder.${key}`)]));
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
  more = () => { this.historyLimit += 25; void this.refresh(); };
}

export const workoutRecorder = new WorkoutRecorder();
