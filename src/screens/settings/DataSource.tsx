// Settings › Data source: Health Connect, as halo's src/screens/settings/sections.tsx shows it, in Pulse's section look.
// The source row (availability, last sync), what needs doing (access revoked, permissions missing, the last failure),
// the running import, Sync now and Re-import, the sample data, the source policy, the data check, and every record
// type's permission folded underneath. The state is the app's (src/state/app.ts); permissions are re-read whenever the
// app comes back from Health Connect's settings.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, Pressable, Share, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Check, ChevronDown, Minus, RefreshCw, TriangleAlert } from "lucide-react-native";
import { askPermissions, openHealthConnectSettings, permissionState, READ_TYPES, skippedTypes, type PermissionState, type ReadType } from "@/health/connect";
import { runDataCheck } from "@/health/dataCheck";
import { getSourcePolicy, setSourcePolicy, SOURCE_POLICIES, SOURCE_POLICY_LABELS, type SourcePolicy } from "@/health/sourcePolicy";
import { ago } from "@/lib/format";
import { appState, appStore, exploreSample, refresh, reimport, stepLabel, useApp } from "@/state/app";
import { BandIcon } from "@/ui/brand";
import { HealthConnectMark } from "@/ui/HealthConnectMark";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { CAPTION } from "@/ui/metrics/primitives";
import { push } from "@/ui/navigate";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { useTheme } from "@/ui/theme";
import { DURATION } from "@/ui/motion";
import { BODY, ConfirmDialog, HINT, ProgressBar, RadioSegments, ROW_LABEL, ROW_RULE } from "./controls";

/** Health Connect's record types as Settings lists them. */
const TYPE_LABEL: Record<ReadType, string> = {
  SleepSession: "Sleep",
  HeartRate: "Heart rate",
  RestingHeartRate: "Resting heart rate",
  HeartRateVariabilityRmssd: "Heart rate variability",
  RespiratoryRate: "Respiratory rate",
  OxygenSaturation: "Blood oxygen",
  SkinTemperature: "Skin temperature",
  Steps: "Steps",
  Distance: "Distance",
  ExerciseSession: "Exercise",
  TotalCaloriesBurned: "Calories",
  ActiveCaloriesBurned: "Active calories",
  Vo2Max: "VO2 max",
  Weight: "Weight",
  BodyFat: "Body fat",
  FloorsClimbed: "Floors",
  ElevationGained: "Elevation gain",
  Hydration: "Water",
  Nutrition: "Food",
  BloodGlucose: "Blood glucose",
  BodyTemperature: "Body temperature",
  MenstruationPeriod: "Periods",
  MenstruationFlow: "Period flow",
  IntermenstrualBleeding: "Spotting",
  OvulationTest: "Ovulation tests",
};

/** What Health Connect has granted, re-read whenever the app comes back to the foreground (from its settings). */
function usePermissions(enabled: boolean) {
  const [state, setState] = useState<PermissionState | null>(null);
  const read = useCallback(() => permissionState().then(setState, () => setState(null)), []);
  useEffect(() => {
    if (!enabled) return;
    void read();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void read());
    return () => sub.remove();
  }, [enabled, read]);
  return { state, read };
}

/** Per record type, folded under one summary line; it opens itself when something is not allowed. */
function DataTypes({ perms }: { perms: PermissionState }) {
  const missing = perms.missing.length + (perms.history ? 0 : 1);
  const rows = [...READ_TYPES.map((t) => ({ key: t, label: TYPE_LABEL[t], ok: perms.granted.includes(t) })), { key: "history", label: "Past data", ok: perms.history }];
  const summary = missing ? `${missing} not allowed` : "All allowed";
  const [open, setOpen] = useState(missing > 0);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(open ? "180deg" : "0deg", { duration: DURATION.base }) }] }), [open]);
  return (
    <View className="mt-4 border-t border-border">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          haptic.toggle(!open);
          setOpen(!open);
        }}
        className="min-h-13 flex-row items-center justify-between gap-3 rounded-md py-2"
      >
        <Text className={ROW_LABEL}>Data types</Text>
        <View className="shrink flex-row items-center gap-2">
          <Text className={cn("text-[13px] leading-[18px]", missing ? "text-warning-text" : "text-muted-foreground")}>{summary}</Text>
          <Animated.View style={chevron}>
            <Icon icon={ChevronDown} size={16} tone="muted-foreground" strokeWidth={2} />
          </Animated.View>
        </View>
      </Pressable>
      {open && (
        <View className="border-t border-border">
          {rows.map((r, i) => (
            <View key={r.key} accessible accessibilityLabel={`${r.label}, ${r.ok ? "allowed" : "not allowed"}`} className={cn("min-h-12 flex-row items-center gap-3 py-2", i > 0 && ROW_RULE)}>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] leading-[22px]">
                {r.label}
              </Text>
              <Text className={cn(CAPTION, "shrink-0", !r.ok && "text-warning-text")}>{r.ok ? "Allowed" : "Not allowed"}</Text>
              {r.ok ? <Icon icon={Check} size={16} tone="optimal-text" strokeWidth={2.5} /> : <Icon icon={Minus} size={16} tone="muted-foreground" strokeWidth={2} />}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const LABEL = "text-[13px] font-bold uppercase tracking-[0.1em]";

function Spinner({ spinning }: { spinning: boolean }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    if (spinning) turn.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    else {
      cancelAnimation(turn);
      turn.value = 0;
    }
  }, [spinning, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon icon={RefreshCw} size={20} tone="secondary-foreground" strokeWidth={2} />
    </Animated.View>
  );
}

function SyncNowButton({ syncing }: { syncing: boolean }) {
  return (
    <Button
      variant="secondary"
      className="flex-1"
      disabled={syncing}
      onPress={async () => {
        haptic.tap();
        await refresh();
        const { error } = appState();
        if (error) toast.error(`Sync failed: ${error}`);
        else toast.success("Synced");
      }}
    >
      <Spinner spinning={syncing} />
      <Text className={cn(LABEL, "text-secondary-foreground")}>{syncing ? "Syncing…" : "Sync now"}</Text>
    </Button>
  );
}

/** Which Health Connect records Pulse uses: Fitbit only (default), Fitbit first, or every app. A change re-imports. */
function SourcePolicyPicker({ syncing }: { syncing: boolean }) {
  const [policy, setPolicy] = useState<SourcePolicy | null>(null);
  useEffect(() => {
    let live = true;
    void getSourcePolicy().then((p) => live && setPolicy(p));
    return () => {
      live = false;
    };
  }, []);
  const choose = async (p: SourcePolicy) => {
    if (p === policy || syncing) return;
    setPolicy(p);
    await setSourcePolicy(p);
    toast.success(`${SOURCE_POLICY_LABELS[p].label}: re-importing your history`);
    void reimport();
  };
  return (
    <View className="mt-4 gap-2 border-t border-border pt-4">
      <Text className={ROW_LABEL}>Use data from</Text>
      <RadioSegments label="Use data from" value={policy} options={SOURCE_POLICIES.map((p) => ({ value: p, label: SOURCE_POLICY_LABELS[p].label }))} onChange={(p) => void choose(p)} />
      {policy && <Text className={HINT}>{SOURCE_POLICY_LABELS[policy].detail}</Text>}
    </View>
  );
}

type Confirm = "sample" | "reimport" | null;

/** The running sync's step and percent. It reads the progress itself, so a tick redraws this line, not the card. */
function SyncProgress() {
  const progress = useApp((s) => s.progress);
  if (!progress || progress.total <= 0) return null;
  return (
    <View accessibilityLiveRegion="polite" className="mt-4 gap-2">
      <Text className="text-[15px] leading-[22px] tabular-nums">
        {stepLabel(progress.step)}… {Math.floor((progress.done / progress.total) * 100)}%
      </Text>
      <ProgressBar value={(progress.done / progress.total) * 100} label="Sync progress" />
    </View>
  );
}

export function DataSource({ now }: { now: number }) {
  const { c } = useTheme();
  const source = useApp((s) => s.source);
  const status = useApp((s) => s.status);
  const lastSyncTs = useApp((s) => s.sync.lastSyncTs);
  const error = useApp((s) => s.error ?? s.sync.lastError);
  const availability = useApp((s) => s.availability);
  const warnings = useApp((s) => s.warnings);
  const skipped = skippedTypes(warnings);
  const hc = source === "health_connect";
  const sample = source === "demo";
  const syncing = status === "syncing";
  const perms = usePermissions(hc);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [checking, setChecking] = useState(false);
  const last = lastSyncTs ? lastSyncTs * 1000 : null;
  const revoked = hc && !!perms.state && perms.state.granted.length === 0;
  const needsPermissions = hc && !!perms.state && !revoked && (perms.state.missing.length > 0 || !perms.state.history);

  const label = sample ? "Sample data" : hc ? "Health Connect" : "Not connected";
  const state: { line: string; tone?: string; body?: string } = sample
    ? { line: "180 days of a demo person", body: "Every screen runs on generated data. Connect Health Connect to score your own Fitbit data." }
    : !hc
      ? { line: "Not connected", body: "Connect Health Connect, where the Google Health app writes your Fitbit data. Pulse only reads it; nothing leaves your phone." }
      : revoked
        ? { line: "Access revoked", tone: "text-recovery-red-text", body: "Health Connect access was removed. Sync is paused until you allow it again." }
        : availability === "update_required"
          ? { line: last ? `Synced ${ago(last, Math.max(now, last))}` : "Not synced yet", tone: "text-warning-text", body: "Health Connect needs an update. Update it from the Play Store, then sync again." }
          : availability === "unavailable"
            ? { line: "Not available", tone: "text-warning-text", body: "Health Connect isn’t available on this phone." }
            : { line: syncing ? "Syncing…" : last ? `Synced ${ago(last, Math.max(now, last))}` : "Not synced yet" };

  const allow = async () => {
    const p = await askPermissions().catch(() => null);
    await perms.read();
    if (p && p.granted.length) void refresh();
  };

  const dataCheck = async () => {
    setChecking(true);
    try {
      const { text } = await runDataCheck(appStore(), { timeZone: appState().profile?.timeZone ?? "UTC" });
      await Share.share({ message: text, title: "Pulse data check" });
    } catch {
      toast.error("Couldn’t run the data check. Try again.");
    }
    setChecking(false);
  };

  return (
    <SectionShell variant="card" title="Data source">
      <View className="min-h-11 flex-row items-center gap-3">
        <View accessibilityElementsHidden className="size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-fill-faint">
          {sample ? <BandIcon size={24} color={c.foreground} /> : <HealthConnectMark size={26} />}
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold leading-[22px]">{label}</Text>
          <Text numberOfLines={1} className={cn("text-[13px] leading-[18px] tabular-nums text-muted-foreground", state.tone)}>
            {state.line}
          </Text>
        </View>
      </View>
      {state.body && <Text className={cn(BODY, "mt-3")}>{state.body}</Text>}
      {!!error && !syncing && (
        <Text accessibilityRole="alert" className={cn(CAPTION, "mt-3 text-recovery-red-text")}>
          {`Last sync failed: ${error}`}
        </Text>
      )}
      {hc && !syncing && warnings.includes("no_fitbit_records") && (
        <Callout
          title="Nothing from your Fitbit yet"
          body="With “Fitbit only”, Pulse found no records from the Google Health app that weren’t measured by the phone. Either Google Health isn’t sharing with Health Connect yet, or it labels its records as the phone’s. “Fitbit first” uses the phone’s data on days the Fitbit has none."
        />
      )}
      {hc && !syncing && skipped.length > 0 && (
        <Callout
          title="Some records couldn’t be read"
          body={`Health Connect refused a few ${skipped.map((t) => TYPE_LABEL[t].toLowerCase()).join(", ")} records because the app that wrote them saved times that don’t add up, such as an end before the start. Pulse left those out and imported the rest. Fixing or deleting them in that app brings them in on the next sync.`}
        />
      )}
      {needsPermissions && (
        <Callout title="Pulse needs more permissions" body="Allow every data type, including past data, so Pulse can read all of what your Fitbit writes. Sync keeps working until then.">
          <View className="mt-3 flex-row gap-2">
            <Button className="flex-1" onPress={() => void allow()}>
              Allow
            </Button>
            <Button variant="secondary" className="flex-1" onPress={() => void openHealthConnectSettings()}>
              Open settings
            </Button>
          </View>
        </Callout>
      )}
      {syncing && <SyncProgress />}
      <View className="mt-4 gap-2">
        {hc ? (
          <>
            <View className="flex-row gap-2">
              {revoked ? (
                <Button className="flex-1" onPress={() => void allow()}>
                  Allow access
                </Button>
              ) : (
                <SyncNowButton syncing={syncing} />
              )}
              <Button variant="outline" className="flex-1" disabled={syncing} onPress={() => setConfirm("reimport")}>
                Re-import
              </Button>
            </View>
            <Button variant="secondary" onPress={() => void openHealthConnectSettings()}>
              Open Health Connect
            </Button>
            <Button variant="secondary" disabled={syncing} onPress={() => setConfirm("sample")}>
              Use sample data
            </Button>
          </>
        ) : (
          <Button disabled={syncing || availability === "unavailable"} onPress={() => push("/connect")}>
            Connect Health Connect
          </Button>
        )}
      </View>
      {hc && <SourcePolicyPicker syncing={syncing} />}
      {hc && (
        <View className="mt-4 gap-2 border-t border-border pt-4">
          <Text className={ROW_LABEL}>Data check</Text>
          <Text className={HINT}>Compares the last 10 days in Health Connect, app by app, with what Pulse stored. Shares the report.</Text>
          <Button variant="secondary" disabled={checking} onPress={() => void dataCheck()}>
            {checking ? "Checking…" : "Run data check"}
          </Button>
        </View>
      )}
      {hc && perms.state && <DataTypes key={String(perms.state.missing.length)} perms={perms.state} />}
      <ConfirmDialog
        open={confirm === "reimport"}
        title="Re-import your history?"
        description="Pulse reads the last 180 days from Health Connect again and rescores them, for data an app shared late. Your journal and profile stay."
        confirmLabel="Re-import"
        pendingLabel="Re-import"
        pending={false}
        confirmVariant="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void reimport();
        }}
      />
      <ConfirmDialog
        open={confirm === "sample"}
        title="Use sample data?"
        description="Pulse removes what it imported from Health Connect and fills every screen with 180 days of generated data. Your profile is kept for when you switch back."
        confirmLabel="Use sample data"
        pendingLabel="Use sample data"
        pending={false}
        confirmVariant="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          exploreSample().catch(() => toast.error("Couldn’t build the sample data. Try again."));
        }}
      />
    </SectionShell>
  );
}

/** Something that needs doing: the section's callout (a tinted box with a warning title). */
function Callout({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <View accessibilityRole="summary" className="mt-4 rounded-xl bg-foreground/[0.04] p-4">
      <View className="flex-row items-center gap-2">
        <Icon icon={TriangleAlert} size={16} tone="warning-text" strokeWidth={2} />
        <Text accessibilityRole="header" className="shrink text-[15px] font-semibold leading-[22px]">
          {title}
        </Text>
      </View>
      <Text className={cn(BODY, "mt-1")}>{body}</Text>
      {children}
    </View>
  );
}
