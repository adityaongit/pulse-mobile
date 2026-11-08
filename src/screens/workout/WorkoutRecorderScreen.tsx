import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Alert, Linking, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { maxHrOf } from "@/queries/common";
import { queryCtx, useApp } from "@/state/app";
import { useLiveBleControl } from "@/state/liveBle";
import { workoutRecorder, type WorkoutCalibration } from "@/live/workoutRecorder";
import { summarizeWorkout, WORKOUT_TYPES, type WorkoutType } from "@/live/workout";
import { clockDuration } from "@/live/sessions";
import { workoutNativeAvailable } from "../../../modules/pulse-workouts";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { DetailShell, type DetailShellProps } from "@/ui/shells/DetailShell";
import { PageShell } from "@/ui/shells/PageShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { IntradayHrChart } from "@/ui/charts/IntradayHrChart";
import { zoneOf, zonesOf } from "@/core/engine/strain";
import { push } from "@/ui/navigate";

const EMPTY_CALIBRATION: WorkoutCalibration = { restingHr: null, maxHr: null, sex: null, estimatedMaxHr: false, timeZone: "UTC" };
const number = (value: number | null) => value === null ? "—" : Math.round(value).toLocaleString();

/** Owns no capture state: leaving/reopening this screen cannot finish or reset a workout. */
export function WorkoutRecorderScreen({ tab = false }: { tab?: boolean }) {
  const { t } = useTranslation("workouts");
  const state = useSyncExternalStore(workoutRecorder.subscribe, workoutRecorder.getSnapshot, workoutRecorder.getSnapshot);
  const band = useLiveBleControl();
  const profile = useApp((s) => s.profile);
  const source = useApp((s) => s.source);
  const [type, setType] = useState<WorkoutType>("walk");
  const [calibrationState, setCalibration] = useState(() => ({ profile, source, value: { ...EMPTY_CALIBRATION, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" } }));
  const calibration = calibrationState.profile === profile && calibrationState.source === source ? calibrationState.value : EMPTY_CALIBRATION;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { void workoutRecorder.refresh(); }, []);
  useEffect(() => {
    let live = true;
    const load = async (): Promise<WorkoutCalibration> => {
      const empty = { ...EMPTY_CALIBRATION, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
      try {
        if (source === "demo") return empty;
        const ctx = queryCtx();
        // Use an actual recorded resting HR, never workoutSetup's fallback default.
        const rows = (await ctx.store.allMetrics()).filter((m) => m.day <= ctx.today && m.rhrBpm !== null).sort((a, b) => b.day.localeCompare(a.day));
        const recent = rows[0];
        const ageMs = recent ? Date.parse(ctx.today + "T00:00:00Z") - Date.parse(recent.day + "T00:00:00Z") : Infinity;
        return { restingHr: ageMs <= 7 * 86_400_000 ? recent?.rhrBpm ?? null : null, maxHr: maxHrOf(ctx), sex: ctx.profile.sex === "male" || ctx.profile.sex === "female" ? ctx.profile.sex : null, estimatedMaxHr: ctx.profile.maxHr == null, timeZone: ctx.timeZone };
      } catch { return empty; }
    };
    void load().then((value) => { if (live) setCalibration({ profile, source, value }); });
    return () => { live = false; };
  }, [profile, source]);
  const session = state.viewed;
  const summary = useMemo(() => session ? summarizeWorkout(session, state.samples) : null, [session, state.samples]);
  const fresh = state.active?.status === "recording" && state.active.link === "live" && state.active.lastSampleAt !== null && now - state.active.lastSampleAt >= 0 && now - state.active.lastSampleAt < 10_000;
  const bpm = state.active ? fresh ? state.active.lastBpm : null : summary?.avgHr ?? null;
  const maxHr = session?.maxHr ?? calibration.maxHr;
  const zone = bpm !== null && maxHr ? zoneOf(bpm, zonesOf(maxHr)) : null;
  const finish = () => Alert.alert(t("recorder.finish"), t("recorder.finishBody"), [
    { text: t("recorder.keepRecording"), style: "cancel" },
    { text: t("recorder.finish"), onPress: () => void workoutRecorder.command("finish") },
  ]);
  const status = state.active?.status;
  const controls = state.active ? (
    <View className="gap-3">
      <Text className="text-center text-sm text-foreground-secondary">{t(status === "paused" ? "recorder.status.paused" : status === "interrupted" ? "recorder.status.interrupted" : "recorder.status.recording")}</Text>
      {!!state.active.error && <Text accessibilityLiveRegion="polite" className="text-sm text-warning-text">{t(`recorder.errors.${state.active.error}`, { defaultValue: t("recorder.errors.connectionLost") })}</Text>}
      <View className="flex-row gap-3">
        <Button className="flex-1" variant="secondary" disabled={state.busy} onPress={() => void workoutRecorder.command(status === "recording" ? "pause" : "resume")}>
          {t(status === "recording" ? "recorder.pause" : "recorder.resume")}
        </Button>
        <Button className="flex-1" disabled={state.busy} onPress={finish}>{t("recorder.finish")}</Button>
      </View>
      {status === "recording" && state.active.link === "lost" && <Button variant="secondary" disabled={state.busy} onPress={() => void workoutRecorder.command("resume")}>{t("recorder.reconnect")}</Button>}
      <Text className="text-xs leading-5 text-muted-foreground">{t("recorder.backgroundHint")}</Text>
    </View>
  ) : (
    <View className="gap-3">
      {session && <Button variant="secondary" onPress={() => workoutRecorder.view(null)}>{t("recorder.newWorkout")}</Button>}
      {!session && <>
        <View className="flex-row flex-wrap gap-2">
          {WORKOUT_TYPES.map((key) => <Button key={key} variant={key === type ? "default" : "secondary"} onPress={() => setType(key)}>{t(`recorder.types.${key}`)}</Button>)}
        </View>
        <Text className="text-sm leading-6 text-foreground-secondary">{t("recorder.sharingHint")}</Text>
        {band.status === "live" ? <Text className="text-sm text-optimal">{band.device?.name ?? t("recorder.sensor")}</Text> : <>
          <Button variant="secondary" onPress={() => void band.scan()} disabled={band.status === "scanning" || state.busy}>
            {t(band.status === "scanning" ? "recorder.scanning" : "recorder.findSensor")}
          </Button>
          {band.found.map((device) => <Button key={device.id} variant="secondary" onPress={() => void band.connect(device.id)}>{device.name ?? t("recorder.sensor")}</Button>)}
          {band.remembered && !band.found.some((d) => d.id === band.remembered?.id) && <Button variant="secondary" onPress={() => void band.connect(band.remembered!.id)}>{band.remembered.name ?? t("recorder.sensor")}</Button>}
          {!!band.error && <Text className="text-sm text-warning-text">{band.error}</Text>}
        </>}
        <Button disabled={state.busy || state.loading || !workoutNativeAvailable || band.status !== "live"} onPress={() => void workoutRecorder.start(type, calibration)}>{state.busy ? t("recorder.saving") : t("recorder.start")}</Button>
        {!workoutNativeAvailable && <Text className="text-sm text-warning-text">{t("recorder.errors.nativeUnavailable")}</Text>}
        {(calibration.restingHr === null || calibration.maxHr === null) && <Text className="text-xs leading-5 text-muted-foreground">{t("recorder.calibrationHint")}</Text>}
      </>}
    </View>
  );
  const statistics = summary && (
    <SectionShell key="stats" variant="card" title={t("recorder.summary")}>
      <View className="flex-row flex-wrap gap-y-4">
        <Stat label={t("recorder.duration")} value={clockDuration(summary.activeMs)} />
        <Stat label={t("recorder.cardioLoad")} value={summary.load.value === null ? "—" : summary.load.value.toFixed(1)} />
        <Stat label={t("recorder.average")} value={number(summary.avgHr)} />
        <Stat label={t("recorder.maximum")} value={number(summary.maxHr)} />
      </View>
      <Text className="mt-4 text-xs leading-5 text-muted-foreground">{t("recorder.loadHint")}</Text>
      <Text className="mt-2 text-xs text-muted-foreground">{t("recorder.coverage", { observed: clockDuration(summary.observedMs), active: clockDuration(summary.activeMs) })}</Text>
      {summary.load.value === null && <Text className="mt-2 text-xs text-warning-text">{t("recorder.calibrationHint")}</Text>}
      {summary.load.provisional && summary.load.value !== null && <Text className="mt-2 text-xs text-muted-foreground">{t("recorder.provisional")}</Text>}
    </SectionShell>
  );
  return <WorkoutShell tab={tab}
    title={session ? t(`recorder.types.${session.type}`) : t("recorder.title")}
    subtitle={session ? new Date(session.startedAt).toLocaleString() : t("recorder.subtitle")}
    hero={<HeartRateRing bpm={bpm} maxHr={maxHr} zone={zone} active={!!state.active} />}
    primary={<View className="gap-3">
      {!!state.error && <View className="gap-2"><Text accessibilityLiveRegion="assertive" className="text-sm text-warning-text">{t(`recorder.errors.${state.error}`, { defaultValue: t("recorder.errors.commandFailed") })}</Text><Button variant="secondary" onPress={() => void workoutRecorder.refresh()}>{t("recorder.retry")}</Button></View>}
      {state.error === "notificationPermission" && <Button variant="secondary" onPress={() => void Linking.openSettings()}>{t("recorder.notificationSettings")}</Button>}
      {controls}
    </View>}
    secondary={[
      statistics,
      session && summary ? <SectionShell key="chart" variant="card" title={t("recorder.heartRate")}>
        <IntradayHrChart variant="activity" data={{ value: summary.trace.some((p) => p.bpm !== null) ? { points: summary.trace } : null, reason: summary.trace.length ? null : "no_data", provisional: !!state.active }} />
        <Text className="text-xs text-muted-foreground">{t("recorder.timelineHint")}</Text>
        <View className="mt-3 gap-2">{summary.zoneSeconds.map((seconds, index) => <View key={index} className="flex-row justify-between"><Text className="text-xs text-foreground-secondary">{t("recorder.zone", { zone: index })}</Text><Text className="font-numeric text-sm">{clockDuration(seconds * 1000)}</Text></View>)}</View>
      </SectionShell> : null,
      <SectionShell key="history" variant="card" title={t("recorder.history")}>
        {state.history.length === 0 && <Text className="text-sm text-muted-foreground">{t("recorder.emptyHistory")}</Text>}
        <View className="gap-2">{state.history.map((row) => <Button key={row.id} variant="secondary" disabled={!!state.active} onPress={() => workoutRecorder.view(row.id)}>{`${t(`recorder.types.${row.type}`)} · ${new Date(row.startedAt).toLocaleDateString()} · ${clockDuration(row.activeMs)}`}</Button>)}</View>
        {state.history.length >= 25 && <Button variant="secondary" onPress={workoutRecorder.more}>{t("recorder.loadMore")}</Button>}
      </SectionShell>,
      <SectionShell key="legacy" variant="card" title={t("recorder.coachTitle")}>
        <Text className="mb-3 text-sm text-foreground-secondary">{t("recorder.coachHint")}</Text>
        <Button variant="secondary" onPress={() => push("/workout-coach")}>{t("recorder.openCoach")}</Button>
      </SectionShell>,
    ].filter((node) => node !== null)}
  />;
}

function WorkoutShell({ tab, ...props }: DetailShellProps & { tab: boolean }) {
  if (!tab) return <DetailShell {...props} />;
  return <PageShell title={i18n.t("workouts:tab")}>
    <View className="gap-8">
      <Text className="text-center text-sm text-foreground-secondary">{props.subtitle}</Text>
      {props.hero}
      {props.primary}
      <View className="gap-3">{props.secondary}</View>
    </View>
  </PageShell>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View className="w-1/2"><Text className="text-xs text-muted-foreground">{label}</Text><Text className="font-numeric text-3xl font-bold">{value}</Text></View>;
}
function HeartRateRing({ bpm, maxHr, zone, active }: { bpm: number | null; maxHr: number | null; zone: number | null; active: boolean }) {
  const { c } = useTheme();
  const ratio = bpm !== null && maxHr ? Math.min(1, bpm / maxHr) : 0;
  const circumference = 2 * Math.PI * 92;
  return <View className="items-center gap-2 py-5" accessibilityLabel={i18n.t("workouts:recorder.hrAccessibility", { bpm: number(bpm) })}>
    <View className="size-[220px] items-center justify-center">
      <Svg width={220} height={220} style={{ position: "absolute" }}>
        <Circle cx={110} cy={110} r={92} fill="none" stroke={c.border} strokeWidth={10} />
        <Circle cx={110} cy={110} r={92} fill="none" stroke={c.strain} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - ratio)} rotation={-90} origin="110,110" />
      </Svg>
      <Text className="text-xs font-bold uppercase tracking-widest text-foreground-secondary">{i18n.t(active ? "workouts:recorder.liveHr" : "workouts:recorder.heartRate")}</Text>
      <Text className="font-numeric text-[64px] leading-[72px] font-bold">{number(bpm)}</Text>
      <Text className="text-sm text-muted-foreground">{i18n.t("workouts:recorder.bpm")}</Text>
    </View>
    <Text className="text-sm text-foreground-secondary">{zone === null ? i18n.t("workouts:recorder.waiting") : i18n.t("workouts:recorder.zone", { zone })}</Text>
  </View>;
}
