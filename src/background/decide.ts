// Which notifications to send, and whether the background task should run: pure functions (decide.test.ts), with
// the expo modules kept in notify.ts and task.ts. Copied from halo's src/background/decide.ts without the Google
// source. The web's src/server/push.ts sends two daily alerts, "Recovery ready" once per local day once today's Recovery exists and "Pulse can't sync" once per local day; the markers
// (the day each was last sent) stand in for its per-subscription claim columns. The smart alerts (strain target,
// Health Monitor, weekly report, bedtime reminder) are decided in smart.ts and share these types and markers.
import { i18n } from "@/i18n/config";
import { BAND_WORD, recoveryBand } from "@/lib/bands";
import { localDay } from "@/lib/time";

export type AlertKind = "recovery" | "cant_sync" | "strain_target" | "health_monitor" | "weekly_report";

/** What went out when (smart.ts's MonitorLevel, kept here so the markers need no import). */
export type MarkedMonitorLevel = "flagged" | "illness";

/** What each alert last went out for, so nothing repeats: a local day, an ISO week, or the bedtime last scheduled. */
export type Markers = {
  recoveryDay: string | null;
  cantSyncDay: string | null;
  strainTargetDay: string | null;
  /** The day of the last Health Monitor alert and the level it reported (a rise to illness that day still goes). */
  monitorDay: string | null;
  monitorLevel: MarkedMonitorLevel | null;
  /** The ISO week (`2026-W40`) of the last "Weekly report ready". */
  reportPeriod: string | null;
  /** The plan day and fire time (unix s) of the bedtime reminder last put on the schedule. */
  bedtimeDay: string | null;
  bedtimeAt: number | null;
};
export const EMPTY_MARKERS: Markers = {
  recoveryDay: null,
  cantSyncDay: null,
  strainTargetDay: null,
  monitorDay: null,
  monitorLevel: null,
  reportPeriod: null,
  bedtimeDay: null,
  bedtimeAt: null,
};

export type AlertSource = "health_connect" | "demo" | null;

/** A source that syncs the person's own data (demo data never notifies). */
export const isOwnData = (s: AlertSource): s is "health_connect" => s === "health_connect";

export type DecideInput = {
  /** Unix seconds. */
  now: number;
  timeZone: string;
  source: AlertSource;
  settings: { recoveryReady: boolean; cantSync: boolean };
  /** Today's stored Recovery value; null while the night hasn't been scored. */
  recoveryToday: number | null;
  /** Unix seconds of the last successful sync; null when there has been none. */
  lastSyncTs: number | null;
  markers: Markers;
};

export type Alert = {
  kind: AlertKind;
  title: string;
  body: string;
  /** What a tap opens (the app's `pulse://` scheme, app.json). */
  url: string;
  /** The local day it is for. */
  day: string;
  /** The markers to set once sent. */
  mark: Partial<Markers>;
};

/** "Pulse can't sync" after this long without a successful sync. */
export const CANT_SYNC_AFTER_S = 36 * 3600;

/**
 * Deep links (expo-router resolves them to app/recovery.tsx, app/settings.tsx, app/(tabs)/journal.tsx, app/strain.tsx,
 * app/sleep.tsx with its `#planner` anchor, app/health/monitor.tsx; a report is smart.ts's reportLink).
 */
export const DEEP_LINK = {
  recovery: "pulse://recovery",
  source: "pulse://settings?s=source",
  journal: "pulse://journal",
  notifications: "pulse://settings?s=notifications",
  strain: "pulse://strain",
  planner: "pulse://sleep#planner",
  monitor: "pulse://health/monitor",
} as const;

/** The web's "Recovery ready" body: "78%: Green". */
export const recoveryBody = (value: number) => i18n.t("notifications:recovery.body", { percent: Math.round(value), band: BAND_WORD[recoveryBand(Math.round(value))] });

/** "38 hours" / "3 days", no Intl.PluralRules (Hermes). */
export function sinceWords(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  if (hours < 48) return i18n.t("notifications:since.hours", { count: hours });
  return i18n.t("notifications:since.days", { count: Math.floor(hours / 24) });
}

/** A marker for `day` already sent: today or (a clock set back) later, as the web's `col < day` claim. */
export const sentFor = (marker: string | null, day: string) => marker !== null && marker >= day;

/**
 * The alerts due now, for the person's own data (Health Connect; demo data never notifies); each goes once
 * per local day.
 * "Recovery ready" needs today's Recovery value; "Pulse can't sync" needs a last sync at least 36 h old (never
 * synced is onboarding, not a sync problem).
 */
export function decide(input: DecideInput): Alert[] {
  const out: Alert[] = [];
  if (!isOwnData(input.source)) return out;
  const day = localDay(input.now, input.timeZone);
  const rec = input.recoveryToday;
  if (input.settings.recoveryReady && rec != null && Number.isFinite(rec) && !sentFor(input.markers.recoveryDay, day)) {
    out.push({ kind: "recovery", title: i18n.t("notifications:recovery.title"), body: recoveryBody(rec), url: DEEP_LINK.recovery, day, mark: { recoveryDay: day } });
  }
  const last = input.lastSyncTs;
  if (input.settings.cantSync && last != null && input.now - last >= CANT_SYNC_AFTER_S && !sentFor(input.markers.cantSyncDay, day)) {
    out.push({
      kind: "cant_sync",
      title: i18n.t("notifications:cantSync.title"),
      body: i18n.t("notifications:cantSync.body", { gap: sinceWords(input.now - last) }),
      url: DEEP_LINK.source,
      day,
      mark: { cantSyncDay: day },
    });
  }
  return out;
}

/** The markers after `sent` went out. */
export function markSent(markers: Markers, sent: readonly Alert[]): Markers {
  return sent.reduce<Markers>((next, a) => ({ ...next, ...a.mark }), { ...markers });
}

/** "HH:mm" (24-hour; "9:05" is fine) → hour and minute, or null when malformed ("24:00", "21:60", "9pm"). */
export function parseTime(s: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(s);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export const formatTime = (t: { hour: number; minute: number }) => `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;

export type TaskGate = {
  /** The Background sync setting. */
  enabled: boolean;
  hasProfile: boolean;
  source: AlertSource;
  /** Health Connect's background read permission. */
  background: boolean;
};

/** Why the background task should not import, or null to go ahead. Every reason is quiet: logged, never shown. */
export function taskSkipReason(g: TaskGate): string | null {
  if (!g.enabled) return "background sync is off";
  if (!g.hasProfile) return "no profile yet";
  if (g.source === "demo") return "demo data";
  if (g.source !== "health_connect") return "no data source";
  if (!g.background) return "no background access";
  return null;
}
