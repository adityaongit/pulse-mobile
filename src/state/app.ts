import { clearWidgets, refreshWidgets } from "@/widgets/publish";
import { workoutNative, workoutNativeAvailable } from "../../modules/pulse-workouts";
import { i18n } from "@/i18n/config";
// App-wide state: the Store, the profile, where data comes from (Health Connect, or the demo generator for "Explore
// with sample data"), the sync + scoring run, and the query context the screens read with. Follows halo's
// src/state/app.tsx (boot, status, run serialisation, the data version, the foreground re-sync, the demo source) in
// Pulse's wiring style: one module-level state read with useSyncExternalStore, no provider. The live heart-rate ticker
// and BLE hook into `run` (src/background/runSync.ts) and `dataChanged`. The background task and the alerts share `run`'s
// body (runSync); boot registers the Store for the task and starts the background (src/background/startup.ts).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { InteractionManager, AppState } from "react-native";
import { markUiRuntime, registerAppStore, runSync, WAIT_FOR_TASK_MS, type Source } from "@/background/runSync";
import { syncOfficeGeofence } from "@/background/office";
import { validOffice, type Office } from "@/core/office";
import { releaseLock, takeLock, waitForLock } from "@/background/lock";
import { cancelRest } from "@/background/notify";
import { startBackground } from "@/background/startup";
import { resetCoachState } from "@/coach/reset";
import { deleteAllPhotos, deletePhoto } from "@/actions/photo";
import { DB_NAME, DEMO_DB, openStore } from "@/data/db";
import { memoStore } from "@/data/memo";
import { seedDemo } from "@/data/seed";
import type { Store } from "@/data/store";
import type { Profile, SyncState } from "@/data/types";
import { askPermissions, availability, permissionState, type Availability, type PermissionState } from "@/health/connect";
import { initI18n, type LanguageChoice } from "@/i18n/config";
import { localeFor, readChoice, resolveChoice, saveChoice } from "@/i18n/language";
import { setLocale } from "@/lib/locale";
import { seedDemoFood } from "@/data/seedFood";
import { forgetChanges } from "@/health/sync";
import { localDay } from "@/lib/time";
import { initLeetCode, leetcodeForeground, resetLeetCode } from "./leetcode";
import { report, resetTelemetryId } from "@/lib/telemetry";
import type { DisplayPrefs } from "@/lib/units";
import type { QueryCtx } from "@/queries/ctx";
import type { DayRow } from "@/queries/common";
import { clearScreenCache } from "@/screens/screenCache";
import { ensureDefaultTags } from "@/queries/journal";
import { applyDisplay } from "./display";
import { SOURCE_KEY } from "./source";
import { checkForUpdate } from "./update";
import { clearHabitWidgetConfigs } from "@/widgets/configKeys";

export type { Source };
export type Status = "booting" | "needs_profile" | "needs_permissions" | "syncing" | "ready" | "error";
export type Progress = { step: string; done: number; total: number };

export type AppInfo = {
  status: Status;
  source: Source | null;
  store: Store | null;
  profile: Profile | null;
  sync: SyncState;
  /** The running sync's step and count, or null. */
  progress: Progress | null;
  /** The last run's (or connect's) failure, or null. */
  error: string | null;
  availability: Availability | null;
  /** The last completed sync's hints (e.g. "skipped_records:<Type>"), so Settings can explain them. */
  warnings: string[];
  /** A profile, a source and a first completed run: the tabs open. Until then onboarding shows. */
  onboarded: boolean;
  /** The saved theme choice, read at boot so Settings › App opens without waiting on storage. */
  theme: "system" | "light" | "dark";
};

const OWN_PROFILE_KEY = "pulse.ownProfile";

export const THEME_KEY = "pulse.theme";
const EMPTY_SYNC: SyncState = { lastSyncTs: null, firstDay: null, lastError: null };
/** Coming back to the foreground after this long away re-imports (Health Connect gets new nights while the app sleeps). */
const RESYNC_AWAY_MS = 10 * 60_000;

let state: AppInfo = {
  status: "booting",
  source: null,
  store: null,
  profile: null,
  sync: EMPTY_SYNC,
  progress: null,
  error: null,
  availability: null,
  warnings: [],
  onboarded: false,
  theme: "system",
};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function patch(p: Partial<AppInfo>) {
  if ("profile" in p) applyDisplay(p.profile ?? null);
  state = { ...state, ...p };
  for (const l of listeners) l();
}

/** The app state, or the part `select` picks (return a field or a primitive, so a re-render happens only when it changes). */
export function useApp(): AppInfo;
export function useApp<T>(select: (s: AppInfo) => T): T;
export function useApp<T>(select?: (s: AppInfo) => T) {
  return useSyncExternalStore(subscribe, () => (select ? select(state) : state));
}
export const appState = () => state;

// ── The data version ────────────────────────────────────────────────────────
// Bumped after every scoring run and every write a screen reads (a check-in, a log entry, the dashboard): every
// mounted screen's query reloads (src/screens/useScreen.ts).

/**
 * What a write can change. Scores only move when the pipeline runs (or the profile/source does), so a log, a gym set or
 * a journal answer must not throw away the parsed score rows: it bumps the screen version, not the scores one.
 */
export type DataScope = "scores" | "logs" | "journal" | "gym" | "habits" | "display";

let version = 0;
let scoresVersion = 0;
/**
 * The version the read memo and the day rows follow: every write but the gym log's. The gym's tables are read only by
 * the gym queries, which are not memoised, so a ticked set must not throw away the health tables already in memory
 * (the next screen would read and parse every one of them again), and it has nothing to tell the widgets either.
 */
let healthVersion = 0;
const versionListeners = new Set<() => void>();
const scoresListeners = new Set<() => void>();
/** Bumps every screen's query. `scores` also bumps the score cache; the other scopes leave it alone. */
export function dataChanged(scope: DataScope = "scores") {
  version++;
  for (const l of versionListeners) l();
  if (scope === "gym") return;
  healthVersion++;
  if (scope !== "scores") {
    if (state.store && state.profile && state.source && state.onboarded) void refreshWidgets(queryCtx(), state.source);
    return;
  }
  scoresVersion++;
  for (const l of scoresListeners) l();
  if (state.store && state.profile && state.source && state.onboarded) void refreshWidgets(queryCtx(), state.source);
}
const subscribeVersion = (l: () => void) => {
  versionListeners.add(l);
  return () => versionListeners.delete(l);
};
const subscribeScores = (l: () => void) => {
  scoresListeners.add(l);
  return () => scoresListeners.delete(l);
};
const inactiveSubscribe = () => () => {};
export const dataVersion = () => version;
export const scoresDataVersion = () => scoresVersion;
export const useDataVersion = (active = true) => useSyncExternalStore(active ? subscribeVersion : inactiveSubscribe, dataVersion);
/** The versions that can change a score: the header's streak and the score cache follow this, not every log. */
export const useScoresVersion = (active = true) => useSyncExternalStore(active ? subscribeScores : inactiveSubscribe, scoresDataVersion);

// ── Contexts ────────────────────────────────────────────────────────────────

/** The screens' reads, memoised per data version (src/data/memo.ts); made from the Store on first use. */
let readStore: Store | null = null;
/** loadDays results for the current data version, so two queries on one screen build the rows once. */
let dayReads: { version: number; map: Map<string, Promise<Map<string, DayRow>>> } | null = null;

/** The context the queries take. Throws `profile_missing` before onboarding (the root layout shows onboarding then). */
export function queryCtx(nowS = Math.floor(Date.now() / 1000)): QueryCtx {
  const { store, profile, sync } = state;
  if (!store || !profile) throw new Error("profile_missing");
  readStore ??= memoStore(store, () => healthVersion, scoresDataVersion);
  const v = healthVersion;
  if (!dayReads || dayReads.version !== v) dayReads = { version: v, map: new Map() };
  return { store: readStore, profile, timeZone: profile.timeZone, today: localDay(nowS, profile.timeZone), now: nowS, sync, days: dayReads.map };
}

/** Switches the open Store (the person's ↔ the sample one) and drops every cache built from the old one. */
function swapStore(store: Store, profile: Profile | null, source: Source | null, sync: SyncState) {
  cancelScheduledRun();
  readStore = null;
  dayReads = null;
  registerAppStore(store);
  patch({ store, profile, source, sync });
  // Every keyed result belongs to the old database: drop it, then make the screens read the new one.
  clearScreenCache();
  dataChanged("scores");
  // LeetCode is independent of the health source; the sample database has its own copy of the snapshot.
  void initLeetCode(store, true);
}

/** Runs `fn` when the JS thread is idle; a phone that never idles still runs it before the timeout. */
function afterIdle(fn: () => void, timeout = 3000): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(fn, { timeout });
  else setTimeout(fn, 800);
}

let runTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Starts a launch or foreground run after the first screen has painted and its transition has ended. A run is 12 ms
 * slices of the JS thread; starting it while Home is mounting made the first scroll compete with it.
 */
function scheduleRun(delay = 900): void {
  if (runTimer) return;
  runTimer = setTimeout(() => {
    runTimer = null;
    InteractionManager.runAfterInteractions(() => void run());
  }, delay);
}
function cancelScheduledRun(): void {
  if (runTimer) clearTimeout(runTimer);
  runTimer = null;
}

/** Keeps a background run out while a store switch or a wipe rewrites the database. Throws if the task holds it too long. */
async function withRunLock<T>(fn: () => Promise<T>): Promise<T> {
  let lock = await takeLock("app");
  if (!lock.taken && (await waitForLock("app", WAIT_FOR_TASK_MS))) lock = await takeLock("app");
  if (!lock.taken) throw new Error("sync_busy");
  try {
    return await fn();
  } finally {
    await releaseLock("app");
  }
}

/** What the actions (src/actions) need: the Store, the profile and its zone. */
export type ActionCtx = { store: Store; profile: Profile; timeZone: string; nowS?: () => number };
export function actionCtx(): ActionCtx {
  const { store, profile } = state;
  if (!store || !profile) throw new Error("profile_missing");
  return { store, profile, timeZone: profile.timeZone };
}

/** The open Store; throws before boot has opened it. */
export function appStore(): Store {
  if (!state.store) throw new Error("store_not_open");
  return state.store;
}

// ── The run ─────────────────────────────────────────────────────────────────

let running: Promise<void> | null = null;
/** Whether the run under way skips the import (a rescore after a finished workout). */
let runningScoreOnly = false;
export const isSyncing = () => running !== null;

/**
 * Import (Health Connect) and score. Serialised: a second call joins the first. `force` scores even when the import
 * found nothing new (a profile edit, Sync now, a source switch); `scoreOnly` skips the Health Connect read (a finished
 * workout is already stored). A full run asked for during a score-only one follows it, so its import is not skipped.
 */
function run(force = false, scoreOnly = false): Promise<void> {
  if (running && runningScoreOnly && !scoreOnly) return running.catch(() => {}).then(() => run(force, false));
  if (running) return force ? running.then(() => run(true, scoreOnly)) : running;
  const { store, profile, source } = state;
  if (!store || !profile || !source) return Promise.resolve();
  const job = (async () => {
    patch({ status: "syncing", error: null });
    let changed = true;
    try {
      const r = await runSync(store, profile, source, {
        timeZone: profile.timeZone,
        owner: "app",
        waitIfLocked: true,
        force,
        scoreOnly,
        onProgress: (step, done, total) => patch({ progress: { step, done, total } }),
      });
      if (r.warnings.length) console.log("[sync]", r.warnings.join("; "));
      if (!r.ran) console.log("[run] skipped:", r.skipped);
      changed = r.scored === true;
      const sync = await store.getSyncState();
      patch({ status: "ready", progress: null, sync, warnings: r.ran && !r.unchanged ? r.warnings : state.warnings, onboarded: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[run]", message);
      const sync = await store.getSyncState().catch(() => EMPTY_SYNC);
      // Scores from the last good run are still on disk, so stay usable and show the error.
      const usable = state.onboarded || sync.lastSyncTs !== null;
      patch({ status: usable ? "ready" : "error", error: message, progress: null, sync, onboarded: usable });
    } finally {
      running = null;
      runningScoreOnly = false;
      // An unchanged import that skipped scoring changed nothing: no screen has to reload.
      if (changed) dataChanged("scores");
    }
  })();
  running = job;
  runningScoreOnly = scoreOnly;
  return job;
}

// ── Boot ────────────────────────────────────────────────────────────────────

let booted = false;
/** Opens the store, reads what's saved and decides the first screen; then refreshes in the background. Once. */
export async function boot(applyTheme: (theme: string) => void): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    // The source decides which database to open: the person's own or the sample one. It is read with the language,
    // before the store, so the demo never opens over the real rows (src/data/db.ts DEMO_DB).
    const [choice, source] = await Promise.all([
      readChoice(),
      AsyncStorage.getItem(SOURCE_KEY).catch(() => null) as Promise<Source | null>,
    ]);
    await applyLanguage(choice);
    let st = await openStore(source === "demo" ? DEMO_DB : DB_NAME);
    let profile = await st.getProfile();
    if (source === "demo" && !profile) {
      // A build before DEMO_DB kept the sample rows in the person's database. Open that one until the next Explore or
      // Connect, so an update does not send a sample-data session to onboarding.
      const legacy = await openStore(DB_NAME);
      const legacyProfile = await legacy.getProfile();
      if (legacyProfile) {
        st = legacy;
        profile = legacyProfile;
      }
    }
    // Finish a requested full reset before importing any surviving native journal.
    if (workoutNativeAvailable && (await workoutNative.resetPending())) {
      await st.workouts.clear();
      await workoutNative.finishReset();
    }
    // The background task reuses this connection when it fires while the app is up; the task registration and the
    // check-in reminder are made to match the saved settings.
    registerAppStore(st);
    // This runtime has a screen: its syncs slice their work so taps and frames get through (src/lib/yield.ts).
    markUiRuntime();
    const [sync, avail, theme] = await Promise.all([
      st.getSyncState(),
      availability().catch((): Availability => "unavailable"),
      AsyncStorage.getItem(THEME_KEY).catch(() => null),
    ]);
    if (theme) applyTheme(theme);
    patch({ theme: theme === "light" || theme === "dark" ? theme : "system" });
    patch({ store: st, profile, source, sync, availability: avail });
    watchForeground();
    afterIdle(() => {
      void startBackground();
      // The fence is re-registered from the saved profile (Play Services keeps it across reboots; this also picks up a
      // place saved on another install of the same database).
      void syncOfficeGeofence();
      // A source switch inside the idle window has already loaded the other store's snapshot.
      if (state.store === st) void initLeetCode(st);
      void checkForUpdate();
    });
    if (!profile) { await clearWidgets(); return patch({ status: "needs_profile" }); }
    if (!source) { await clearWidgets(); return patch({ status: "needs_permissions" }); }
    if (source === "health_connect") {
      const perms = await permissionState().catch(() => null);
      if (!perms || perms.granted.length === 0) {
        // Connected before, and now Health Connect grants nothing: revoked in its settings, or its data was cleared.
        void report("sync.permission_lost", { read: perms ? "none" : "failed" });
        await clearWidgets();
        return patch({ status: "needs_permissions" });
      }
    }
    // Show the last scores at once; refresh once the first screen is up and the opening is over.
    const onboarded = sync.lastSyncTs !== null || source === "demo";
    patch({ status: onboarded ? "ready" : "syncing", onboarded });
    scheduleRun(1200);
  } catch (e) {
    patch({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

/** A boot that failed before the store opened (a lock from a background sync, typically) can be tried again in place. */
export async function retryBoot(applyTheme: (theme: string) => void): Promise<void> {
  if (state.store) return;
  booted = false;
  patch({ status: "booting", error: null });
  await boot(applyTheme);
}

function watchForeground() {
  let backgroundAt: number | null = null;
  AppState.addEventListener("change", (next) => {
    if (next !== "active") {
      backgroundAt ??= Date.now();
      return;
    }
    const away = backgroundAt === null ? 0 : Date.now() - backgroundAt;
    backgroundAt = null;
    if (away > RESYNC_AWAY_MS && state.onboarded) scheduleRun(800);
    // LeetCode is throttled separately (10 minutes): a connected profile catches up when the app comes back.
    leetcodeForeground();
    // Android lets the person change Pulse's language in the system settings while it runs: "Phone's language" follows it.
    void followPhoneLanguage();
    // At most once a day (src/state/update.ts): a phone left open for days still hears of a release.
    void checkForUpdate();
  });
}

// ── Actions ─────────────────────────────────────────────────────────────────

/** Saves the profile; the first one also creates the Journal's default behaviours. With a source, the scores rerun. */
export async function saveProfile(p: Profile): Promise<void> {
  const { store, source, profile } = state;
  if (!store) return;
  await store.setProfile(p);
  if (!profile) await ensureDefaultTags(store);
  patch({ profile: p, status: source ? "syncing" : "needs_permissions" });
  dataChanged();
  if (source) void run(true);
}

/** Sets or removes the profile photo (src/actions/photo.ts). No rescore: the photo is only shown. The old file goes. */
export async function setPhoto(photo: string | null): Promise<void> {
  const { store, profile } = state;
  if (!store || !profile) return;
  const p = { ...profile, photo };
  await store.setProfile(p);
  patch({ profile: p });
  if (profile.photo && profile.photo !== photo) deletePhoto(profile.photo);
}

/** Remembers the theme the person picked, for the Settings row to open on after a remount. */
export const rememberTheme = (theme: AppInfo["theme"]) => patch({ theme });

/** Sets the units and the clock (Settings › App). No rescore: the scores are stored in metric; every screen redraws. */
export async function setDisplay(display: DisplayPrefs): Promise<void> {
  const { store, profile } = state;
  if (!store || !profile) return;
  const p = { ...profile, display };
  await store.setProfile(p);
  patch({ profile: p });
  dataChanged("display");
}

/**
 * Saves or removes the office (Settings › Places) and makes the geofence match. No rescore: it is not a health input.
 * False when the place is not a coordinate pair.
 */
export async function setOffice(office: Office | null): Promise<boolean> {
  const { store, profile } = state;
  if (!store || !profile) return false;
  if (office && !validOffice(office)) return false;
  const p = { ...profile, office };
  await store.setProfile(p);
  patch({ profile: p });
  dataChanged("logs");
  await syncOfficeGeofence();
  return true;
}

/** Starts i18next and the formatters' locale in what `choice` means (the phone's language for "auto"). */
async function applyLanguage(choice: LanguageChoice): Promise<void> {
  const language = resolveChoice(choice);
  initI18n(language);
  setLocale(localeFor(language));
}

/** On coming back to the app: when the choice is "Phone's language", apply the phone's (per-app) language if it changed. */
async function followPhoneLanguage(): Promise<void> {
  if ((await readChoice()) !== "auto") return;
  const language = resolveChoice("auto");
  if (language === i18n.language) return;
  await applyLanguage("auto");
  dataChanged("display");
}

/** Sets the language (Settings › App), kept on the device. No rescore: scores are numbers; every cached view model is rebuilt. */
export async function setLanguage(choice: LanguageChoice): Promise<void> {
  // The write starts first (storage runs reads and writes in order, so the Settings row, remounted by the switch, reads the
  // new choice) but is not waited for: the screens switch at once.
  const saved = saveChoice(choice);
  await applyLanguage(choice);
  dataChanged("display");
  await saved;
}

/**
 * "Explore with sample data": halo's demo person, 180 days, in the sample database (DEMO_DB). The person's own
 * database is never opened or cleared, so their journal, logs, gym and profile are exactly as they left them when they
 * switch back.
 */
export async function exploreSample(): Promise<void> {
  const { store, profile } = state;
  if (!store) return;
  patch({ status: "syncing", error: null, progress: { step: i18n.t("errors:state.generatingSample"), done: 0, total: 1 } });
  let demoStore: Store | null = null;
  try {
    if (running) await running.catch(() => {});
    demoStore = await openStore(DEMO_DB);
    await clearWidgets();
    const timeZone = profile?.timeZone ?? deviceTimeZone();
    const today = localDay(Date.now() / 1000, timeZone);
    const demo = await withRunLock(async () => {
      await demoStore!.clearAll();
      await demoStore!.clearGym();
      await demoStore!.clearHabits();
      await demoStore!.clearFoodOrders();
      await demoStore!.clearOffice();
      const seeded = await seedDemo(demoStore!, { today, timeZone });
      await seedDemoFood(demoStore!, { today, timeZone, now: Math.floor(Date.now() / 1000) });
      await ensureDefaultTags(demoStore!);
      return seeded;
    });
    await AsyncStorage.setItem(SOURCE_KEY, "demo");
    swapStore(demoStore, demo, "demo", await demoStore.getSyncState());
  } catch (e) {
    patch({ status: "error", error: e instanceof Error ? e.message : String(e), progress: null });
    throw e;
  }
  await run(true);
}

/**
 * Shows the Health Connect permission sheet, then imports and scores. False when nothing was granted (the sample data,
 * if any, stays). Leaving the sample data: the demo rows go and the person's own profile comes back; with none saved
 * (they explored first) onboarding asks for it, and the import starts once it is saved.
 */
export async function connectHealth(): Promise<PermissionState | null> {
  const { store } = state;
  if (!store) return null;
  const perms = await askPermissions();
  if (perms.granted.length === 0) {
    patch({ error: i18n.t("errors:state.permissionsDenied") });
    return perms;
  }
  // A run may still be importing or scoring the current store; the switch must not clear a database under it.
  if (running) await running.catch(() => {});
  let profile = state.profile;
  let next = store;
  if (state.source === "demo") {
    // Leave the sample database: the person's own is untouched, so its profile (and journal, logs and gym) is what
    // comes back. OWN_PROFILE_KEY is the one-release fallback for a build before DEMO_DB, where the sample rows lived in
    // this database; when it names a different person, the sample rows are cleared before the profile is restored.
    next = await openStore(DB_NAME);
    const current = await next.getProfile();
    profile = current;
    const saved = await AsyncStorage.getItem(OWN_PROFILE_KEY).catch(() => null);
    if (saved) {
      let own: Profile | null = null;
      try {
        own = JSON.parse(saved) as Profile;
      } catch {
        own = null;
      }
      if (own) {
        if (!current || current.birthDate !== own.birthDate) {
          await withRunLock(async () => {
            await next.clearAll();
            await next.setProfile(own!);
            await ensureDefaultTags(next);
          });
        }
        profile = own;
      }
    }
    await clearWidgets();
    await AsyncStorage.removeItem(OWN_PROFILE_KEY).catch(() => {});
  }
  await AsyncStorage.setItem(SOURCE_KEY, "health_connect");
  if (next !== store) swapStore(next, profile, "health_connect", await next.getSyncState());
  else patch({ profile, source: "health_connect", error: null, sync: await store.getSyncState() });
  patch({ status: profile ? "syncing" : "needs_profile", onboarded: false });
  dataChanged();
  if (profile) await run(true);
  return perms;
}

/** Re-imports recent days and rescores (Sync now, pull to sync). Joins a run in flight. */
export const refresh = (): Promise<void> => run(true);
/** Rescores what the store holds without reading Health Connect (the dirty days only), then publishes it. */
export const rescore = (): Promise<void> => run(false, true);

/** Re-reads the whole history window from Health Connect (for data an app shared late), then rescores. */
export async function reimport(): Promise<void> {
  if (state.source === "health_connect") await forgetChanges();
  await run(true);
}

/**
 * The preferences "Delete everything" clears. They are literals because each owner module keeps its own key; the
 * SecureStore coach key and LeetCode's username go through their own helpers below. A key that is not there is a no-op.
 */
const PREFERENCES = [
  SOURCE_KEY, OWN_PROFILE_KEY, THEME_KEY,
  "pulse.background.settings", "pulse.background.log", "pulse.background.lock",
  "pulse.ble.autoConnect", "pulse.ble.device", "pulse.ble.stopped",
  "pulse.breathe.haptics", "pulse.breathe.log",
  "pulse.coach.setup",
  "pulse.dashboard", "pulse.goals",
  "pulse.home.insights.dismissed", "pulse.journal.yesterdayOffered",
  "pulse.language",
  "pulse.lefu.athlete", "pulse.lefu.device",
  "pulse.notifications.markers", "pulse.notify.recovery", "pulse.notify.syncProblem",
  "pulse.nutrition.targets", "pulse.opening.seen",
  "pulse.update", "pulse.update.check", "pulse.update.auto",
  "pulse.weeklyPlan",
  "pulse.workout.haptics", "pulse.workout.log",
];

/** Deletes every row and setting, from both databases: the app starts again at onboarding. */
export async function reset(): Promise<void> {
  if (running) await running.catch(() => {});
  // Wipe the person's database and the sample one, so a later "Explore with sample data" starts clean too.
  const real = await openStore(DB_NAME);
  const demo = await openStore(DEMO_DB);
  await withRunLock(async () => {
    for (const store of [real, demo]) {
      await store.clearAll();
      await store.clearGym();
      await store.clearHabits();
      await store.clearFoodOrders();
      await store.clearOffice();
      // clearAll keeps the coach's chats (they are not health rows); "Delete everything" must not.
      await resetCoachState(store);
    }
  });
  // A rest countdown belongs to the gym that was just deleted; it must not fire into a missing session.
  await cancelRest();
  await resetLeetCode();
  await clearHabitWidgetConfigs();
  // The native workout journal lives outside the two databases; stop its poll and clear its rows in the same reset.
  const { workoutRecorder } = await import("@/live/workoutRecorder");
  if (workoutNativeAvailable) await workoutNative.beginReset();
  await workoutRecorder.settle();
  for (const store of [real, demo]) await store.workouts.clear();
  if (workoutNativeAvailable) await workoutNative.finishReset();
  workoutRecorder.clearView();
  await clearWidgets();
  deleteAllPhotos();
  await AsyncStorage.multiRemove(PREFERENCES).catch(() => {});
  await forgetChanges();
  swapStore(real, null, null, EMPTY_SYNC);
  await resetTelemetryId();
  patch({ status: "needs_profile", profile: null, source: null, sync: EMPTY_SYNC, error: null, warnings: [], onboarded: false, theme: "system" });
  dataChanged();
}

export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const STEP_LABEL = {
  write: "errors:state.stepWrite",
  done: "errors:state.stepDone",
  stage1: "errors:state.stepStage1",
  stage2: "errors:state.stepStage2",
  journal: "errors:state.stepJournal",
} as const;

/** A sync or scoring step ("read:HeartRate", "stage2"…) as a short line (halo's progressLabel, without the count). */
export const stepLabel = (step: string): string => {
  if (step.startsWith("read:day:")) return i18n.t("errors:state.readingDay");
  if (step.startsWith("read:")) {
    const type = step.slice(5);
    const what = i18n.exists(`errors:readType.${type}`) ? i18n.t(`errors:readType.${type as "Steps"}`) : type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return i18n.t("errors:state.reading", { what });
  }
  return Object.hasOwn(STEP_LABEL, step) ? i18n.t(STEP_LABEL[step as keyof typeof STEP_LABEL]) : step;
};
