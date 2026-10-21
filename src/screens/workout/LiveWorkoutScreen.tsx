// Live workout `/workout-live` (spec §7.23), halo's src/screens/workout/LiveWorkoutScreen.tsx on Pulse's kit: Strain
// Coach on the band's live Bluetooth heart rate, from Strain's Activities card and More. While it runs: Day Strain
// building beat by beat on the app's Strain math (src/live/liveStrain.ts) on the dial against today's Strain Target,
// the current heart-rate zone, the elapsed time, and a "push" / "ease off" line from the target and the
// Recovery-gated heart-rate band (src/live/coach.ts), with optional haptic cues. Without a live band it sends the
// person to Settings › Live heart rate to connect (the go-live flow).
//
// Nothing is written to the Store or Health Connect: the real workout arrives later through the Fitbit sync and is
// scored then. A short summary stays on the phone (src/live/storage.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { Activity, HeartPulse } from "lucide-react-native";
import { i18n } from "@/i18n/config";
import { zoneNumber, zones } from "@/core/scoring/zones";
import type { LiveSample } from "@/health/ble";
import { ZONE_COLOR } from "@/lib/bands";
import { clock, dayLabel, MISSING } from "@/lib/format";
import { addDays, localDay } from "@/lib/time";
import { band as coachBand, guidance, LiveCoach, type CoachOutput, type GuidanceTone } from "@/live/coach";
import { coachCue } from "@/live/haptics";
import { KeepAwake } from "@/live/KeepAwake";
import { LiveStrain, strainOfBase, targetCrossing } from "@/live/liveStrain";
import { clockDuration, type WorkoutRecord } from "@/live/sessions";
import { COACH_HAPTICS_KEY, saveWorkout, useStoredFlag, useWorkoutLog } from "@/live/storage";
import { useCapture } from "@/live/useCapture";
import { workoutSetup, type WorkoutSetup } from "@/live/workoutSetup";
import { loadDays, maxHrOf, type QueryCtx } from "@/queries/common";
import { showsLive, useLiveBle, useLiveBleControl } from "@/state/liveBle";
import { Button } from "@/ui/Button";
import { alpha } from "@/ui/color";
import { cn } from "@/ui/cn";
import { Divided } from "@/ui/Divided";
import { Icon } from "@/ui/Icon";
import { GoLiveButton, LivePill } from "@/ui/metrics/LiveHeartRate";
import { CAPTION, ValueUnit } from "@/ui/metrics/primitives";
import { ScoreDial } from "@/ui/metrics/ScoreDial";
import { push } from "@/ui/navigate";
import type { Palette, TokenName } from "@/ui/palette";
import { DetailShell } from "@/ui/shells/DetailShell";
import type { InfoContent } from "@/ui/shells/InfoButton";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { GO_LIVE_HREF } from "@/screens/health/LiveHeartRateHero";
import { Switch } from "@/screens/settings/controls";
import { useScreen } from "@/screens/useScreen";

/** A workout shorter than this is not kept. */
const MIN_SAVE_MS = 60_000;
/** The bpm on screen counts as current this long after the last beat. */
const FRESH_MS = 10_000;

const BODY = "text-[15px] leading-[22px] text-foreground-secondary";
const ROW_TITLE = "text-[15px] font-semibold leading-5";
const NUM = "font-numeric font-bold";

const liveInfo = (): InfoContent => ({ title: i18n.t("strain:live.infoTitle"), body: i18n.t("strain:live.infoBody") });

type Session = {
  start: number;
  setup: WorkoutSetup;
  strain: LiveStrain;
  coach: LiveCoach;
  out: CoachOutput | null;
  last: { t: number; bpm: number } | null;
  /** Day Strain at the last check, for crossing the target's edges. */
  prevDay: number;
};

type Snapshot = { now: number; bpm: number | null; zone: number | null; day: number; session: number; out: CoachOutput | null; minutesToLow: number | null; zoneSeconds: number[] };

function snapshot(s: Session, now: number): Snapshot {
  const fresh = s.last && now - s.last.t < FRESH_MS ? s.last.bpm : null;
  const t = s.setup.target;
  return {
    now,
    bpm: fresh,
    zone: fresh === null ? null : s.strain.zoneOf(fresh),
    day: s.strain.dayStrain,
    session: s.strain.sessionStrain,
    out: s.out,
    minutesToLow: t ? s.strain.minutesTo(t[0], now) : null,
    zoneSeconds: s.strain.zoneSeconds.slice(),
  };
}

function record(s: Session, end: number): WorkoutRecord {
  return {
    at: s.start,
    ms: end - s.start,
    strain: s.strain.sessionStrain,
    dayStart: s.strain.dayStartStrain,
    dayEnd: s.strain.dayStrain,
    avgHr: s.strain.avgHr,
    maxHr: s.strain.maxBpm,
    zoneSeconds: s.strain.zoneSeconds.map(Math.round),
    target: s.setup.target,
  };
}

const zoneColor = (c: Palette, zone: number | null) => (zone && ZONE_COLOR[zone] ? c[ZONE_COLOR[zone] as TokenName] : c["muted-foreground"]);
/** The coach's tone: push in Strain's blue, steady green, ease off amber, waiting muted. */
const TONE: Record<GuidanceTone, { fill: TokenName; text: TokenName }> = {
  push: { fill: "strain", text: "strain-text" },
  steady: { fill: "optimal", text: "optimal-text" },
  ease: { fill: "warning", text: "warning-text" },
  wait: { fill: "muted-foreground", text: "foreground-secondary" },
};
/** Strain as a whole percent: "42%". */
const pct = (x: number) => `${Math.round(x)}%`;

const setupQuery = async (ctx: QueryCtx) => ({
  timeZone: ctx.timeZone,
  today: ctx.today,
  setup: workoutSetup(await loadDays(ctx, addDays(ctx.today, -7), ctx.today), ctx.today, maxHrOf(ctx), ctx.profile.sex),
});

export function LiveWorkoutScreen() {
  const { t } = useTranslation("strain");
  const ctl = useLiveBleControl();
  const isLive = ctl.status === "live";
  const q = useScreen(setupQuery, ["workout-live"]);
  const setup = q.data?.setup;
  const log = useWorkoutLog();
  const [haptics, setHaptics] = useStoredFlag(COACH_HAPTICS_KEY);
  const hapticsRef = useRef(haptics);
  useEffect(() => {
    hapticsRef.current = haptics;
  }, [haptics]);
  /** The workout on screen: what render needs of it (the engines stay in sessionRef, fed outside render). */
  const [active, setActive] = useState<{ start: number; setup: WorkoutSetup } | null>(null);
  const running = active !== null;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [result, setResult] = useState<WorkoutRecord | null>(null);
  const sessionRef = useRef<Session | null>(null);

  /** One coach output: buzz its cue (no push once Day Strain is in the target range) and keep it. */
  const handle = useCallback((s: Session, out: CoachOutput) => {
    s.out = out;
    const day = s.strain.dayStrain;
    const t = s.setup.target;
    const crossing = targetCrossing(s.prevDay, day, t);
    s.prevDay = day;
    if (!hapticsRef.current) return;
    if (crossing) coachCue(crossing);
    else if (out.cue === "easeOff" || (out.cue === "push" && !(t && day >= t[0]))) coachCue(out.cue);
  }, []);

  const onSample = useCallback(
    (x: LiveSample) => {
      const s = sessionRef.current;
      if (!s || !(x.bpm > 0)) return;
      if (s.strain.add(x.t, x.bpm)) s.last = { t: x.t, bpm: x.bpm };
      handle(s, s.coach.update(x.t / 1000, x.bpm));
    },
    [handle],
  );
  useCapture(running, onSample);

  // The clock: once a second the coach checks for a stalled stream and the screen redraws.
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const s = sessionRef.current;
      if (!s) return;
      const now = Date.now();
      handle(s, s.coach.update(now / 1000, null));
      setSnap(snapshot(s, now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, handle]);

  const finish = useCallback((unmounting = false) => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    const rec = record(s, Date.now());
    if (rec.ms >= MIN_SAVE_MS) void saveWorkout(rec);
    if (unmounting) return;
    setActive(null);
    setSnap(null);
    setResult(rec);
  }, []);
  // Leaving mid-workout keeps its summary.
  useEffect(() => () => finish(true), [finish]);

  const start = () => {
    if (!setup) return;
    const now = Date.now();
    const strain = new LiveStrain({ restingHr: setup.restingHr, maxHr: setup.maxHr, base: setup.base, sex: setup.sex });
    const session: Session = {
      start: now,
      setup,
      strain,
      coach: new LiveCoach({ restingHr: setup.restingHr, maxHr: setup.maxHr, recovery: setup.recovery }, now / 1000),
      out: null,
      last: null,
      prevDay: strain.dayStrain,
    };
    sessionRef.current = session;
    setResult(null);
    setSnap(snapshot(session, now));
    setActive({ start: now, setup });
  };

  const target = (active?.setup ?? setup)?.target ?? null;
  const dayValue = snap ? snap.day : setup ? strainOfBase(setup.base) : null;
  const hero = (
    <ScoreDial
      variant="strain"
      size="lg"
      label={t("live.dayStrain")}
      // Tenths, so the dial sweeps only when the shown number changes.
      value={result ? Math.round(result.dayEnd * 10) / 10 : dayValue === null ? null : Math.round(dayValue * 10) / 10}
      loading={!setup && !result}
      target={target}
      extraTags={running ? ["so_far"] : undefined}
    />
  );

  let summary: ReactNode;
  let primary: ReactNode;
  if (active && snap) {
    const a = active.setup;
    const coach = snap.out ?? { status: "warmup" as const, position: "inBand" as const, band: coachBand({ restingHr: a.restingHr, maxHr: a.maxHr, recovery: a.recovery }) };
    const g = guidance({ strain: snap.day, target: a.target, coach, minutesToLow: snap.minutesToLow });
    summary = <GuidanceCard tone={g.tone} title={g.title} body={g.body} />;
    primary = (
      <View className="gap-3">
        <RunningStats snap={snap} start={active.start} lost={ctl.status !== "live"} name={ctl.device?.name ?? null} />
        <Button variant="secondary" haptic onPress={() => finish()}>
          {t("live.end")}
        </Button>
      </View>
    );
  } else if (result) {
    summary = <WorkoutSummary rec={result} />;
    primary = (
      <View className="gap-3">
        <Button onPress={start} disabled={!isLive || !setup}>
          {t("live.startAnother")}
        </Button>
        <Button variant="secondary" onPress={() => (router.canGoBack() ? router.back() : push("/strain"))}>
          {t("live.done")}
        </Button>
      </View>
    );
  } else {
    summary = <TodayCard setup={setup} error={q.error} />;
    primary = (
      <View className="gap-3">
        <BandCard setup={setup} />
        <SectionShell variant="card" title={t("live.haptics")} info={false}>
          <View className="min-h-11 flex-row items-center gap-3">
            <Text className={cn(CAPTION, "min-w-0 flex-1")}>{t("live.hapticsHint")}</Text>
            <Switch value={haptics} onValueChange={setHaptics} label={t("live.haptics")} />
          </View>
        </SectionShell>
        <Button onPress={start} disabled={!isLive || !setup}>
          {t("live.start")}
        </Button>
      </View>
    );
  }

  const secondary = [
    <SectionShell key="recent" variant="card" title={t("live.recent")} info={false}>
      {log.length && q.data ? (
        <Divided>
          {log.slice(0, 5).map((r) => (
            <RecentRow key={r.at} rec={r} timeZone={q.data!.timeZone} today={q.data!.today} />
          ))}
        </Divided>
      ) : (
        <Text className={BODY}>{t("live.recentEmpty")}</Text>
      )}
    </SectionShell>,
  ];

  return (
    <>
      <DetailShell title={t("live.title")} info={liveInfo()} backHref="/strain" hero={hero} summary={summary} primary={primary} secondary={running ? undefined : secondary} />
      {running && <KeepAwake tag="workout" />}
    </>
  );
}

/** The coach's line on its tone's tint: the ask in the tone's colour, the reason under it. */
function GuidanceCard({ tone, title, body }: { tone: GuidanceTone; title: string; body: string }) {
  const { t: tr } = useTranslation("strain");
  const { c } = useTheme();
  const t = TONE[tone];
  return (
    <View accessible accessibilityLiveRegion="polite" accessibilityLabel={tr("live.guidanceSpoken", { title, body })} className="gap-1 rounded-2xl p-4" style={{ backgroundColor: alpha(c[t.fill], 0.12) }}>
      <Text className="text-[17px] font-semibold leading-[22px]" style={{ color: c[t.text] }}>
        {title}
      </Text>
      <Text className="text-[15px] leading-[21px]">{body}</Text>
    </View>
  );
}

/** Elapsed, heart rate and the workout's own Strain, then the zones with the current one lit. */
function RunningStats({ snap, start, lost, name }: { snap: Snapshot; start: number; lost: boolean; name: string | null }) {
  const { t } = useTranslation("strain");
  const { c } = useTheme();
  const zc = zoneColor(c, snap.zone);
  const cells = [
    { label: t("live.elapsed"), value: clockDuration(snap.now - start), color: undefined, spoken: clockDuration(snap.now - start) },
    { label: t("live.heartRate"), value: snap.bpm === null ? MISSING : String(snap.bpm), color: snap.bpm === null ? undefined : zc, spoken: snap.bpm === null ? t("live.noReading") : t("live.beatsPerMinute", { bpm: snap.bpm }) },
    { label: t("live.workout"), value: pct(snap.session), color: c["strain-text"], spoken: t("live.workoutStrainSpoken", { value: Math.round(snap.session) }) },
  ];
  const band = snap.out?.band;
  const zoneText = snap.zone === 0 ? t("live.belowZone1") : snap.zone ? t("live.zone", { zone: snap.zone }) : t("live.waiting");
  return (
    <SectionShell variant="card" title={t("live.now")} info={false}>
      <View className="flex-row gap-3">
        {cells.map((x) => (
          <View key={x.label} accessible accessibilityLabel={t("live.cellSpoken", { label: x.label, spoken: x.spoken })} className="min-w-0 flex-1 items-center gap-0.5">
            <Text numberOfLines={1} className={cn(NUM, "text-center text-[30px] leading-[34px] tabular-nums")} style={x.color ? { color: x.color } : undefined}>
              {x.value}
            </Text>
            <Text className={cn(CAPTION, "text-center")}>{x.label}</Text>
          </View>
        ))}
      </View>
      <View className="mt-4 flex-row gap-1">
        {[1, 2, 3, 4, 5].map((z) => {
          const on = snap.zone === z;
          const col = zoneColor(c, z);
          const secs = snap.zoneSeconds[z] ?? 0;
          return (
            <View
              key={z}
              accessible
              accessibilityLabel={t(on ? "live.zoneSpokenCurrent" : "live.zoneSpoken", { zone: z, time: clockDuration(secs * 1000) })}
              className={cn("min-w-0 flex-1 items-center gap-1 rounded-lg py-2.5", !on && "bg-inset")}
              style={on ? { backgroundColor: alpha(col, 0.2) } : undefined}
            >
              <Text className={cn("text-xs font-bold leading-4 tracking-[0.05em]", !on && "text-muted-foreground")} style={on ? { color: col } : undefined}>{t("live.zoneShort", { zone: z })}</Text>
              <Text className={cn("font-numeric text-[13px] font-semibold leading-[18px] tabular-nums", on ? "text-foreground" : "text-foreground-secondary")}>{clockDuration(secs * 1000)}</Text>
            </View>
          );
        })}
      </View>
      <View className="mt-3 flex-row items-center justify-between gap-3">
        <Text className={cn(CAPTION, "flex-1 tabular-nums")}>
          {band ? t("live.zoneWithBand", { zone: zoneText, floor: Math.round(band.floorBpm), ceiling: Math.round(band.ceilingBpm) }) : zoneText}
        </Text>
        <LivePill name={name} lost={lost} />
      </View>
    </SectionShell>
  );
}

/** Before starting: where today stands (Strain so far, target, Recovery). */
function TodayCard({ setup, error }: { setup: WorkoutSetup | undefined; error: unknown }) {
  const { t: tr } = useTranslation("strain");
  if (!setup)
    return (
      <SectionShell variant="card" title={tr("live.today")} info={false}>
        <Text accessibilityRole={error ? "alert" : undefined} className={cn(BODY, !!error && "text-recovery-red-text")}>
          {error ? tr("live.readError") : tr("live.reading")}
        </Text>
      </SectionShell>
    );
  const t = setup.target;
  const lines = [
    t ? tr("live.targetLine", { low: Math.round(t[0]), high: pct(t[1]) }) : tr("live.noTarget"),
    setup.recovery !== null ? tr("live.recoveryLine", { value: Math.round(setup.recovery) }) : null,
    setup.synced ? null : tr("live.notSynced"),
  ].filter(Boolean);
  return (
    <SectionShell variant="card" title={tr("live.today")} info={false}>
      <Text className="text-[15px] leading-[22px]">{lines.join(" ")}</Text>
    </SectionShell>
  );
}

/** The band: its live bpm and zone, or how to connect it (Settings › Live heart rate, scanning on arrival). */
function BandCard({ setup }: { setup: WorkoutSetup | undefined }) {
  const { t } = useTranslation("strain");
  const { c } = useTheme();
  const live = useLiveBle();
  const set = useMemo(() => (setup ? zones(setup.restingHr, setup.maxHr) : null), [setup]);
  if (!showsLive(live))
    return (
      <SectionShell variant="card" title={t("live.connect")} info={false} icon={<Icon icon={Activity} size={18} tone="strain-text" />}>
        <Text className={cn(BODY, "mb-4")}>{t("live.connectBody")}</Text>
        <GoLiveButton status={live.status} onPress={() => push(GO_LIVE_HREF)} />
      </SectionShell>
    );
  const zone = live.bpm !== null && set ? zoneNumber(set, live.bpm) : null;
  return (
    <SectionShell variant="card" title={t("live.heartRate")} info={false} icon={<Icon icon={HeartPulse} size={18} tone="recovery-red-text" />}>
      <View className="flex-row items-center justify-between gap-3">
        <View accessible accessibilityLabel={live.bpm === null ? t("live.noHeartRate") : t("live.beatsPerMinute", { bpm: live.bpm })}>
          <Text className={cn(NUM, "text-[40px] leading-[44px] tabular-nums")} style={zone ? { color: zoneColor(c, zone) } : undefined}>
            {live.bpm === null ? MISSING : String(live.bpm)}
            <Text className="font-sans text-[13px] font-semibold text-foreground-secondary">{" bpm"}</Text>
          </Text>
        </View>
        <LivePill name={live.device?.name ?? null} lost={live.status !== "live"} />
      </View>
      {zone !== null && <Text className={cn(CAPTION, "mt-2")}>{zone === 0 ? t("live.belowZone1") : t("live.zone", { zone })}</Text>}
    </SectionShell>
  );
}

/** The end of a workout: its Strain, time, heart rate, zones and where the day ended up. */
function WorkoutSummary({ rec }: { rec: WorkoutRecord }) {
  const { t: tr } = useTranslation("strain");
  const { c } = useTheme();
  const total = rec.zoneSeconds.reduce((a, b) => a + b, 0);
  const rows: { label: string; value: string; unit?: string; strain?: boolean }[] = [
    { label: tr("live.workoutStrain"), value: pct(rec.strain), strain: true },
    { label: tr("live.time"), value: clockDuration(rec.ms) },
    { label: tr("live.heartRate"), value: rec.avgHr === null ? MISSING : tr("live.avgMax", { avg: rec.avgHr, max: rec.maxHr ?? MISSING }), unit: rec.avgHr === null ? undefined : "bpm" },
    { label: tr("live.dayStrain"), value: `${pct(rec.dayStart)} → ${pct(rec.dayEnd)}`, strain: true },
  ];
  const t = rec.target;
  const verdict = !t ? null : rec.dayEnd >= t[1] ? tr("live.verdictPast") : rec.dayEnd >= t[0] ? tr("live.verdictInside") : tr("live.verdictBelow", { value: pct(t[0] - rec.dayEnd) });
  return (
    <SectionShell variant="card" title={tr("live.summary")} info={false}>
      <Divided>
        {rows.map((r) => (
          <View key={r.label} accessible accessibilityLabel={tr("live.rowSpoken", { label: r.label, value: r.value.replace("→", tr("live.to")) })} className="flex-row items-center justify-between gap-3 py-2.5">
            <Text className={cn(ROW_TITLE, "shrink")}>{r.label}</Text>
            <ValueUnit value={r.value} unit={r.unit} className={cn(NUM, "text-xl leading-6", r.strain && "text-strain-text")} />
          </View>
        ))}
      </Divided>
      {total > 0 && (
        <View accessible accessibilityLabel={tr("live.timeInZones")} className="mt-2 h-2 flex-row gap-0.5 overflow-hidden rounded">
          {rec.zoneSeconds.map((sec, z) => (sec > 0 ? <View key={z} className={z ? undefined : "bg-muted"} style={{ flexGrow: sec, flexBasis: 0, backgroundColor: z ? zoneColor(c, z) : undefined }} /> : null))}
        </View>
      )}
      <Text className={cn(CAPTION, "mt-3")}>{[verdict, tr("live.keptOnPhone")].filter(Boolean).join(" ")}</Text>
    </SectionShell>
  );
}

function RecentRow({ rec, timeZone, today }: { rec: WorkoutRecord; timeZone: string; today: string }) {
  const { t } = useTranslation("strain");
  const when = t("live.when", { day: dayLabel(localDay(Math.floor(rec.at / 1000), timeZone), today), time: clock(rec.at, timeZone) });
  return (
    <View accessible accessibilityLabel={t("live.recentSpoken", { when, duration: clockDuration(rec.ms), value: Math.round(rec.strain) })} className="min-h-14 flex-row items-center gap-3 py-2.5">
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className={ROW_TITLE}>{when}</Text>
        <Text className={cn(CAPTION, "tabular-nums")}>{rec.avgHr !== null ? t("live.recentLine", { duration: clockDuration(rec.ms), bpm: rec.avgHr }) : clockDuration(rec.ms)}</Text>
      </View>
      <View className="items-end">
        <Text className={cn(NUM, "text-xl leading-6 tabular-nums text-strain-text")}>{pct(rec.strain)}</Text>
        <Text className={CAPTION}>{t("live.strain")}</Text>
      </View>
    </View>
  );
}
