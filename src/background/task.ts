// The background task: expo-background-task on expo-task-manager (WorkManager on Android, 15 min at best). Defined
// at module scope, as TaskManager requires: index.ts imports this file, so a headless launch (WorkManager waking Pulse
// with no UI) finds the task before anything renders. The task opens the store, checks the setting, the source and
// its access (Health Connect's background read permission), runs the shared runSync, and logs the outcome (log.ts).
// Copied from halo's src/background/task.ts without the Google source.
import { initI18n } from "@/i18n/config";
import { localeFor, resolveLanguage } from "@/i18n/language";
import { setLocale } from "@/lib/locale";
import { applyDisplay } from "@/state/display";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { permissionState } from "@/health/connect";
import { notifyAfterRun, readSource } from "./alerts";
import { taskSkipReason } from "./decide";
import { appendLog } from "./log";
import { installNotificationHandler } from "./notify";
import { backgroundStore, runSync } from "./runSync";
import { readSettings } from "./settings";

export const TASK_NAME = "pulse.background.sync";
/** WorkManager's floor. Android stretches it to 15-30 min and skips while Doze or Battery Saver say so. */
export const MIN_INTERVAL_MIN = 15;

/** The task body, exported for the debug "Run now" button. */
export async function runBackgroundTask(): Promise<BackgroundTask.BackgroundTaskResult> {
  const t0 = Date.now();
  try {
    // Headless: no React tree, so the notifications it posts read the language the person chose.
    const language = await resolveLanguage();
    initI18n(language);
    setLocale(localeFor(language));
    const settings = await readSettings();
    const store = await backgroundStore();
    const [profile, source] = await Promise.all([store.getProfile(), readSource()]);
    // The notifications it may post print times and values on the person's clock and units.
    applyDisplay(profile);
    const perms = source === "health_connect" ? await permissionState().catch(() => null) : null;
    const skip = taskSkipReason({ enabled: settings.backgroundSync, hasProfile: !!profile, source, background: !!perms?.background });
    if (skip || !profile || source !== "health_connect") {
      // Nothing imported, but a stale sync is exactly when "Pulse can't sync" is due.
      if (profile) await notifyAfterRun(store, profile.timeZone);
      await appendLog({ at: t0, result: "skipped", ms: Date.now() - t0, note: skip ?? "no profile yet" });
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    const r = await runSync(store, profile, source, { timeZone: profile.timeZone, owner: "task" });
    await appendLog({
      at: t0,
      result: r.ran ? "ok" : "skipped",
      ms: Date.now() - t0,
      note: r.ran ? (r.warnings.length ? r.warnings.join("; ") : undefined) : r.skipped,
    });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[background]", message);
    await appendLog({ at: t0, result: "failed", ms: Date.now() - t0, note: message });
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

TaskManager.defineTask(TASK_NAME, runBackgroundTask);
// Also global: a notification arriving while Pulse is open must still show.
installNotificationHandler();

export function isBackgroundSyncRegistered(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(TASK_NAME).catch(() => false);
}

/** False when the system refuses background tasks for this app. */
export async function backgroundSyncAvailable(): Promise<boolean> {
  const status = await BackgroundTask.getStatusAsync().catch(() => BackgroundTask.BackgroundTaskStatus.Restricted);
  return status === BackgroundTask.BackgroundTaskStatus.Available;
}

/** Registers or unregisters the task to match `enabled`. Never throws. */
export async function syncRegistration(enabled: boolean): Promise<void> {
  try {
    const registered = await isBackgroundSyncRegistered();
    if (enabled && !registered) await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: MIN_INTERVAL_MIN });
    else if (!enabled && registered) await BackgroundTask.unregisterTaskAsync(TASK_NAME);
  } catch (e) {
    console.warn("[background] register", e instanceof Error ? e.message : String(e));
  }
}

/** Debug builds only: asks WorkManager to run the task now (a no-op in release). */
export function triggerForTesting(): Promise<boolean> {
  return BackgroundTask.triggerTaskWorkerForTestingAsync().catch(() => false);
}
