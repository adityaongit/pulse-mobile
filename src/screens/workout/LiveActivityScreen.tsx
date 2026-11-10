// A running activity `/workout/live` (docs/workout-tracker/whoop-ui.md § Live). WHOOP's flow in Pulse's own look: the
// title and elapsed time over ACTIVITY STRAIN and HEART RATE tabs (WHOOP's newest live screen, its Strength Trainer
// session), the dial drawn as Home's (gap at the top, the Strain Target as a band with its tick), the heart rate, stats
// and time in zones in cards, and Pause / Finish as pills at the foot. The recorder (src/live/workoutRecorder.ts) owns
// the recording; this screen only reads it, so leaving or locking never stops anything.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BackHandler, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronDown, Ellipsis, Flame, Heart, Pause, PersonStanding } from "lucide-react-native";
import { haptic } from "@/ui/haptics";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { zonesOf } from "@/core/engine/strain";
import { markerSlices, ringShare } from "@/lib/charts";
import { arcPath, polar } from "@/ui/charts/geometry";
import { ZoneBars, type ZoneRow } from "@/ui/charts/ZoneBars";
import { CARD_CLASS } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Mark } from "@/ui/brand";
import { ARC_FROM, ARC_SWEEP } from "@/ui/metrics/MiniRing";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { UserAvatar } from "@/ui/shells/UserAvatar";
import { ConfirmDialog } from "@/screens/settings/controls";
import { useApp } from "@/state/app";
import { i18n } from "@/i18n/config";
import { workoutRecorder } from "@/live/workoutRecorder";
import { activityView, strainWord, zonePosition, type ActivityStrainSetup } from "@/live/activityView";
import type { RecordedWorkout, WorkoutSample } from "@/live/workout";
import { MIN_EXERCISE_SEC } from "@/health/exerciseDedup";
import { activityName, barClock, CAPS, ZoneBar } from "./activityKit";

/** The bpm on screen counts as current this long after the last beat. */
const FRESH_MS = 10_000;
/** The HEART RATE tab's line covers the last 5 minutes. */
const LINE_MS = 5 * 60_000;
/** Home's large dial: 17 px of ring on a 256 px ring (ScoreDial `lg`). */
const RING_SHARE = 17 / 256;

/** The dial's Strain setup: the one kept at Start, else (an older session) the calibration with no day base. */
export function strainSetupOf(s: RecordedWorkout): ActivityStrainSetup {
  return s.strainSetup ?? { restingHr: s.restingHr ?? 60, maxHr: s.maxHr ?? 190, base: null, sex: s.sex ?? "male" };
}

/** Zone rows 5 down to 0 with their bpm ranges on `maxHr`, as the activity detail lists them. */
export function zoneRows(maxHr: number, seconds: number[]): ZoneRow[] {
  const z = zonesOf(maxHr).lowest;
  return [0, 1, 2, 3, 4, 5].map((k) => ({
    zone: k,
    label: i18n.t("workouts:live.zone", { zone: k }),
    min: k === 0 ? 0 : z[k - 1],
    max: k === 5 ? null : z[k] - 1,
    seconds: seconds[k] ?? 0,
  }));
}

export function LiveActivityScreen() {
  const { t } = useTranslation("workouts");
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const state = useSyncExternalStore(workoutRecorder.subscribe, workoutRecorder.getSnapshot, workoutRecorder.getSnapshot);
  const [tab, setTab] = useState<"strain" | "hr">("strain");
  const [now, setNow] = useState(() => Date.now());
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const [ask, setAsk] = useState<"finish" | "discard" | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { void workoutRecorder.refresh(); }, []);
  const session = state.active;
  // Finished or discarded (here or from the notification): on to the activity, or Home.
  useEffect(() => {
    if (session || state.loading) return;
    router.replace((finishedId ? `/workout/${finishedId}` : "/(tabs)") as Href);
  }, [session, state.loading, finishedId]);
  // Back, like the chevron, leaves the screen; the workout keeps recording (the notification brings it back).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { router.replace("/(tabs)" as Href); return true; });
    return () => sub.remove();
  }, []);

  const view = useMemo(() => (session ? activityView(state.samples, strainSetupOf(session), session.body ?? null) : null), [session, state.samples]);
  if (!session || !view) return <View className="flex-1 bg-background" />;

  const paused = session.status !== "recording";
  const fresh = !paused && session.link === "live" && session.lastSampleAt !== null && now - session.lastSampleAt < FRESH_MS;
  const bpm = fresh ? session.lastBpm : null;
  const maxHr = strainSetupOf(session).maxHr;
  const toggle = () => { haptic.toggle(paused); void workoutRecorder.command(paused ? "resume" : "pause"); };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header: minimise (the workout keeps recording), the activity and its time, the menu (Discard). */}
      <View className="h-16 flex-row items-center px-2">
        <Press accessibilityRole="button" accessibilityLabel={t("live.minimise")} onPress={() => router.replace("/(tabs)" as Href)} hitSlop={8} className="size-11 items-center justify-center">
          <ChevronDown size={26} color={c.foreground} strokeWidth={2} />
        </Press>
        {/* The time is the headline, as WHOOP's bar has it; the activity sits small above it. */}
        <View className="flex-1 items-center">
          <Text className={cn("text-[12px] text-muted-foreground", CAPS)}>{paused ? t("live.pausedName", { name: activityName(session.type) }) : activityName(session.type)}</Text>
          <Text className={cn("font-numeric text-[24px] font-bold leading-7 tabular-nums", paused ? "text-warning-text" : "text-foreground")}>{barClock(session.activeMs)}</Text>
        </View>
        <Press accessibilityRole="button" accessibilityLabel={t("live.discard")} onPress={() => setAsk("discard")} hitSlop={8} className="size-11 items-center justify-center">
          <Ellipsis size={24} color={c.foreground} strokeWidth={2} />
        </Press>
      </View>

      {/* Tabs: ACTIVITY STRAIN, HEART RATE. */}
      <View className="flex-row border-b border-border" accessibilityRole="tablist">
        {(["strain", "hr"] as const).map((k) => (
          <Press key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} className="h-11 flex-1 items-center justify-end">
            <Text numberOfLines={1} adjustsFontSizeToFit className={cn("mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.06em]", tab === k ? "text-foreground" : "text-muted-foreground")}>{t(k === "strain" ? "live.tabStrain" : "live.tabHr")}</Text>
            <View className={cn("h-0.5 w-2/3 rounded-full", tab === k ? "bg-foreground" : "bg-transparent")} />
          </Press>
        ))}
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-3 px-4 pb-6 pt-5" showsVerticalScrollIndicator={false}>
        {tab === "strain" ? (
          <>
            <View className="items-center pb-2">
              <StrainDial view={view} target={session.target ?? null} paused={paused} />
            </View>
            <HeartRateCard bpm={bpm} maxHr={maxHr} />
            <StatsCard items={[
              { icon: "heart", label: t("live.avgHr"), value: view.avgHr },
              { icon: "maxHeart", label: t("live.maxHr"), value: view.maxHr },
              { icon: "flame", label: t("live.calories"), value: view.kcal },
            ]} />
          </>
        ) : (
          <>
            <View className={cn(CARD_CLASS, "items-center pt-5")}>
              <HrDisc bpm={bpm} maxHr={maxHr} />
              <HrLine samples={state.samples} />
            </View>
            <StatsCard items={[
              { icon: "heart", label: t("live.avgHr"), value: view.avgHr },
              { icon: "strain", label: t("live.strain"), value: Math.round(view.activityStrain), unit: "%" },
              { icon: "flame", label: t("live.calories"), value: view.kcal },
            ]} />
            <View className={cn(CARD_CLASS, "px-4 pb-2 pt-4")}>
              <Text className={cn("mb-3 text-[13px] text-foreground", CAPS)}>{t("live.timeInZones")}</Text>
              <ZoneBars variant="rows" data={{ value: zoneRows(maxHr, view.zoneSeconds), reason: null, provisional: true }} />
            </View>
          </>
        )}
      </ScrollView>

      {/* The foot: Pause or Resume, and Finish. */}
      <View className="flex-row gap-3 border-t border-border px-4 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
        {!!state.error && <Text accessibilityLiveRegion="assertive" className="absolute inset-x-4 -top-7 text-center text-[13px] text-destructive">{t(`recorder.errors.${state.error}`, { defaultValue: t("recorder.errors.commandFailed") })}</Text>}
        <Press accessibilityRole="button" disabled={state.busy} onPress={toggle} className={cn("h-13 flex-1 items-center justify-center rounded-full", paused ? "bg-strain" : "bg-secondary", state.busy && "opacity-45")}>
          <Text className={cn("text-[14px]", CAPS, paused ? "text-on-strain" : "text-foreground")}>{t(paused ? "live.resume" : "live.pause")}</Text>
        </Press>
        <Press accessibilityRole="button" disabled={state.busy} onPress={() => setAsk("finish")} className={cn("h-13 flex-1 items-center justify-center rounded-full", paused ? "bg-secondary" : "bg-strain", state.busy && "opacity-45")}>
          <Text className={cn("text-[14px]", CAPS, paused ? "text-foreground" : "text-on-strain")}>{t("live.finish")}</Text>
        </Press>
      </View>

      {/* Under 2 minutes the import drops a workout (MIN_EXERCISE_SEC), so a short one can only be kept going or discarded. */}
      {session.activeMs < MIN_EXERCISE_SEC * 1000 ? (
        <ConfirmDialog
          open={ask === "finish"}
          title={t("live.tooShortTitle")}
          description={t("live.tooShortBody")}
          confirmLabel={t("live.discard")}
          pendingLabel={t("live.discarding")}
          pending={state.busy}
          onCancel={() => setAsk(null)}
          onConfirm={() => { setAsk(null); setFinishedId(null); void workoutRecorder.discard(session.id); }}
        />
      ) : (
        <ConfirmDialog
          open={ask === "finish"}
          title={t("live.finishTitle")}
          description={t("live.finishBody")}
          confirmLabel={t("live.finish")}
          pendingLabel={t("live.finishing")}
          pending={state.busy}
          confirmVariant="primary"
          onCancel={() => setAsk(null)}
          onConfirm={() => { setAsk(null); haptic.success(); setFinishedId(session.id); void workoutRecorder.command("finish"); }}
        />
      )}
      <ConfirmDialog
        open={ask === "discard"}
        title={t("live.discardTitle")}
        description={t("live.discardBody")}
        confirmLabel={t("live.discard")}
        pendingLabel={t("live.discarding")}
        pending={state.busy}
        onCancel={() => setAsk(null)}
        onConfirm={() => { setAsk(null); setFinishedId(null); void workoutRecorder.discard(session.id); }}
      />
    </View>
  );
}

/**
 * The ACTIVITY STRAIN dial on Home's geometry (ScoreDial `lg`: arcs from ARC_FROM, the gap at the top, the Strain
 * Target as a band on the track with its white tick): the day's Strain as a muted arc ending at the owner's marker, and
 * this activity's Strain over it in Strain blue. Percent scale: the ring is full at 100.
 */
function StrainDial({ view, target, paused }: { view: ReturnType<typeof activityView>; target: [number, number] | null; paused: boolean }) {
  const { t } = useTranslation("workouts");
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const d = Math.min(width * 0.72, 300);
  const ring = d * RING_SHARE;
  const rad = d / 2;
  const fillR = rad - ring / 2 - d * 0.035;
  const at = (pct: number) => ARC_FROM + ARC_SWEEP * ringShare(pct, 100);
  const tick = target ? markerSlices((target[0] + target[1]) / 2, 100, 1) : null;
  const marker = polar(rad, rad, fillR, at(view.dayNow));
  const word = strainWord(view.activityStrain, view.dayNow, target);
  const disc = ring * 1.9;
  return (
    <View style={{ width: d, height: d }} accessible accessibilityRole="image" accessibilityLabel={t("live.dialA11y", { strain: Math.round(view.activityStrain), day: Math.round(view.dayNow) })}>
      <Svg width={d} height={d}>
        <Path d={arcPath(rad, rad, fillR, ARC_FROM, ARC_FROM + ARC_SWEEP)} stroke={c["dial-track"]} strokeWidth={ring - 0.5} fill="none" />
        {target && <Path d={arcPath(rad, rad, fillR, at(target[0]), at(target[1]))} stroke={c["dial-target"]} strokeWidth={ring - 0.5} fill="none" />}
        {view.dayNow > 0 && <Path d={arcPath(rad, rad, fillR, ARC_FROM, at(view.dayNow))} stroke={c["muted-foreground"]} strokeOpacity={0.45} strokeWidth={ring} fill="none" />}
        {view.activityStrain > 0 && <Path d={arcPath(rad, rad, fillR, ARC_FROM, at(view.activityStrain))} stroke={c.strain} strokeWidth={ring} fill="none" />}
        {tick && <Path d={arcPath(rad, rad, fillR, at(tick[0]), at(tick[0] + tick[1]))} stroke={c.foreground} strokeWidth={ring} fill="none" />}
      </Svg>
      {/* The owner on the ring where the day's Strain is: their photo or initials, else Pulse's mark. */}
      <View className="absolute items-center justify-center overflow-hidden rounded-full border-2 border-background bg-card" style={{ width: disc, height: disc, left: marker.x - disc / 2, top: marker.y - disc / 2 }}>
        <Marker size={disc - 4} />
      </View>
      <View pointerEvents="none" className="absolute inset-0 items-center justify-center px-10">
        {paused ? (
          <>
            <Pause size={d * 0.09} color={c["warning-text"]} fill={c["warning-text"]} />
            <Text className={cn("mt-3 text-center text-[13px] text-warning-text", CAPS)}>{t("live.pausedDial")}</Text>
            <Text className="mt-1 text-center text-[13px] text-muted-foreground">{t("live.strainSoFar", { strain: Math.round(view.activityStrain) })}</Text>
          </>
        ) : (
          <>
            <Text className={cn("text-[12px] text-muted-foreground", CAPS)}>{t("live.activityStrain")}</Text>
            <Text className="font-numeric font-bold tabular-nums text-foreground" style={{ fontSize: d * 0.22, lineHeight: d * 0.25 }}>
              {Math.round(view.activityStrain)}<Text className="font-numeric font-bold text-foreground" style={{ fontSize: d * 0.08 }}>%</Text>
            </Text>
            <Text className={cn("text-[12px]", CAPS, word === "optimal" ? "text-optimal-text" : word === "overreaching" ? "text-warning-text" : "text-muted-foreground")}>{t(`live.word.${word}`)}</Text>
            <Text className="mt-1 text-[12px] text-muted-foreground">{t("live.dayStrain", { strain: Math.round(view.dayNow) })}</Text>
          </>
        )}
      </View>
    </View>
  );
}

function Marker({ size }: { size: number }) {
  const hasFace = useApp((s) => !!(s.profile?.photo || s.profile?.name));
  return hasFace ? <UserAvatar size={size} /> : <Mark size={size * 0.7} />;
}

/** The heart rate in a card: the label, the bpm and the zone bar. */
function HeartRateCard({ bpm, maxHr }: { bpm: number | null; maxHr: number }) {
  const { t } = useTranslation("workouts");
  const { c } = useTheme();
  return (
    <View className={cn(CARD_CLASS, "gap-3 px-4 pb-4 pt-4")}>
      <View className="flex-row items-center gap-2">
        <Heart size={16} color={c["recovery-red"]} fill={c["recovery-red"]} />
        <Text className={cn("text-[13px] text-foreground", CAPS)}>{t("live.heartRate")}</Text>
      </View>
      <Text className="font-numeric text-[40px] font-bold leading-[44px] tabular-nums text-foreground">
        {bpm ?? "--"}<Text className="text-[15px] font-semibold text-muted-foreground"> {t("live.bpm")}</Text>
      </Text>
      <ZoneBar bpm={bpm} maxHr={maxHr} />
    </View>
  );
}

/** The HEART RATE tab's disc: the bpm and its zone in a dark circle inside a faint halo. */
function HrDisc({ bpm, maxHr }: { bpm: number | null; maxHr: number }) {
  const { t } = useTranslation("workouts");
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const halo = width * 0.46;
  const disc = width * 0.34;
  return (
    <View className="items-center justify-center rounded-full bg-foreground/5" style={{ width: halo, height: halo }}>
      <View className="items-center justify-center rounded-full bg-background" style={{ width: disc, height: disc }}>
        <Heart size={20} color={c["recovery-red"]} fill={c["recovery-red"]} />
        <Text className="font-numeric font-bold tabular-nums text-foreground" style={{ fontSize: disc * 0.32, lineHeight: disc * 0.38 }}>{bpm ?? "--"}</Text>
        {bpm !== null && <Text className="text-[13px] font-semibold text-muted-foreground">{t("live.zone", { zone: zonePosition(bpm, maxHr).zone })}</Text>}
      </View>
    </View>
  );
}

/** The last minutes of heart rate as one line with a fill fading down, no axes (reference/live-android-hr.jpg). */
function HrLine({ samples }: { samples: WorkoutSample[] }) {
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const w = width - 32;
  const h = 140;
  const last = samples.at(-1);
  const recent = last ? samples.filter((s) => s.elapsedMs >= last.elapsedMs - LINE_MS) : [];
  if (recent.length < 2) return <View style={{ height: h }} />;
  // The last 5 minutes, or the whole workout while it is shorter: the line always spans the width.
  const t0 = Math.max(last!.elapsedMs - LINE_MS, recent[0].elapsedMs);
  const span = Math.max(1, last!.elapsedMs - t0);
  const lo = Math.min(...recent.map((s) => s.bpm)) - 5;
  const hi = Math.max(...recent.map((s) => s.bpm)) + 5;
  const x = (s: WorkoutSample) => ((s.elapsedMs - t0) / span) * w;
  const y = (s: WorkoutSample) => h - ((s.bpm - lo) / Math.max(1, hi - lo)) * (h - 8);
  // A pause or a reconnect (a new epoch) breaks the line rather than joining across it.
  const line = recent.map((s, i) => `${i === 0 || s.epoch !== recent[i - 1].epoch ? "M" : "L"}${x(s).toFixed(1)},${y(s).toFixed(1)}`).join("");
  const area = `${line}L${x(last!).toFixed(1)},${h}L${x(recent[0]).toFixed(1)},${h}Z`;
  return (
    <Svg width={w} height={h} style={{ marginTop: 16 }}>
      <Defs>
        <LinearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.strain} stopOpacity={0.35} />
          <Stop offset="1" stopColor={c.strain} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#hrFill)" />
      <Path d={line} stroke={c.strain} strokeWidth={2} fill="none" />
    </Svg>
  );
}

type StatIcon = "heart" | "maxHeart" | "flame" | "strain";
/** Three columns in a card, split by hairlines: an icon, a caps label and the number. */
function StatsCard({ items }: { items: { icon: StatIcon; label: string; value: number | null; text?: string; unit?: string }[] }) {
  const { c } = useTheme();
  const tone = c["muted-foreground"];
  const glyph = (k: StatIcon) =>
    k === "heart" ? <Heart size={18} color={tone} fill={tone} />
    : k === "flame" ? <Flame size={18} color={tone} fill={tone} />
    : k === "strain" ? <PersonStanding size={18} color={tone} />
    : <View className="flex-row items-end"><Heart size={18} color={tone} fill={tone} /><ArrowUp size={12} color={tone} strokeWidth={2.5} /></View>;
  return (
    <View className={cn(CARD_CLASS, "flex-row py-4")}>
      {items.map((it, i) => (
        <View key={it.label} className={cn("flex-1 gap-2 px-4", i > 0 && "border-l border-border")}>
          {glyph(it.icon)}
          <Text className={cn("text-[11px] text-muted-foreground", CAPS)}>{it.label}</Text>
          <Text className="font-numeric text-[28px] font-bold leading-[32px] tabular-nums text-foreground">{it.value === null ? "--" : it.text ?? `${it.value}${it.unit ?? ""}`}{it.value !== null && it.text && it.unit ? <Text className="text-[13px] font-semibold text-muted-foreground">{it.unit}</Text> : null}</Text>
        </View>
      ))}
    </View>
  );
}
