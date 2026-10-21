// Settings › Notifications & background (`/settings?s=notifications`). Content follows halo's
// src/screens/settings/notifications.tsx, drawn with Pulse's own kit. Two cards. Background sync: the WorkManager task
// (src/background/task.ts), Health Connect's background read permission and the task's last runs. Notifications: the
// alerts (src/background/decide.ts, smart.ts), the daily check-in with its time, the wind-down lead and a test.
// Turning any notification on asks for Android 13's POST_NOTIFICATIONS permission first.
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { isBatteryOptimizationEnabledAsync } from "expo-battery";
import { applyBedtime } from "@/background/alerts";
import { DEEP_LINK, formatTime, parseTime, recoveryBody } from "@/background/decide";
import { readLog, type RunLogEntry } from "@/background/log";
import { askNotificationPermission, notificationPermission, sendNow, type NotificationPermission } from "@/background/notify";
import { BEDTIME_LEADS, DEFAULT_SETTINGS, readSettings, writeSettings, type BackgroundSettings } from "@/background/settings";
import type { BedtimeReminder } from "@/background/smart";
import { applyCheckIn } from "@/background/startup";
import { backgroundSyncAvailable, isBackgroundSyncRegistered, runBackgroundTask, syncRegistration } from "@/background/task";
import { askBackgroundPermission, permissionState } from "@/health/connect";
import { clock, DAY, formatDay, timeOfDay } from "@/lib/format";
import { displayPrefs } from "@/lib/units";
import { localDay } from "@/lib/time";
import { deviceTimeZone, useApp } from "@/state/app";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Segmented } from "@/ui/Segmented";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { HINT, ROW, ROW_LABEL, ROW_RULE, ROW_VALUE, SmallButton, SwitchRow } from "./controls";

/** Settings and the notification permission, loaded once and re-read when the app returns from system settings. */
function useNotificationSettings() {
  const [settings, setSettings] = useState<BackgroundSettings>(DEFAULT_SETTINGS);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const refresh = useCallback(
    () =>
      Promise.all([readSettings(), notificationPermission()]).then(([s, p]) => {
        setSettings(s);
        setPermission(p);
      }),
    [],
  );
  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => sub.remove();
  }, [refresh]);
  const update = useCallback(async (patch: Partial<BackgroundSettings>) => {
    const next = await writeSettings(patch);
    setSettings(next);
    return next;
  }, []);
  return { settings, permission, setPermission, update };
}
type Prefs = ReturnType<typeof useNotificationSettings>;

// ── Background sync ──────────────────────────────────────────────────────────

const RESULT_WORD: Record<RunLogEntry["result"], string> = { ok: "Synced", skipped: "Skipped", failed: "Failed" };
const RESULT_TONE: Record<RunLogEntry["result"], string> = { ok: "text-optimal-text", skipped: "text-muted-foreground", failed: "text-recovery-red-text" };

function LastRuns({ log, timeZone }: { log: RunLogEntry[]; timeZone: string }) {
  if (!log.length) return <Text className={cn(HINT, "mt-2")}>No background runs yet.</Text>;
  return (
    <View className="mt-2">
      <Text accessibilityRole="header" className="text-[13px] font-semibold leading-[18px] text-foreground-secondary">
        Last runs
      </Text>
      {log.slice(0, 6).map((e, i) => (
        <View key={e.at} className={cn("py-2", i > 0 && ROW_RULE)}>
          <View className="flex-row items-center justify-between gap-3">
            <Text className={cn(ROW_LABEL, "tabular-nums")}>{`${formatDay(localDay(e.at / 1000, timeZone), DAY.monthDay)}, ${clock(e.at, timeZone)}`}</Text>
            <Text className={cn("text-[13px] font-semibold tabular-nums", RESULT_TONE[e.result])}>{`${RESULT_WORD[e.result]} · ${(e.ms / 1000).toFixed(1)} s`}</Text>
          </View>
          {!!e.note && <Text className={HINT}>{e.note}</Text>}
        </View>
      ))}
    </View>
  );
}

function BackgroundCard({ s, timeZone }: { s: Prefs; timeZone: string }) {
  const hc = useApp((a) => a.source === "health_connect");
  const [log, setLog] = useState<RunLogEntry[]>([]);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(true);
  const [background, setBackground] = useState<boolean | null>(null);
  // Whether Android's battery optimisation leaves Pulse alone; null while unknown.
  const [unrestricted, setUnrestricted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    () =>
      Promise.all([
        readLog(),
        isBackgroundSyncRegistered(),
        backgroundSyncAvailable(),
        hc ? permissionState().catch(() => null) : null,
        isBatteryOptimizationEnabledAsync().then((on) => !on, () => null),
      ]).then(([l, r, a, p, u]) => {
        setLog(l);
        setRegistered(r);
        setAvailable(a);
        setBackground(p ? p.background : null);
        setUnrestricted(u);
      }),
    [hc],
  );
  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener("change", (st) => st === "active" && void refresh());
    return () => sub.remove();
  }, [refresh]);

  const toggle = async (on: boolean) => {
    await s.update({ backgroundSync: on });
    await syncRegistration(on);
    await refresh();
    if (on && background === false) toast.error("Allow background access so Pulse can read Health Connect while closed");
  };
  const allow = async () => {
    setBusy(true);
    try {
      const p = await askBackgroundPermission().catch(() => null);
      setBackground(p ? p.background : null);
      if (p?.background) toast.success("Background access allowed");
      else toast.error("Background access was not allowed");
    } finally {
      setBusy(false);
    }
  };
  const runNow = async () => {
    setBusy(true);
    try {
      await runBackgroundTask();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const access = background === null ? "Checking Health Connect…" : background ? "Allowed" : "Not allowed";
  return (
    <SectionShell variant="card" title="Background sync">
      <SwitchRow
        rule={false}
        label="Background sync"
        hint={hc ? "Imports Health Connect and rescores while Pulse is closed." : "Needs Health Connect as the data source."}
        value={s.settings.backgroundSync}
        onChange={(v) => void toggle(v)}
        disabled={!hc}
      />
      <Text className={HINT}>Android decides when it runs: every 15 minutes at best, often hours apart when you rarely open Pulse or Battery Saver is on. Pulse always syncs when you open it.</Text>
      {!available && <Text className="mt-2 text-[13px] font-medium leading-[18px] text-warning-text">Background tasks are restricted for Pulse on this phone.</Text>}
      {hc && (
        <>
          <View className={cn(ROW, ROW_RULE, "mt-2")}>
            <View className="min-w-0 flex-1">
              <Text className={ROW_LABEL}>Background access</Text>
              <Text className={HINT}>Health Connect only answers a closed app with this permission.</Text>
            </View>
            {background === false ? <SmallButton solid label="Allow" accessibilityLabel="Allow background access" onPress={() => void allow()} /> : <Text className={ROW_VALUE}>{access}</Text>}
          </View>
          {/* Phone makers' battery managers (OnePlus, Samsung, Xiaomi) freeze an app a few seconds into its background
              run unless it may run in the background; the sync then stalls for minutes. Their switch is under the
              app's own settings, so the button opens those. */}
          <View className={cn(ROW, ROW_RULE)}>
            <View className="min-w-0 flex-1">
              <Text className={ROW_LABEL}>Battery</Text>
              <Text className={HINT}>
                {unrestricted
                  ? "Pulse may run in the background, so a sync finishes."
                  : "Many phones pause Pulse a few seconds into a background sync, which then stalls. Under Battery, choose Allow background activity or Unrestricted."}
              </Text>
            </View>
            {unrestricted === false ? (
              <SmallButton solid label="Open" accessibilityLabel="Open Pulse's battery settings" onPress={() => void Linking.openSettings()} />
            ) : (
              <Text className={ROW_VALUE}>{unrestricted ? "Unrestricted" : " "}</Text>
            )}
          </View>
        </>
      )}
      <View className={cn(ROW, ROW_RULE)}>
        <Text className={ROW_LABEL}>Schedule</Text>
        <Text className={ROW_VALUE}>{registered === null ? " " : registered ? "Scheduled with Android" : "Not scheduled"}</Text>
      </View>
      <View className={ROW_RULE}>
        <LastRuns log={log} timeZone={timeZone} />
      </View>
      {__DEV__ && (
        <Button variant="secondary" className="mt-3" onPress={() => void runNow()} disabled={busy}>
          Run the task now (debug)
        </Button>
      )}
    </SectionShell>
  );
}

// ── Notifications ────────────────────────────────────────────────────────────

/** The check-in time: the value as a button that opens the system's time picker, on the person's clock. */
function TimeRow({ value, onCommit, disabled }: { value: string; onCommit: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = parseTime(value) ?? { hour: 21, minute: 0 };
  const date = new Date();
  date.setHours(t.hour, t.minute, 0, 0);
  return (
    <View className={cn(ROW, ROW_RULE, disabled && "opacity-disabled")} pointerEvents={disabled ? "none" : "auto"}>
      <Text className={ROW_LABEL}>Check-in time</Text>
      <SmallButton label={timeOfDay(t.hour, t.minute)} accessibilityLabel={`Check-in time, ${timeOfDay(t.hour, t.minute)}`} onPress={() => setOpen(true)} />
      {open && (
        <DateTimePicker
          value={date}
          mode="time"
          is24Hour={displayPrefs().hours === 24}
          onDismiss={() => setOpen(false)}
          onValueChange={(_e, d) => {
            setOpen(false);
            const v = formatTime({ hour: d.getHours(), minute: d.getMinutes() });
            if (v !== value) onCommit(v);
          }}
        />
      )}
    </View>
  );
}

const LEADS = BEDTIME_LEADS.map((m) => ({ value: String(m), label: `${m} min` }));

function NotificationsCard({ s, timeZone }: { s: Prefs; timeZone: string }) {
  const store = useApp((a) => a.store);
  const denied = s.permission === "denied";
  // The wind-down reminder on the schedule, for its hint; re-planned on open as after a run.
  const [next, setNext] = useState<BedtimeReminder | null>(null);
  useEffect(() => {
    let live = true;
    void applyBedtime(store, timeZone).then((r) => live && setNext(r));
    return () => {
      live = false;
    };
  }, [store, timeZone]);

  /** Turning something on needs the permission; off never does. Whether the change may go ahead. */
  const allowed = async (on: boolean) => {
    if (!on || s.permission === "granted") return true;
    const p = await askNotificationPermission();
    s.setPermission(p);
    if (p !== "granted") toast.error("Notifications are blocked. Allow them for Pulse in Android settings.");
    return p === "granted";
  };
  const set = async (key: "recoveryReady" | "cantSync" | "strainTarget" | "healthMonitor" | "weeklyReport", on: boolean) => {
    if (await allowed(on)) await s.update({ [key]: on });
  };
  const setCheckIn = async (on: boolean) => {
    if (await allowed(on)) await applyCheckIn(await s.update({ checkIn: on }));
  };
  const setTime = async (checkInTime: string) => applyCheckIn(await s.update({ checkInTime }));
  const setWindDown = async (patch: Pick<Partial<BackgroundSettings>, "bedtime" | "bedtimeLeadMin">) => {
    if (patch.bedtime && !(await allowed(true))) return;
    await s.update(patch);
    setNext(await applyBedtime(store, timeZone));
  };
  const test = async () => {
    if (!(await allowed(true))) return;
    const ok = await sendNow({ title: "Recovery ready", body: `${recoveryBody(78)} · a test from Pulse`, url: DEEP_LINK.notifications });
    if (ok) toast.success("Test notification sent");
    else toast.error("Couldn’t show a notification");
  };
  const windDownHint = next
    ? `Next at ${clock(next.at * 1000, timeZone)}, for bed by ${clock(next.bedtime * 1000, timeZone)}.`
    : "Before tonight’s planned bedtime, from the sleep planner.";

  return (
    <SectionShell variant="card" title="Notifications">
      {denied && (
        <View className="mb-2 gap-2">
          <Text className="text-[13px] font-medium leading-[18px] text-warning-text">Notifications are blocked in Android settings. Allow them for Pulse there, then come back.</Text>
          <Button variant="outline" onPress={() => void Linking.openSettings()}>
            Open settings
          </Button>
        </View>
      )}
      <SwitchRow rule={false} label="Recovery ready" hint="Once a day, when today’s Recovery is scored." value={s.settings.recoveryReady} onChange={(v) => void set("recoveryReady", v)} disabled={denied} />
      <SwitchRow label="Pulse can’t sync" hint="Once a day, when Health Connect hasn’t synced for 36 hours." value={s.settings.cantSync} onChange={(v) => void set("cantSync", v)} disabled={denied} />
      <SwitchRow label="Strain target reached" hint="Once a day, when Day Strain reaches today’s target." value={s.settings.strainTarget} onChange={(v) => void set("strainTarget", v)} disabled={denied} />
      <SwitchRow
        label="Health Monitor"
        hint="When last night’s vitals leave your normal range or an illness signal appears; not again while it lasts."
        value={s.settings.healthMonitor}
        onChange={(v) => void set("healthMonitor", v)}
        disabled={denied}
      />
      <SwitchRow label="Weekly report" hint="Monday morning, when last week’s report is ready." value={s.settings.weeklyReport} onChange={(v) => void set("weeklyReport", v)} disabled={denied} />
      <SwitchRow label="Daily check-in" hint="Every day at the time below; opens the Journal." value={s.settings.checkIn} onChange={(v) => void setCheckIn(v)} disabled={denied} />
      <TimeRow value={s.settings.checkInTime} onCommit={(v) => void setTime(v)} disabled={denied || !s.settings.checkIn} />
      <SwitchRow label="Wind down" hint={windDownHint} value={s.settings.bedtime} onChange={(v) => void setWindDown({ bedtime: v })} disabled={denied} />
      <View className={cn("gap-2 py-3", ROW_RULE, (denied || !s.settings.bedtime) && "opacity-disabled")} pointerEvents={denied || !s.settings.bedtime ? "none" : "auto"}>
        <Text className={ROW_LABEL}>Remind me before bed</Text>
        <Segmented fill label="Remind me before bed" value={String(s.settings.bedtimeLeadMin)} options={LEADS} onChange={(v) => void setWindDown({ bedtimeLeadMin: Number(v) })} />
      </View>
      <Button variant="outline" className="mt-2" onPress={() => void test()} disabled={denied}>
        Send a test notification
      </Button>
      <Text className={cn(HINT, "mt-3")}>Alerts are checked after every sync, in the background or when Pulse opens. Nothing leaves the phone.</Text>
    </SectionShell>
  );
}

export function NotificationsSection() {
  const s = useNotificationSettings();
  const timeZone = useApp((a) => a.profile?.timeZone) ?? deviceTimeZone();
  return (
    <>
      <BackgroundCard s={s} timeZone={timeZone} />
      <NotificationsCard s={s} timeZone={timeZone} />
    </>
  );
}
