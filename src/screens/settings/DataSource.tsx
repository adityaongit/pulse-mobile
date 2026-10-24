// Settings › Data source: Health Connect, as halo's src/screens/settings/sections.tsx shows it, in Pulse's section look.
// The source row (availability, last sync), what needs doing (access revoked, permissions missing, the last failure),
// the running import, Sync now and Re-import, the sample data, the data check, and every record
// type's permission folded underneath. The state is the app's (src/state/app.ts); permissions are re-read whenever the
// app comes back from Health Connect's settings.
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, Pressable, Share, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Check, ChevronDown, Minus, RefreshCw, TriangleAlert } from "lucide-react-native";
import { askPermissions, openHealthConnectSettings, permissionState, READ_TYPES, skippedTypes, type PermissionState, type ReadType } from "@/health/connect";
import { runDataCheck } from "@/health/dataCheck";
import { i18n } from "@/i18n/config";
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
import { BODY, ConfirmDialog, HINT, ProgressBar, ROW_LABEL, ROW_RULE } from "./controls";

/** Health Connect's record types as Settings lists them: the key of each label in `settings:recordType`. The words resolve at use. */
const TYPE_KEY = {
  SleepSession: "recordType.sleepSession",
  HeartRate: "recordType.heartRate",
  RestingHeartRate: "recordType.restingHeartRate",
  HeartRateVariabilityRmssd: "recordType.heartRateVariabilityRmssd",
  RespiratoryRate: "recordType.respiratoryRate",
  OxygenSaturation: "recordType.oxygenSaturation",
  SkinTemperature: "recordType.skinTemperature",
  Steps: "recordType.steps",
  Distance: "recordType.distance",
  ExerciseSession: "recordType.exerciseSession",
  TotalCaloriesBurned: "recordType.totalCaloriesBurned",
  ActiveCaloriesBurned: "recordType.activeCaloriesBurned",
  Vo2Max: "recordType.vo2Max",
  Weight: "recordType.weight",
  BodyFat: "recordType.bodyFat",
  FloorsClimbed: "recordType.floorsClimbed",
  ElevationGained: "recordType.elevationGained",
  Hydration: "recordType.hydration",
  Nutrition: "recordType.nutrition",
  BloodGlucose: "recordType.bloodGlucose",
  BodyTemperature: "recordType.bodyTemperature",
  MenstruationPeriod: "recordType.menstruationPeriod",
  MenstruationFlow: "recordType.menstruationFlow",
  IntermenstrualBleeding: "recordType.intermenstrualBleeding",
  OvulationTest: "recordType.ovulationTest",
} as const satisfies Record<ReadType, string>;
const typeLabel = (t: ReadType) => i18n.t(`settings:${TYPE_KEY[t]}`);

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
  const { t } = useTranslation("settings");
  const missing = perms.missing.length + (perms.history ? 0 : 1);
  const rows = [...READ_TYPES.map((ty) => ({ key: ty, label: typeLabel(ty), ok: perms.granted.includes(ty) })), { key: "history", label: t("source.pastData"), ok: perms.history }];
  const summary = missing ? t("source.notAllowedCount", { count: missing }) : t("source.allAllowed");
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
        <Text className={ROW_LABEL}>{t("source.dataTypes")}</Text>
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
            <View key={r.key} accessible accessibilityLabel={t("source.rowLabel", { label: r.label, state: r.ok ? t("source.allowed") : t("source.notAllowed") })} className={cn("min-h-12 flex-row items-center gap-3 py-2", i > 0 && ROW_RULE)}>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] leading-[22px]">
                {r.label}
              </Text>
              <Text className={cn(CAPTION, "shrink-0", !r.ok && "text-warning-text")}>{r.ok ? t("source.allowed") : t("source.notAllowed")}</Text>
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
  const { t } = useTranslation("settings");
  return (
    <Button
      variant="secondary"
      className="flex-1"
      disabled={syncing}
      onPress={async () => {
        haptic.tap();
        await refresh();
        const { error } = appState();
        if (error) toast.error(t("source.syncFailed", { error }));
        else toast.success(t("source.synced"));
      }}
    >
      <Spinner spinning={syncing} />
      <Text className={cn(LABEL, "text-secondary-foreground")}>{syncing ? t("source.syncing") : t("source.syncNow")}</Text>
    </Button>
  );
}

type Confirm = "sample" | "reimport" | null;

/** The running sync's step and percent. It reads the progress itself, so a tick redraws this line, not the card. */
function SyncProgress() {
  const { t } = useTranslation("settings");
  const progress = useApp((s) => s.progress);
  if (!progress || progress.total <= 0) return null;
  return (
    <View accessibilityLiveRegion="polite" className="mt-4 gap-2">
      <Text className="text-[15px] leading-[22px] tabular-nums">
        {t("source.stepProgress", { step: stepLabel(progress.step), percent: Math.floor((progress.done / progress.total) * 100) })}
      </Text>
      <ProgressBar value={(progress.done / progress.total) * 100} label={t("source.syncProgress")} />
    </View>
  );
}

export function DataSource({ now }: { now: number }) {
  const { t } = useTranslation("settings");
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

  const label = sample ? t("source.sampleData") : hc ? t("source.healthConnect") : t("source.notConnected");
  const syncedLine = last ? t("source.syncedAgo", { ago: ago(last, Math.max(now, last)) }) : t("source.notSyncedYet");
  const state: { line: string; tone?: string; body?: string } = sample
    ? { line: t("source.sampleLine"), body: t("source.sampleBody") }
    : !hc
      ? { line: t("source.notConnected"), body: t("source.notConnectedBody") }
      : revoked
        ? { line: t("source.revokedLine"), tone: "text-recovery-red-text", body: t("source.revokedBody") }
        : availability === "update_required"
          ? { line: syncedLine, tone: "text-warning-text", body: t("source.updateBody") }
          : availability === "unavailable"
            ? { line: t("source.notAvailable"), tone: "text-warning-text", body: t("source.unavailableBody") }
            : { line: syncing ? t("source.syncing") : syncedLine };

  const allow = async () => {
    const p = await askPermissions().catch(() => null);
    await perms.read();
    if (p && p.granted.length) void refresh();
  };

  const dataCheck = async () => {
    setChecking(true);
    try {
      const { text } = await runDataCheck(appStore(), { timeZone: appState().profile?.timeZone ?? "UTC" });
      await Share.share({ message: text, title: t("source.checkShareTitle") });
    } catch {
      toast.error(t("source.checkFailed"));
    }
    setChecking(false);
  };

  return (
    <SectionShell variant="card" title={t("sectionTitle.dataSource")}>
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
      {!!state.body && <Text className={cn(BODY, "mt-3")}>{state.body}</Text>}
      {!!error && !syncing && (
        <Text accessibilityRole="alert" className={cn(CAPTION, "mt-3 text-recovery-red-text")}>
          {t("source.lastSyncFailed", { error })}
        </Text>
      )}
      {hc && !syncing && skipped.length > 0 && (
        <Callout
          title={t("source.skippedTitle")}
          body={t("source.skippedBody", { types: skipped.map((ty) => typeLabel(ty).toLowerCase()).join(", ") })}
        />
      )}
      {needsPermissions && (
        <Callout title={t("source.morePermissionsTitle")} body={t("source.morePermissionsBody")}>
          <View className="mt-3 flex-row gap-2">
            <Button className="flex-1" onPress={() => void allow()}>
              {t("source.allow")}
            </Button>
            <Button variant="secondary" className="flex-1" onPress={() => void openHealthConnectSettings()}>
              {t("source.openSettings")}
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
                  {t("source.allowAccess")}
                </Button>
              ) : (
                <SyncNowButton syncing={syncing} />
              )}
              <Button variant="outline" className="flex-1" disabled={syncing} onPress={() => setConfirm("reimport")}>
                {t("source.reimport")}
              </Button>
            </View>
            <Button variant="secondary" onPress={() => void openHealthConnectSettings()}>
              {t("source.openHealthConnect")}
            </Button>
            <Button variant="secondary" disabled={syncing} onPress={() => setConfirm("sample")}>
              {t("source.useSample")}
            </Button>
          </>
        ) : (
          <Button disabled={syncing || availability === "unavailable"} onPress={() => push("/connect")}>
            {t("source.connect")}
          </Button>
        )}
      </View>
      {hc && (
        <View className="mt-4 gap-2 border-t border-border pt-4">
          <Text className={ROW_LABEL}>{t("source.dataCheck")}</Text>
          <Text className={HINT}>{t("source.dataCheckHint")}</Text>
          <Button variant="secondary" disabled={checking} onPress={() => void dataCheck()}>
            {checking ? t("source.checking") : t("source.runDataCheck")}
          </Button>
        </View>
      )}
      {hc && perms.state && <DataTypes key={String(perms.state.missing.length)} perms={perms.state} />}
      <ConfirmDialog
        open={confirm === "reimport"}
        title={t("source.reimportTitle")}
        description={t("source.reimportBody")}
        confirmLabel={t("source.reimport")}
        pendingLabel={t("source.reimport")}
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
        title={t("source.sampleTitle")}
        description={t("source.sampleConfirmBody")}
        confirmLabel={t("source.useSample")}
        pendingLabel={t("source.useSample")}
        pending={false}
        confirmVariant="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          exploreSample().catch(() => toast.error(t("source.sampleFailed")));
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
