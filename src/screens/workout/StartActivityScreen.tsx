// Start an activity `/workout/start` (docs/workout-tracker/whoop-ui.md § Pre-start, reference/prestart-android.jpg):
// X, the sport and a caret over a dark blue gradient; the live heart rate in a blue bubble that beats with it; a white
// sheet with the Strain Target row and the START ACTIVITY pill. The caret opens the picker.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Linking, ScrollView, TextInput, useWindowDimensions, View } from "react-native";
import { Switch } from "@/screens/settings/controls";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Heart, Search, X } from "lucide-react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { arcPath } from "@/ui/charts/geometry";
import { Gradient } from "@/ui/Gradient";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { queryCtx, useApp } from "@/state/app";
import { useLiveBle } from "@/state/liveBle";
import { workoutRecorder } from "@/live/workoutRecorder";
import { WORKOUT_TYPES, type WorkoutType } from "@/live/workout";
import { loadWorkoutStart, type WorkoutStart } from "@/live/workoutStart";
import { exerciseWriteAllowed } from "@/health/connect";
import { haptic } from "@/ui/haptics";
import { zonePosition } from "@/live/activityView";
import { workoutNativeAvailable } from "../../../modules/pulse-workouts";
import { useTheme } from "@/ui/theme";
import { cn } from "@/ui/cn";
import { ACTIVITY_GLYPH, activityName, CAPS, usePulse } from "./activityKit";

export function StartActivityScreen() {
  const { t } = useTranslation("workouts");
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const state = useSyncExternalStore(workoutRecorder.subscribe, workoutRecorder.getSnapshot, workoutRecorder.getSnapshot);
  const band = useLiveBle();
  const profile = useApp((s) => s.profile);
  const recent = useMemo(() => [...new Set(state.history.map((w) => w.type))].slice(0, 4), [state.history]);
  // The last sport by default, as WHOOP opens on the most recent one.
  const [picked, setPicked] = useState<WorkoutType | null>(null);
  const type = picked ?? recent[0] ?? "walk";
  const [picking, setPicking] = useState(false);
  const [targetOn, setTargetOn] = useState(true);
  const [start, setStart] = useState<WorkoutStart | null>(null);
  // From the tap until the recorder answers (the Health Connect sheet comes first): a second tap does nothing. The ref
  // closes it within one frame (two taps can both see the state before it re-renders); the state dims the button.
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const live = band.status === "live" && band.bpm !== null;
  const scale = usePulse(live ? band.bpm : null);
  const { c } = useTheme();

  useEffect(() => { void workoutRecorder.refresh(); }, []);
  useEffect(() => {
    let on = true;
    void loadWorkoutStart(queryCtx()).then((s) => { if (on) setStart(s); }).catch(() => {});
    return () => { on = false; };
  }, [profile]);
  // A workout already running opens on its live screen, as WHOOP's app locks to it.
  useEffect(() => { if (state.active) router.replace("/workout/live" as Href); }, [state.active]);

  const begin = async () => {
    if (!start || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      // Asked here, while a screen is open, so Finish can save the workout to Health Connect; recording works without it.
      await exerciseWriteAllowed(true);
      // The state.active effect above opens the live screen, and only while this screen is still up.
      if (await workoutRecorder.start(type, { ...start, target: targetOn ? start.target : null })) haptic.success();
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };
  const halo = width * 0.56;
  const disc = width * 0.33;
  const Glyph = ACTIVITY_GLYPH[type];
  const target = start?.target ?? null;

  const ready = live && !!start && !state.busy && !starting && workoutNativeAvailable;
  return (
    <View className="flex-1 bg-background">
      <Gradient from={c["strain-band-4"]} to={c.background} angle="y" />
      {/* Header: X, the sport and its caret (the picker). */}
      <View className="bg-background" style={{ paddingTop: insets.top }}>
        <View className="h-16 flex-row items-center px-4">
          <Press accessibilityRole="button" accessibilityLabel={t("start.close")} onPress={() => router.back()} hitSlop={12} className="mr-5">
            <X size={28} color={c.foreground} strokeWidth={2} />
          </Press>
          <Press accessibilityRole="button" accessibilityLabel={t("start.choose", { name: activityName(type) })} onPress={() => setPicking((p) => !p)} className="flex-1 flex-row items-center">
            <Glyph size={26} color={c.foreground} strokeWidth={2} />
            <Text className={cn("ml-3 flex-1 text-[15px] text-foreground", CAPS)}>{activityName(type)}</Text>
            {picking ? <ChevronUp size={24} color={c.foreground} /> : <ChevronDown size={24} color={c.foreground} />}
          </Press>
        </View>
      </View>

      {picking ? (
        <Picker type={type} recent={recent} onPick={(k) => { setPicked(k); setPicking(false); }} />
      ) : (
        <>
          {/* The heart-rate bubble: a translucent halo and the solid disc, beating with the heart. */}
          <View className="flex-1 items-center justify-center">
            <Animated.View className="items-center justify-center bg-strain/20" style={{ width: halo, height: halo, borderRadius: halo / 2, transform: [{ scale }] }}>
              <View className="items-center justify-center bg-strain" style={{ width: disc, height: disc, borderRadius: disc / 2 }} accessibilityLabel={live ? t("start.bpmA11y", { bpm: band.bpm }) : t("start.noBpm")}>
                <Heart size={22} color={c["on-strain"]} fill={c["on-strain"]} />
                <Text className="font-numeric font-bold text-on-strain" style={{ fontSize: disc * 0.36, lineHeight: disc * 0.42 }}>{live ? band.bpm : "--"}</Text>
                {/* The zone, as the live Heart Rate tab's disc shows it. */}
                {live && start && <Text className="text-[13px] font-semibold text-on-strain/80">{t("live.zone", { zone: zonePosition(band.bpm!, start.strainSetup.maxHr).zone })}</Text>}
              </View>
            </Animated.View>
            {!live && <Connect band={band} />}
          </View>

          {/* The sheet, on Pulse's card: the Strain Target row, then START ACTIVITY. */}
          <View className="rounded-t-3xl bg-card" style={{ paddingBottom: insets.bottom + 16 }}>
            <View className="items-center pt-2.5"><View className="h-1 w-10 rounded-full bg-foreground/20" /></View>
            <View className="mx-4 mt-3 h-16 flex-row items-center rounded-2xl bg-secondary px-4">
              <TargetRing value={target?.[0] ?? null} on={targetOn} />
              <View className="ml-3 flex-1">
                <Text className={cn("text-[12px] text-muted-foreground", CAPS)}>{t("start.strainTarget")}</Text>
                <Text className="font-numeric text-[20px] font-bold leading-6 tabular-nums text-foreground">{target ? `${Math.round(target[0])}–${Math.round(target[1])}%` : "--"}</Text>
              </View>
              <Switch value={targetOn && !!target} disabled={!target} onValueChange={setTargetOn} label={t("start.strainTarget")} />
            </View>
            <View className="px-4 pt-4">
              {!!state.error && <Text accessibilityLiveRegion="assertive" className="mb-3 text-center text-[13px] text-destructive">{t(`recorder.errors.${state.error}`, { defaultValue: t("recorder.errors.commandFailed") })}</Text>}
              {state.error === "notificationPermission" && <Press onPress={() => void Linking.openSettings()} className="mb-3 items-center"><Text className={cn("text-[12px] text-strain", CAPS)}>{t("recorder.notificationSettings")}</Text></Press>}
              <Press accessibilityRole="button" disabled={!ready} onPress={() => void begin()} className={cn("h-14 items-center justify-center rounded-full bg-strain", !ready && "opacity-45")}>
                <Text className={cn("text-[14px] text-on-strain", CAPS)}>{t(state.busy ? "start.starting" : "start.start")}</Text>
              </Press>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

/** The small ring left of the target value: filled to the target's low end, WHOOP's partial ring. */
function TargetRing({ value, on }: { value: number | null; on: boolean }) {
  const { c } = useTheme();
  const r = 11;
  const share = value !== null && on ? Math.min(1, value / 100) : 0;
  return (
    <Svg width={28} height={28}>
      <Circle cx={14} cy={14} r={r} stroke={c["dial-track"]} strokeWidth={2.5} fill="none" />
      {share > 0 && <Path d={arcPath(14, 14, r, 0, share * 359.9)} stroke={c.strain} strokeWidth={2.5} fill="none" />}
    </Svg>
  );
}

/** Without a live band: find it, or tap a remembered or found one (the bubble's "--" says why). */
function Connect({ band }: { band: ReturnType<typeof useLiveBle> }) {
  const { t } = useTranslation("workouts");
  const known = [band.remembered, ...band.found].filter((d, i, all): d is NonNullable<typeof d> => !!d && all.findIndex((x) => x?.id === d.id) === i);
  const busy = band.status === "connecting" || band.status === "scanning";
  return (
    <View className="mt-8 w-full items-center gap-3 px-8">
      <Text className="text-center text-[13px] leading-5 text-muted-foreground">{band.status === "connecting" ? t("start.connecting") : t("recorder.sharingHint")}</Text>
      {known.map((d) => (
        <Press key={d.id} accessibilityRole="button" disabled={busy} onPress={() => void band.connect(d.id)} className={cn("h-11 w-full items-center justify-center rounded-full border border-foreground", busy && "opacity-50")}>
          <Text className={cn("text-[13px] text-foreground", CAPS)}>{d.name ?? t("recorder.sensor")}</Text>
        </Press>
      ))}
      <Press accessibilityRole="button" disabled={busy} onPress={() => void band.scan()} className="h-11 items-center justify-center px-4">
        <Text className={cn("text-[13px] text-strain", CAPS)}>{t(band.status === "scanning" ? "recorder.scanning" : "recorder.findSensor")}</Text>
      </Press>
      {!!band.error && <Text className="text-center text-[13px] text-destructive">{band.error}</Text>}
    </View>
  );
}

/** The sport list under the header (reference/picker-android.jpg): search, MOST RECENT, ALL A-Z. */
function Picker({ type, recent, onPick }: { type: WorkoutType; recent: WorkoutType[]; onPick: (t: WorkoutType) => void }) {
  const { t } = useTranslation("workouts");
  const { c } = useTheme();
  const [q, setQ] = useState("");
  const all = [...WORKOUT_TYPES].sort((a, b) => activityName(a).localeCompare(activityName(b)));
  const match = (k: WorkoutType) => activityName(k).toLowerCase().includes(q.trim().toLowerCase());
  return (
    <ScrollView className="flex-1 bg-background" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View className="mx-4 mt-3 h-11 flex-row items-center rounded-xl bg-card px-3">
        <Search size={18} color={c["muted-foreground"]} />
        <TextInput value={q} onChangeText={setQ} placeholder={t("start.search")} placeholderTextColor={c["muted-foreground"]} className="ml-2 flex-1 text-[16px] text-foreground" accessibilityLabel={t("start.search")} />
      </View>
      {!q && recent.length > 0 && <><PickerHeading label={t("start.recent")} />{recent.map((k) => <PickerRow key={`r-${k}`} k={k} on={k === type} onPick={onPick} />)}</>}
      <PickerHeading label={t("start.all")} />
      {all.filter(match).map((k) => <PickerRow key={k} k={k} on={k === type} onPick={onPick} />)}
    </ScrollView>
  );
}

function PickerRow({ k, on, onPick }: { k: WorkoutType; on: boolean; onPick: (t: WorkoutType) => void }) {
  const { c } = useTheme();
  const Glyph = ACTIVITY_GLYPH[k];
  return (
    <Press accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onPick(k)} className="h-14 flex-row items-center px-5">
      <View className="w-9 items-center"><Glyph size={24} color={on ? c.strain : c.foreground} strokeWidth={2} /></View>
      <Text className={cn("ml-4 text-[14px]", CAPS, on ? "text-strain" : "text-foreground")}>{activityName(k)}</Text>
    </Press>
  );
}

function PickerHeading({ label }: { label: string }) {
  return (
    <View className="mt-3 flex-row items-center px-5">
      <Text className={cn("text-[11px] text-muted-foreground", CAPS)}>{label}</Text>
      <View className="ml-3 h-px flex-1 bg-border" />
    </View>
  );
}
