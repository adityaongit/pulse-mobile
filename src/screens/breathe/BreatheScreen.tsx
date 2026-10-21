// Breathe `/breathe` (spec §7.22), halo's src/screens/breathe/BreatheScreen.tsx on Pulse's kit: paced breathing with a
// circle, a label and haptic cues, from the Stress screen and More. Pick a pace (resonance 5.5, box, 4-7-8,
// physiological sigh) and 1, 3 or 5 minutes; the circle fills and empties on the UI thread (BreathCircle) while the JS
// side counts the stage down and buzzes at each switch, all off one start time. With the band live over Bluetooth it
// shows the heart rate, and when the band sends RR intervals a spot HRV before and after (src/live/spotHrv.ts); without
// the band it is a plain pacer. Sessions are kept on the phone (src/live/storage.ts) and never reach the Store. The
// screen stays awake while a session runs.
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { Check, HeartPulse, TriangleAlert, Wind } from "lucide-react-native";
import { DURATIONS, phaseAt, planSession, protocolById, PROTOCOLS, scheduleCues, secondsLeft, stageLabel, type BreathMinutes, type BreathProtocol, type BreathProtocolId } from "@/live/breath";
import { breathCue, sessionDone } from "@/live/haptics";
import { KeepAwake } from "@/live/KeepAwake";
import { breathRecord, clockDuration, pctChange, signedPct, type BreathRecord } from "@/live/sessions";
import { BREATH_HAPTICS_KEY, saveBreath, useBreathLog, useStoredFlag } from "@/live/storage";
import { useCapture } from "@/live/useCapture";
import { clock, dayLabel, MISSING } from "@/lib/format";
import { localDay } from "@/lib/time";
import { showsLive, useLiveBle, useLiveBleControl } from "@/state/liveBle";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Divided } from "@/ui/Divided";
import { Icon } from "@/ui/Icon";
import { GoLiveButton, LivePill } from "@/ui/metrics/LiveHeartRate";
import { CAPTION, LABEL, ValueUnit } from "@/ui/metrics/primitives";
import { push } from "@/ui/navigate";
import { Press } from "@/ui/Press";
import { Segmented } from "@/ui/Segmented";
import { DetailShell } from "@/ui/shells/DetailShell";
import type { InfoContent } from "@/ui/shells/InfoButton";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { GO_LIVE_HREF } from "@/screens/health/LiveHeartRateHero";
import { Switch } from "@/screens/settings/controls";
import { useScreen } from "@/screens/useScreen";
import type { QueryCtx } from "@/queries/ctx";
import { BreathCircle } from "./BreathCircle";

/** The zone and today, for the recent sessions' day labels. */
const dayQuery = async (ctx: QueryCtx) => ({ timeZone: ctx.timeZone, today: ctx.today });

/** The circle's diameter at full. */
const CIRCLE = 216;
/** A session stopped sooner than this is not kept. */
const MIN_SAVE_MS = 30_000;
/** A stage reached this late (the app was in the background) changes the label but does not buzz. */
const LATE_CUE_MS = 400;

const BODY = "text-[15px] leading-[22px] text-foreground-secondary";
const ROW_TITLE = "text-[15px] font-semibold leading-5";
const NUM = "font-numeric font-bold";

const info = (): InfoContent => ({ title: i18n.t("more:breathe.aboutTitle"), body: i18n.t("more:breathe.aboutBody") });

// The last pace and length picked, for the next visit while the app stays open.
const remembered: { pick: { id: BreathProtocolId; minutes: BreathMinutes } } = { pick: { id: "resonance", minutes: 3 } };

type Run = { protocol: BreathProtocol; start: number; plannedMs: number; preRr: number[] };
type Clock = { /** The run's start, so a finished run's count never shows for the next. */ run: number; stage: number; secs: number; leftMs: number };

/** "HRV 42 ms · RMSSD, last minute", "HRV: measuring…", or null without RR (halo's rmssdLine). */
const rmssdLine = (rmssd: number | null, rr: number): string | null => (rmssd !== null ? i18n.t("more:breathe.hrvLine", { value: Math.round(rmssd) }) : rr ? i18n.t("more:breathe.hrvMeasuring") : null);

/**
 * The session's clock on the JS side: wakes at each stage switch and each whole second (of the stage count and of
 * the time left), buzzes at the switches, and calls `onEnd` when the planned time is up. ≤ 2 renders a second.
 */
function useBreathClock(run: Run | null, haptics: boolean, onEnd: (end: number) => void): Clock | null {
  const [state, setState] = useState<Clock | null>(null);
  const latest = useRef({ haptics, onEnd });
  useEffect(() => {
    latest.current = { haptics, onEnd };
  });
  useEffect(() => {
    if (!run) return;
    const stages = run.protocol.stages;
    const loops = new Map(scheduleCues(stages, run.plannedMs).map((c) => [c.offsetMs, c.loops]));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seen = -1;
    const step = () => {
      const t = Date.now() - run.start;
      if (t >= run.plannedMs) {
        latest.current.onEnd(run.start + run.plannedMs);
        return;
      }
      const p = phaseAt(stages, t);
      if (p.start !== seen) {
        seen = p.start;
        if (latest.current.haptics && t - p.start < LATE_CUE_MS) breathCue(loops.get(p.start) ?? 0);
      }
      const secs = secondsLeft(p, t);
      const left = Math.ceil((run.plannedMs - t) / 1000);
      setState({ run: run.start, stage: p.stage, secs, leftMs: left * 1000 });
      // The next moment anything on screen changes: the stage count ticking, the time left ticking, the stage ending.
      const next = Math.min(p.end - (secs - 1) * 1000, run.plannedMs - (left - 1) * 1000);
      timer = setTimeout(step, Math.max(1, next - t + 1));
    };
    timer = setTimeout(step, 0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [run]);
  // A new run shows nothing until its first step (the same frame), never the last run's count.
  return run && state && state.run === run.start ? state : null;
}

/** A number over its caps label, centred (the hero's length and breaths). */
function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <View accessible accessibilityLabel={i18n.t("more:breathe.valueLabel", { label, value })} className="min-w-0 flex-1 items-center gap-1">
      <Text className={cn(NUM, "text-[26px] leading-[30px] tabular-nums")}>{value}</Text>
      <Text className={cn(LABEL, "text-foreground-secondary")}>{label}</Text>
    </View>
  );
}

export function BreatheScreen() {
  const { t } = useTranslation("more");
  const { c } = useTheme();
  const day = useScreen(dayQuery, ["breathe"]).data;
  const ctl = useLiveBleControl();
  const log = useBreathLog();
  const [haptics, setHaptics] = useStoredFlag(BREATH_HAPTICS_KEY);
  const [pick, setPick] = useState(remembered.pick);
  const [run, setRun] = useState<Run | null>(null);
  const [result, setResult] = useState<BreathRecord | null>(null);
  const protocol = protocolById(pick.id) ?? PROTOCOLS[0];
  const plan = planSession(protocol.stages, pick.minutes);
  const capture = useCapture(run !== null);
  const runRef = useRef<Run | null>(null);
  // The live buffer's last minute of RR, kept current by <RecentRr> so this screen doesn't re-render with each beat.
  const recentRr = useRef<number[]>([]);
  const onRecentRr = useCallback((rr: number[]) => {
    recentRr.current = rr;
  }, []);

  const choose = (next: Partial<typeof pick>) => setPick({ ...pick, ...next });
  useEffect(() => {
    remembered.pick = pick;
  }, [pick]);

  /** Ends the session at `end`, sums it up and keeps it (when long enough). Safe to call twice. */
  const finish = useCallback(
    (end: number, unmounting = false) => {
      const r = runRef.current;
      if (!r) return;
      runRef.current = null;
      const rec = breathRecord({ protocol: r.protocol, start: r.start, end, plannedMs: r.plannedMs, hr: capture.current.hr, beats: capture.current.beats, preRr: r.preRr });
      if (rec.ms >= MIN_SAVE_MS) void saveBreath(rec);
      if (unmounting) return;
      setRun(null);
      setResult(rec);
      if (rec.completed) sessionDone();
    },
    [capture],
  );
  // Leaving mid-session keeps what was done.
  useEffect(() => () => finish(Date.now(), true), [finish]);

  const clockState = useBreathClock(run, haptics, finish);

  const start = useCallback(() => {
    // The minute before the tap is the "before" reading when it has enough clean beats.
    const r: Run = { protocol, start: Date.now(), plannedMs: plan.durationMs, preRr: recentRr.current.slice() };
    runRef.current = r;
    setResult(null);
    setRun(r);
  }, [protocol, plan.durationMs]);

  const running = run !== null;
  const stage = running && clockState ? run.protocol.stages[clockState.stage] : null;
  const tint = c["stress-low"];

  const hero = (
    <View className="w-full items-center gap-4">
      <BreathCircle stages={(run?.protocol ?? protocol).stages} startAt={run?.start ?? null} size={CIRCLE} color={tint}>
        {stage && clockState ? (
          // Announced on each stage switch only: the label leaves out the per-second count.
          <View accessible accessibilityLiveRegion="polite" accessibilityLabel={stageLabel(stage)} className="items-center gap-0.5">
            <Text className="text-center text-base font-semibold leading-[21px]">{stageLabel(stage)}</Text>
            <Text className={cn(NUM, "text-center text-[48px] leading-[54px] tabular-nums")} style={{ color: tint }}>
              {String(clockState.secs)}
            </Text>
          </View>
        ) : (
          <Wind size={36} color={tint} strokeWidth={1.75} />
        )}
      </BreathCircle>
      {running && clockState ? (
        <View accessible accessibilityLabel={t("breathe.leftLabel", { time: clockDuration(clockState.leftMs), title: protocol.title })} className="items-center gap-0.5">
          <ValueUnit value={clockDuration(clockState.leftMs)} unit={t("breathe.left")} className={cn(NUM, "text-[28px] leading-8")} />
          <Text className={BODY}>{protocol.title}</Text>
        </View>
      ) : (
        <View className="w-full items-center gap-3">
          <Text accessibilityRole="header" className="text-center text-[22px] font-semibold leading-7">
            {protocol.title}
          </Text>
          <View className="w-full flex-row gap-3">
            <HeroStat value={clockDuration(plan.durationMs)} label={t("breathe.length")} />
            <HeroStat value={String(plan.cycles)} label={t("breathe.breaths")} />
          </View>
        </View>
      )}
    </View>
  );

  const liveCard = <LiveCard running={running} />;

  let primary;
  if (running)
    primary = (
      <View className="gap-3">
        {liveCard}
        <Button variant="secondary" haptic onPress={() => finish(Date.now())}>
          {t("breathe.endSession")}
        </Button>
      </View>
    );
  else if (result)
    primary = (
      <View className="gap-3">
        <Summary rec={result} />
        <Button onPress={start}>
          {t("breathe.goAgain")}
        </Button>
        <Button variant="secondary" onPress={() => setResult(null)}>
          {t("breathe.changePace")}
        </Button>
      </View>
    );
  else
    primary = (
      <View className="gap-3">
        <SectionShell variant="card" title={t("breathe.pace")} info={false}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("breathe.pace")}>
            <Divided>
              {PROTOCOLS.map((p) => (
                <ProtocolRow key={p.id} p={p} selected={p.id === protocol.id} onPress={() => choose({ id: p.id })} />
              ))}
            </Divided>
          </View>
          <Text className={cn(LABEL, "mb-2 mt-5")}>{t("breathe.length")}</Text>
          <Segmented
            fill
            label={t("breathe.sessionLength")}
            value={String(pick.minutes)}
            onChange={(v) => choose({ minutes: Number(v) as BreathMinutes })}
            options={DURATIONS.map((m) => ({ value: String(m), label: t("breathe.minutesShort", { count: m }), accessibilityLabel: t("breathe.minutesLabel", { count: m }) }))}
          />
          <View className="mt-4 min-h-14 flex-row items-center gap-3">
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className={ROW_TITLE}>{t("breathe.hapticCues")}</Text>
              <Text className={CAPTION}>{t("breathe.hapticHint")}</Text>
            </View>
            <Switch value={haptics} onValueChange={setHaptics} label={t("breathe.hapticCues")} />
          </View>
        </SectionShell>
        {liveCard}
        <Button onPress={start}>
          {t("breathe.start")}
        </Button>
      </View>
    );

  const secondary = [
    <SectionShell key="about" variant="card" title={t("breathe.aboutProtocol", { title: protocol.title })} info={false}>
      <Text className={BODY}>{protocol.edu}</Text>
      {!!protocol.caution && (
        <View className="mt-3 flex-row items-center gap-3 rounded-lg bg-warning/10 px-3 py-2.5">
          <Icon icon={TriangleAlert} size={18} tone="warning-text" />
          <Text className="min-w-0 flex-1 text-[13px] font-medium leading-[18px] text-warning-text">{protocol.caution}</Text>
        </View>
      )}
    </SectionShell>,
    <SectionShell key="recent" variant="card" title={t("breathe.recentSessions")} info={false}>
      {log.length && day ? (
        <Divided>
          {log.slice(0, 5).map((r) => (
            <RecentRow key={r.at} rec={r} timeZone={day.timeZone} today={day.today} />
          ))}
        </Divided>
      ) : (
        <Text className={BODY}>{t("breathe.recentEmpty")}</Text>
      )}
    </SectionShell>,
  ];

  return (
    <>
      <DetailShell title={t("breathe.title")} info={info()} backHref="/health/stress" hero={hero} primary={primary} secondary={running ? undefined : secondary} />
      {running && <KeepAwake tag="breathe" />}
      <RecentRr onChange={onRecentRr} live={ctl.status === "live"} />
    </>
  );
}

/** Hands up the live buffer's last minute of RR intervals (empty unless live) as it changes; renders nothing. */
function RecentRr({ onChange, live }: { onChange: (rr: number[]) => void; live: boolean }) {
  const { rrMs } = useLiveBle();
  useEffect(() => onChange(live ? rrMs : []), [onChange, live, rrMs]);
  return null;
}

/** One pace in the picker, a row of the card: its name in caps over its timing, a check on the chosen one. */
function ProtocolRow({ p, selected, onPress }: { p: BreathProtocol; selected: boolean; onPress: () => void }) {
  return (
    <Press
      activeBg="bg-accent"
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={i18n.t("more:breathe.protocolSubtitle", { title: p.title, subtitle: p.subtitle })}
      className="min-h-14 flex-row items-center gap-3 py-2"
    >
      <View className="min-w-0 flex-1">
        <Text className={LABEL}>{p.title}</Text>
        <Text className={cn(CAPTION, "mt-0.5")}>{p.subtitle}</Text>
      </View>
      <View className="size-5 shrink-0 items-center justify-center">{selected && <Icon icon={Check} size={20} tone="foreground" strokeWidth={2.5} />}</View>
    </Press>
  );
}

/** The band's part: live bpm and the HRV line, or how to connect. Breathe works without it. */
function LiveCard({ running }: { running: boolean }) {
  const { t } = useTranslation("more");
  const live = useLiveBle();
  const icon = <Icon icon={HeartPulse} size={18} tone="recovery-red-text" />;
  if (!showsLive(live))
    return (
      <SectionShell variant="card" title={t("breathe.heartRate")} icon={icon} info={false}>
        <Text className={cn(BODY, "mb-4")}>{running ? t("breathe.noBandRunning") : t("breathe.noBand")}</Text>
        <GoLiveButton status={live.status} onPress={() => push(GO_LIVE_HREF)} />
      </SectionShell>
    );
  const note = live.contact === false ? t("breathe.noContact") : (rmssdLine(live.rmssd, live.rrMs.length) ?? t("breathe.heartRateOnly"));
  return (
    <SectionShell variant="card" title={t("breathe.heartRate")} icon={icon} info={false}>
      <View className="flex-row items-center justify-between gap-3">
        <View accessible accessibilityLabel={live.bpm === null ? t("breathe.noHeartRateYet") : t("breathe.bpmLabel", { bpm: live.bpm })}>
          <ValueUnit value={live.bpm === null ? MISSING : String(live.bpm)} unit="bpm" className={cn(NUM, "text-[40px] leading-[44px] text-recovery-red-text")} />
        </View>
        <LivePill name={live.device?.name ?? null} lost={live.status !== "live"} />
      </View>
      <Text className={cn("mt-2 text-[13px] leading-[18px] tabular-nums", live.contact === false ? "font-semibold text-warning-text" : "text-muted-foreground")}>{note}</Text>
    </SectionShell>
  );
}

/** "72 → 64": both ends, either missing as "--". */
const fromTo = (a: number | null, b: number | null) => `${a ?? MISSING} → ${b ?? MISSING}`;

/** The end of a session: how long, heart rate start → end, HRV before → after and the swing per breath. */
function Summary({ rec }: { rec: BreathRecord }) {
  const { t } = useTranslation("more");
  const p = protocolById(rec.protocol);
  const hrDelta = rec.hrStart !== null && rec.hrEnd !== null ? rec.hrEnd - rec.hrStart : null;
  const hrv = pctChange(rec.hrvBefore, rec.hrvAfter);
  const hrNone = rec.hrStart === null && rec.hrEnd === null;
  const hrvNone = rec.hrvBefore === null && rec.hrvAfter === null;
  const rows: { label: string; value: string; unit?: string; note?: string }[] = [
    { label: t("breathe.rowTime"), value: clockDuration(rec.ms), note: t(rec.completed ? "breathe.completeNote" : "breathe.earlyNote", { title: p?.title ?? t("breathe.sessionFallback") }) },
    {
      label: t("breathe.heartRate"),
      value: hrNone ? MISSING : fromTo(rec.hrStart, rec.hrEnd),
      unit: hrNone ? undefined : "bpm",
      note: hrDelta === null ? (rec.hrStart === null ? t("breathe.noBandNote") : undefined) : hrDelta === 0 ? t("breathe.unchanged") : t(hrDelta < 0 ? "breathe.down" : "breathe.up", { n: Math.abs(hrDelta) }),
    },
    {
      label: t("breathe.hrvRmssd"),
      value: hrvNone ? MISSING : fromTo(rec.hrvBefore === null ? null : Math.round(rec.hrvBefore), rec.hrvAfter === null ? null : Math.round(rec.hrvAfter)),
      unit: hrvNone ? undefined : "ms",
      note: hrv !== null ? t("breathe.pctAfter", { pct: signedPct(hrv) }) : rec.hrStart === null ? t("breathe.needsBand") : t("breathe.needsRr"),
    },
    ...(rec.rsa !== null ? [{ label: t("breathe.swing"), value: rec.rsa.toFixed(1), unit: "bpm", note: t("breathe.swingNote") }] : []),
  ];
  return (
    <SectionShell variant="card" title={rec.completed ? t("breathe.sessionComplete") : t("breathe.sessionEnded")} info={false}>
      <Divided>
        {rows.map((r) => (
          <View
            key={r.label}
            accessible
            accessibilityLabel={t(r.note ? "breathe.valueNote" : "breathe.valueLabel", { label: r.label, value: `${r.value}${r.unit ? ` ${r.unit}` : ""}`.replace("→", "to"), note: r.note })}
            className="flex-row items-center gap-3 py-2.5"
          >
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className={ROW_TITLE}>{r.label}</Text>
              {!!r.note && <Text className={CAPTION}>{r.note}</Text>}
            </View>
            <ValueUnit value={r.value} unit={r.unit} className={cn(NUM, "text-xl leading-6")} />
          </View>
        ))}
      </Divided>
    </SectionShell>
  );
}

/** One kept session: when, which pace, how long, and what changed. */
function RecentRow({ rec, timeZone, today }: { rec: BreathRecord; timeZone: string; today: string }) {
  const { t } = useTranslation("more");
  const p = protocolById(rec.protocol);
  const when = t("breathe.whenAt", { day: dayLabel(localDay(Math.floor(rec.at / 1000), timeZone), today), time: clock(rec.at, timeZone) });
  const hrv = pctChange(rec.hrvBefore, rec.hrvAfter);
  const hr = rec.hrStart !== null && rec.hrEnd !== null;
  const aside = hrv !== null ? t("breathe.hrvPct", { pct: signedPct(hrv) }) : hr ? `${rec.hrStart} → ${rec.hrEnd} bpm` : rec.completed ? t("breathe.complete") : t("breathe.endedEarly");
  return (
    <View accessible accessibilityLabel={t("breathe.recentLabel", { when, title: p?.title ?? t("breathe.breathing"), duration: clockDuration(rec.ms), aside: aside.replace("→", "to") })} className="min-h-14 flex-row items-center gap-3 py-2.5">
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className={ROW_TITLE}>{p?.title ?? t("breathe.breathing")}</Text>
        <Text className={cn(CAPTION, "tabular-nums")}>{t("breathe.whenDuration", { when, duration: clockDuration(rec.ms) })}</Text>
      </View>
      {hrv !== null ? (
        <View className="items-end">
          <Text className={cn(NUM, "text-lg leading-[22px] tabular-nums")}>{signedPct(hrv)}</Text>
          <Text className={CAPTION}>{t("breathe.hrvShort")}</Text>
        </View>
      ) : hr ? (
        <ValueUnit value={`${rec.hrStart} → ${rec.hrEnd}`} unit="bpm" className={cn(NUM, "text-lg leading-[22px]")} />
      ) : (
        <Text className={CAPTION}>{rec.completed ? t("breathe.complete") : t("breathe.endedEarly")}</Text>
      )}
    </View>
  );
}

/** The Stress screen's way to Breathe: a card that is one link (halo's BreatheCard). */
export function BreatheCard() {
  const { t } = useTranslation("more");
  return (
    <SectionShell variant="card" title={t("breathe.title")} href="/breathe" info={false} icon={<Icon icon={Wind} size={18} tone="stress-low" />}>
      <Text className={BODY}>{t("breathe.cardBody")}</Text>
    </SectionShell>
  );
}

