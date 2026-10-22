import { i18n } from "@/i18n/config";
// App-wide state: the Store, the profile, where data comes from (Health Connect, or the demo generator for "Explore
// with sample data"), the sync + scoring run, and the query context the screens read with. Follows halo's
// src/state/app.tsx (boot, status, run serialisation, the data version, the foreground re-sync, the demo source) in
// Pulse's wiring style: one module-level state read with useSyncExternalStore, no provider. The live heart-rate ticker
// and BLE hook into `run` (src/background/runSync.ts) and `dataChanged`. The background task and the alerts share `run`'s
// body (runSync); boot registers the Store for the task and starts the background (src/background/startup.ts).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { markUiRuntime, registerAppStore, runSync, type Source } from "@/background/runSync";
import { startBackground } from "@/background/startup";
import { deleteAllPhotos, deletePhoto } from "@/actions/photo";
import { openStore } from "@/data/db";
import { memoStore } from "@/data/memo";
import { seedDemo } from "@/data/seed";
import type { Store } from "@/data/store";
import type { Profile, SyncState } from "@/data/types";
import { askPermissions, availability, permissionState, type Availability, type PermissionState } from "@/health/connect";
import { initI18n, type LanguageChoice } from "@/i18n/config";
import { localeFor, readChoice, resolveChoice, saveChoice } from "@/i18n/language";
import { setLocale } from "@/lib/locale";
import { forgetChanges } from "@/health/sync";
import { localDay } from "@/lib/time";
import type { DisplayPrefs } from "@/lib/units";
import type { QueryCtx } from "@/queries/ctx";
import { ensureDefaultTags } from "@/queries/journal";
import { applyDisplay } from "./display";
import { checkForUpdate } from "./update";

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
  /** The last completed sync's hints (e.g. "no_fitbit_records"), so Settings can explain an empty Pulse. */
  warnings: string[];
  /** A profile, a source and a first completed run: the tabs open. Until then onboarding shows. */
  onboarded: boolean;
  /** The saved theme choice, read at boot so Settings › App opens without waiting on storage. */
  theme: "system" | "light" | "dark";
};

const SOURCE_KEY = "pulse.source";
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

let version = 0;
const versionListeners = new Set<() => void>();
export function dataChanged() {
  version++;
  for (const l of versionListeners) l();
}
const subscribeVersion = (l: () => void) => {
  versionListeners.add(l);
  return () => versionListeners.delete(l);
};
const inactiveSubscribe = () => () => {};
export const dataVersion = () => version;
export const useDataVersion = (active = true) => useSyncExternalStore(active ? subscribeVersion : inactiveSubscribe, dataVersion);

// ── Contexts ────────────────────────────────────────────────────────────────

/** The screens' reads, memoised per data version (src/data/memo.ts); made from the Store on first use. */
let readStore: Store | null = null;

/** The context the queries take. Throws `profile_missing` before onboarding (the root layout shows onboarding then). */
export function queryCtx(nowS = Math.floor(Date.now() / 1000)): QueryCtx {
  const { store, profile, sync } = state;
  if (!store || !profile) throw new Error("profile_missing");
  readStore ??= memoStore(store, dataVersion);
  return { store: readStore, profile, timeZone: profile.timeZone, today: localDay(nowS, profile.timeZone), now: nowS, sync };
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
export const isSyncing = () => running !== null;

/** Import (Health Connect) and score. Serialised: a second call joins the first. */
function run(): Promise<void> {
  if (running) return running;
  const { store, profile, source } = state;
  if (!store || !profile || !source) return Promise.resolve();
  const job = (async () => {
    patch({ status: "syncing", error: null });
    try {
      const r = await runSync(store, profile, source, {
        timeZone: profile.timeZone,
        owner: "app",
        waitIfLocked: true,
        onProgress: (step, done, total) => patch({ progress: { step, done, total } }),
      });
      if (r.warnings.length) console.log("[sync]", r.warnings.join("; "));
      if (!r.ran) console.log("[run] skipped:", r.skipped);
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
      dataChanged();
    }
  })();
  running = job;
  return job;
}

// ── Boot ────────────────────────────────────────────────────────────────────

let booted = false;
/** Opens the store, reads what's saved and decides the first screen; then refreshes in the background. Once. */
export async function boot(applyTheme: (theme: string) => void): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    await applyLanguage(await readChoice());
    const st = await openStore();
    // The background task reuses this connection when it fires while the app is up; the task registration and the
    // check-in reminder are made to match the saved settings.
    registerAppStore(st);
    void startBackground();
    // This runtime has a screen: its syncs slice their work so taps and frames get through (src/lib/yield.ts).
    markUiRuntime();
    const [profile, source, sync, avail, theme] = await Promise.all([
      st.getProfile(),
      AsyncStorage.getItem(SOURCE_KEY).catch(() => null) as Promise<Source | null>,
      st.getSyncState(),
      availability().catch((): Availability => "unavailable"),
      AsyncStorage.getItem(THEME_KEY).catch(() => null),
    ]);
    if (theme) applyTheme(theme);
    patch({ theme: theme === "light" || theme === "dark" ? theme : "system" });
    patch({ store: st, profile, source, sync, availability: avail });
    watchForeground();
    void checkForUpdate();
    if (!profile) return patch({ status: "needs_profile" });
    if (!source) return patch({ status: "needs_permissions" });
    if (source === "health_connect") {
      const perms = await permissionState().catch(() => null);
      if (!perms || perms.granted.length === 0) return patch({ status: "needs_permissions" });
    }
    // Show the last scores at once; refresh in the background.
    const onboarded = sync.lastSyncTs !== null || source === "demo";
    patch({ status: onboarded ? "ready" : "syncing", onboarded });
    void run();
  } catch (e) {
    patch({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
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
    if (away > RESYNC_AWAY_MS && state.onboarded) void run();
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
  if (source) void run();
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
  dataChanged();
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
  dataChanged();
}

/** Sets the language (Settings › App), kept on the device. No rescore: scores are numbers; every cached view model is rebuilt. */
export async function setLanguage(choice: LanguageChoice): Promise<void> {
  // The write starts first (storage runs reads and writes in order, so the Settings row, remounted by the switch, reads the
  // new choice) but is not waited for: the screens switch at once.
  const saved = saveChoice(choice);
  await applyLanguage(choice);
  dataChanged();
  await saved;
}

/** "Explore with sample data": halo's demo person, 180 days, no Health Connect needed. */
export async function exploreSample(): Promise<void> {
  const { store, profile, source } = state;
  if (!store) return;
  patch({ status: "syncing", error: null, progress: { step: i18n.t("errors:state.generatingSample"), done: 0, total: 1 } });
  try {
    // The demo data belongs to a demo person with their own profile; keep the person's own to restore later.
    if (profile && source !== "demo") await AsyncStorage.setItem(OWN_PROFILE_KEY, JSON.stringify(profile));
    await store.clearAll();
    await forgetChanges();
    const timeZone = profile?.timeZone ?? deviceTimeZone();
    const demo = await seedDemo(store, { today: localDay(Date.now() / 1000, timeZone), timeZone });
    await ensureDefaultTags(store);
    await AsyncStorage.setItem(SOURCE_KEY, "demo");
    patch({ profile: demo, source: "demo" });
  } catch (e) {
    patch({ status: "error", error: e instanceof Error ? e.message : String(e), progress: null });
    throw e;
  }
  await run();
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
  let profile = state.profile;
  if (state.source === "demo") {
    const own = await AsyncStorage.getItem(OWN_PROFILE_KEY).catch(() => null);
    await store.clearAll();
    await AsyncStorage.removeItem(OWN_PROFILE_KEY).catch(() => {});
    profile = own ? (JSON.parse(own) as Profile) : null;
    if (profile) {
      await store.setProfile(profile);
      await ensureDefaultTags(store);
    }
  }
  await AsyncStorage.setItem(SOURCE_KEY, "health_connect");
  patch({ profile, source: "health_connect", error: null, sync: await store.getSyncState(), onboarded: false, status: profile ? "syncing" : "needs_profile" });
  dataChanged();
  if (profile) await run();
  return perms;
}

/** Re-imports recent days and rescores (Sync now, pull to sync). Joins a run in flight. */
export const refresh = (): Promise<void> => run();

/** Re-reads the whole history window from Health Connect (for data an app shared late), then rescores. */
export async function reimport(): Promise<void> {
  if (state.source === "health_connect") await forgetChanges();
  await run();
}

/** Deletes every row and setting: the app starts again at onboarding. */
export async function reset(): Promise<void> {
  const { store } = state;
  if (running) await running.catch(() => {});
  if (store) await store.clearAll();
  deleteAllPhotos();
  await AsyncStorage.multiRemove([SOURCE_KEY, OWN_PROFILE_KEY]).catch(() => {});
  await forgetChanges();
  patch({ status: "needs_profile", profile: null, source: null, sync: EMPTY_SYNC, error: null, warnings: [], onboarded: false });
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
