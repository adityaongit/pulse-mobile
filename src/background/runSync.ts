// The sync + scoring run as one function with no React in it, so the app (src/state/app.ts) and the background task
// (task.ts) do the same thing: take the run lock (lock.ts), import from Health Connect, score, then send the alerts
// that are due (alerts.ts). Within one JavaScript runtime a second call joins the first; across runtimes the lock keeps
// the two apart. Copied from halo's src/background/runSync.ts without the Google source.
import { widgetEpoch } from "../../modules/pulse-widgets";
import { refreshWidgets } from "@/widgets/publish";
import { appendLog } from "./log";
import { AppState } from "react-native";
import { openStore } from "@/data/db";
import type { Store } from "@/data/store";
import type { Profile } from "@/data/types";
import { syncHealthConnect } from "@/health/sync";
import { timed } from "@/lib/perf";
import { errorKind, log, report, reportError, traced } from "@/lib/telemetry";
import { skippedTypes } from "@/health/connect";
import { runDataGapChecks } from "@/health/dataGaps";
import { localDay } from "@/lib/time";
import { setForeground } from "@/lib/yield";
import { runPipeline } from "@/pipeline";
import { notifyAfterRun } from "./alerts";
import { maintainStorage } from "./maintenance";
import { releaseLock, takeLock, waitForLock, type RunOwner } from "./lock";

export type Source = "health_connect" | "demo";

export type RunSyncOptions = {
  timeZone: string;
  owner: RunOwner;
  onProgress?: (step: string, done: number, total: number) => void;
  /** Wait for the other owner's run to end instead of skipping (the app does; a background task's window is short). */
  waitIfLocked?: boolean;
  /** Score only, skipping the Health Connect read: a write the app made itself (a finished workout) is already stored. */
  scoreOnly?: boolean;
};

export type RunSyncResult = {
  ran: boolean;
  /** Why it did not run. */
  skipped?: string;
  /** Sync hints (permission_missing:<Type>, …), never errors. */
  warnings: string[];
  /** Health Connect had nothing new, so nothing was read (scoring still ran): the last read's warnings stand. */
  unchanged?: true;
};

/** How long the app waits for a background run before giving up and using what is on disk. */
export const WAIT_FOR_TASK_MS = 10 * 60_000;

let inflight: Promise<RunSyncResult> | null = null;
/** True while a run is in flight in this runtime. */
export const isRunning = () => inflight !== null;

let watching = false;
/** The app's UI is up (src/state/app.ts called markUiRuntime): this runtime has a screen, it is not a headless task. */
let ui = false;
/**
 * Marks this runtime as the app's. Right after launch AppState is still "unknown", which counts as background, so the
 * launch sync, the one that matters most, would run unsliced. With a UI, an unknown state is the foreground.
 */
export function markUiRuntime() {
  ui = true;
  if (watching && AppState.currentState !== "background" && AppState.currentState !== "inactive") setForeground(true);
}
const onScreen = (s: string) => s === "active" || (ui && s !== "background" && s !== "inactive");
/**
 * The sync and the pipeline slice their long loops while the app is on screen (src/lib/yield.ts) and run straight
 * through otherwise: Android stops JS timers in the background and a headless task never starts them, so a yield there
 * would never return.
 */
function watchForeground() {
  if (watching) return;
  watching = true;
  setForeground(onScreen(AppState.currentState));
  AppState.addEventListener("change", (next) => setForeground(onScreen(next)));
}

/** Serialised: a second call while one runs returns the same promise. Throws what the sync or pipeline threw. */
export function runSync(store: Store, profile: Profile, source: Source, opts: RunSyncOptions): Promise<RunSyncResult> {
  watchForeground();
  if (inflight) return inflight;
  const job = run(store, profile, source, opts).finally(() => {
    inflight = null;
  });
  inflight = job;
  return job;
}

/** One run as a `sync` span (its steps are child spans through timed()), with a log line at each end. */
async function run(store: Store, profile: Profile, source: Source, opts: RunSyncOptions): Promise<RunSyncResult> {
  const t0 = Date.now();
  void log("info", "sync.start", { owner: opts.owner, source });
  return traced("sync", { owner: opts.owner, source }, () => runSteps(store, profile, source, opts)).then(
    (r) => {
      void log("info", r.ran ? "sync.done" : "sync.skipped", { owner: opts.owner, ms: Date.now() - t0, warnings: r.warnings.length, unchanged: !!r.unchanged });
      return r;
    },
    (e: unknown) => {
      void log("error", "sync.error", { owner: opts.owner, ms: Date.now() - t0, kind: errorKind(e) });
      throw e;
    },
  );
}

async function runSteps(store: Store, profile: Profile, source: Source, opts: RunSyncOptions): Promise<RunSyncResult> {
  let lock = await takeLock(opts.owner);
  if (!lock.taken && opts.waitIfLocked && (await waitForLock(opts.owner, WAIT_FOR_TASK_MS))) lock = await takeLock(opts.owner);
  if (!lock.taken) return { ran: false, skipped: `${lock.holder === "app" ? "the app" : "the background task"} is syncing`, warnings: [] };
  const warnings: string[] = [];
  let unchanged = false;
  try {
    // A reset in another runtime must invalidate this run even if the person reconnects to the same source.
    const epoch = await Promise.resolve().then(widgetEpoch).catch(() => null);
    if (source === "health_connect" && !opts.scoreOnly) {
      const t0 = Date.now();
      const r = await timed(`sync-health-connect (${opts.owner})`, () => syncHealthConnect(store, { timeZone: opts.timeZone, onProgress: opts.onProgress })).catch((e: unknown) => {
        void reportError("sync.failed", e, { owner: opts.owner });
        throw e;
      });
      warnings.push(...(r.warnings ?? []));
      for (const type of skippedTypes(r.warnings ?? [])) void report("sync.type_skipped", { type });
      unchanged = !!r.unchanged;
      // What the read covered, as counts only: how many types were read and how many records in all.
      const reads = Object.entries(r.counts).filter(([k, v]) => k.startsWith("read:") && typeof v === "number");
      void log("info", "sync.read", { owner: opts.owner, types: reads.length, records: reads.reduce((a, [, v]) => a + (v as number), 0), full: "full" in r.counts, ms: Date.now() - t0 });
      // The app's syncs are logged like the background task's, with what the sync did (whole window or not, and why).
      if (opts.owner === "app") {
        const flags = Object.keys(r.counts).filter((k) => ["full", "reimport", "backfillFrom", "deleted", "unchanged"].includes(k) || k.startsWith("why:"));
        await appendLog({ at: t0, result: "ok", ms: Date.now() - t0, note: `app sync: ${flags.length ? flags.join(", ") : "recent days"}` });
      }
    }
    await timed(`pipeline (${opts.owner})`, () => runPipeline(store, profile, { today: localDay(Date.now() / 1000, opts.timeZone), onProgress: opts.onProgress })).catch((e: unknown) => {
      void reportError("pipeline.failed", e, { owner: opts.owner });
      throw e;
    });
    // After scoring, so the day that just aged out was scored from its raw samples. A failure here costs space, not
    // data: the sync itself has succeeded, and the next run tries again.
    await timed(`maintenance (${opts.owner})`, () => maintainStorage(store, Date.now() / 1000)).catch((e) => {
      console.warn("[maintenance]", e instanceof Error ? e.message : String(e));
      void reportError("maintenance.failed", e);
    });
    // At most once a day, without holding up the run: what Health Connect has that Pulse did not store, and scores
    // stuck on one reason (src/health/dataGaps.ts). Only codes and counts are sent.
    if (source === "health_connect") void runDataGapChecks(store, opts.timeZone);
    const now = Math.floor(Date.now() / 1000);
    // The app's own runs publish through dataChanged(); only a background run publishes here.
    if (epoch !== null && opts.owner !== "app") await store.getSyncState().then((sync) => refreshWidgets({ store, profile, timeZone: opts.timeZone, today: localDay(now, opts.timeZone), now, sync }, source, { epoch })).catch(() => {});
    return { ran: true, warnings, ...(unchanged && { unchanged: true as const }) };
  } finally {
    await releaseLock(opts.owner);
    await notifyAfterRun(store, opts.timeZone);
  }
}

// ── The Store for a run outside the app ───────────────────────────────────

let appStore: Store | null = null;
/** The app registers its open Store so a task that fires in the same runtime reuses the connection. */
export function registerAppStore(store: Store | null): void {
  appStore = store;
}

let ownStore: Promise<Store> | null = null;
/** The app's Store when it is up in this runtime, else one opened once for the task (a headless launch has no app). */
export function backgroundStore(): Promise<Store> {
  if (appStore) return Promise.resolve(appStore);
  ownStore ??= openStore();
  return ownStore;
}
