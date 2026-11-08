// After a run, foreground or background: read what the store holds, decide (decide.ts, smart.ts), send (notify.ts),
// mark, and re-plan the bedtime reminder. Looks only at what is on disk, so it is right after a failed run too: a stale
// sync is exactly when "Pulse can't sync" is due. Never throws.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ScoreRow, Store } from "@/data/store";
import { addDays, localDay } from "@/lib/time";
import { SOURCE_KEY } from "@/state/source";
import { decide, EMPTY_MARKERS, markSent, type Alert, type AlertSource, type Markers } from "./decide";
import { cancelBedtime, notificationPermission, scheduleBedtime, sendNow } from "./notify";
import { readSettings, type BackgroundSettings } from "./settings";
import { decideSmart, MONITOR_LOOKBACK_DAYS, monitorBefore, monitorState, planBedtime, strainOf, type BedtimeAction, type BedtimeReminder } from "./smart";

export const MARKERS_KEY = "pulse.notifications.markers";

export async function readMarkers(): Promise<Markers> {
  try {
    const raw = await AsyncStorage.getItem(MARKERS_KEY);
    return raw ? { ...EMPTY_MARKERS, ...(JSON.parse(raw) as Partial<Markers>) } : EMPTY_MARKERS;
  } catch {
    return EMPTY_MARKERS;
  }
}

export async function writeMarkers(m: Markers): Promise<void> {
  await AsyncStorage.setItem(MARKERS_KEY, JSON.stringify(m)).catch(() => {});
}

export async function readSource(): Promise<AlertSource> {
  const s = await AsyncStorage.getItem(SOURCE_KEY).catch(() => null);
  return s === "health_connect" || s === "demo" ? s : null;
}

/** Any alert on (the check-in reminder is startup.ts's). */
const anyAlert = (s: BackgroundSettings) => s.recoveryReady || s.cantSync || s.strainTarget || s.healthMonitor || s.weeklyReport || s.bedtime;

/** The bedtime reminder planned from yesterday's and today's rows. */
const bedtimePlan = (s: BackgroundSettings, source: AlertSource, markers: Markers, rows: readonly ScoreRow[], today: string, timeZone: string, now: number) =>
  planBedtime({
    now,
    timeZone,
    source,
    enabled: s.bedtime,
    leadMin: s.bedtimeLeadMin,
    plans: [addDays(today, -1), today].map((day) => ({ day, planner: rows.find((r) => r.day === day)?.sleep_planner })),
    markers,
  });

/** Puts a plan on the system's schedule; the markers to set, or null when nothing changed. */
async function applyPlan(a: BedtimeAction): Promise<Partial<Markers> | null> {
  if (a.action === "schedule") return (await scheduleBedtime(a.reminder)) ? a.mark : null;
  if (a.action === "cancel") await cancelBedtime();
  return Object.keys(a.mark).length ? a.mark : null;
}

/** Sends what is due and returns it. `now` in unix seconds. */
export async function notifyAfterRun(store: Store, timeZone: string, now = Math.floor(Date.now() / 1000)): Promise<Alert[]> {
  try {
    const settings = await readSettings();
    if (!anyAlert(settings)) {
      await cancelBedtime();
      return [];
    }
    if ((await notificationPermission()) !== "granted") return [];
    const today = localDay(now, timeZone);
    const [source, markers, sync, rows, reports] = await Promise.all([
      readSource(),
      readMarkers(),
      store.getSyncState(),
      store.scoresIn({ from: addDays(today, -MONITOR_LOOKBACK_DAYS), to: today }),
      settings.weeklyReport ? store.getReports() : Promise.resolve([]),
    ]);
    const row = rows.find((r) => r.day === today) ?? null;
    const due = [
      ...decide({ now, timeZone, source, settings, recoveryToday: row?.recovery?.value ?? null, lastSyncTs: sync.lastSyncTs, markers }),
      ...decideSmart({
        now,
        timeZone,
        source,
        settings,
        ...strainOf(row),
        monitor: monitorState(row?.health_monitor),
        monitorBefore: monitorBefore(rows, today),
        reports: reports.map((r) => r.data),
        markers,
      }),
    ];
    const sent: Alert[] = [];
    for (const a of due) if (await sendNow(a)) sent.push(a);
    const bedtime = await applyPlan(bedtimePlan(settings, source, markers, rows, today, timeZone, now));
    // Re-read before writing: the other runtime (app or task) may have marked something since.
    if (sent.length || bedtime) await writeMarkers(markSent({ ...(await readMarkers()), ...bedtime }, sent));
    return sent;
  } catch (e) {
    console.warn("[alerts]", e instanceof Error ? e.message : String(e));
    return [];
  }
}

/**
 * Settings › Notifications: the bedtime reminder re-planned now, after its switch or lead changed (a run would do it
 * at the next sync). Returns the reminder on the schedule, or null. Never throws.
 */
export async function applyBedtime(store: Store | null, timeZone: string, now = Math.floor(Date.now() / 1000)): Promise<BedtimeReminder | null> {
  try {
    const settings = await readSettings();
    // Off needs neither: the plan is a cancel.
    if (settings.bedtime && (!store || (await notificationPermission()) !== "granted")) return null;
    const today = localDay(now, timeZone);
    const [source, markers, rows] = await Promise.all([
      readSource(),
      readMarkers(),
      settings.bedtime && store ? store.scoresIn({ from: addDays(today, -1), to: today }) : Promise.resolve([]),
    ]);
    const plan = bedtimePlan(settings, source, markers, rows, today, timeZone, now);
    const mark = await applyPlan(plan);
    if (mark) await writeMarkers({ ...(await readMarkers()), ...mark });
    return plan.action === "schedule" && mark ? plan.reminder : null;
  } catch (e) {
    console.warn("[alerts] bedtime", e instanceof Error ? e.message : String(e));
    return null;
  }
}
