// Sleep's measure cards drawn the way WHOOP draws them: hours against need as two bars, the last five nights' bed and
// wake times against your usual ones, and efficiency as asleep and awake bars marked where you woke. Ported from pulse
// (app)/sleep/SleepCards.tsx. Left out: the Sleep Stress card (`FEATURES.sleepStress`, off until Pulse scores stress
// during sleep). The consistency card's dashed lines are drawn in pixels once the plot is measured: the web scales a 100 x 100
// path with `vector-effect: non-scaling-stroke`, which react-native-svg has no equivalent of.
import { useState } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { deltaTone } from "@/lib/bands";
import { hmm } from "@/lib/format";
import type { KeyStat, SleepVM } from "@/queries/types";
import { cn } from "@/ui/cn";
import { alpha } from "@/ui/color";
import { Gradient } from "@/ui/Gradient";
import { Hatch } from "@/ui/Hatch";
import { CAPTION, DeltaMark, LABEL } from "@/ui/metrics/primitives";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

const BAR = "h-3.5 rounded-[3px]";
const signed = (min: number, sign: "+" | "−") => `${sign}${hmm(Math.abs(min))}`;
const NUM_LG = "font-numeric text-lg font-bold leading-6 tabular-nums";

/** WHOOP's card headline: the percentage large with its arrow against the prior 30 nights, and their mean under it. */
function Headline({ value, stat, down = false }: { value: number; stat?: Pick<KeyStat, "average" | "sd">; down?: boolean }) {
  const avg = stat?.average ?? null;
  const t = avg === null ? null : deltaTone(down ? "down" : "up", value, avg, stat?.sd);
  return (
    <View>
      <View className="flex-row items-center gap-1.5">
        <Text className="font-numeric text-4xl font-bold leading-10 tracking-[-0.01em] tabular-nums">{Math.round(value)}%</Text>
        {t && <DeltaMark dir={t.dir} tone={t.tone} />}
      </View>
      {avg !== null && (
        <Text accessibilityLabel={`Prior 30-night average ${Math.round(avg)}%`} className="font-numeric text-[13px] font-medium leading-4 tabular-nums text-muted-foreground">
          {Math.round(avg)}%
        </Text>
      )}
    </View>
  );
}

/** A swatch, a name and a right-aligned value: the legend under a bar. */
function Legend({ rows }: { rows: { swatch: string; label: string; value: string }[] }) {
  return (
    <View className="mt-4 gap-2 rounded-lg bg-inset px-3 py-3">
      {rows.map((r) => (
        <View key={r.label} accessible accessibilityLabel={`${r.label} ${r.value}`} className="flex-row items-center gap-3">
          <View accessibilityElementsHidden className={cn("size-3 shrink-0 rounded-[3px]", r.swatch)} />
          <Text className="flex-1 text-[13px] font-medium leading-4 text-foreground-secondary">{r.label}</Text>
          <Text className="font-numeric text-[13px] font-semibold leading-4 tabular-nums">{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function HoursVsNeed({ vm }: { vm: SleepVM }) {
  const { c } = useTheme();
  const m = vm.hoursVsNeed;
  if (m.value === null) return <ReasonPlaceholder reason={m.reason} nightsLeft={m.nightsLeft} size="md" />;
  const h = m.value;
  const stat = vm.summary.find((k) => k.key === "hours");
  const scale = Math.max(h.asleepMin, h.needMin, 1);
  const pct = (min: number) => `${Math.min(100, (min / scale) * 100)}%` as const;
  const { baselineMin, strainMin, debtMin, napMin } = h.parts;
  // The need builds left to right: the healthy minimum fading in, then recent strain, then sleep debt.
  const parts = [
    { min: baselineMin, fill: <Gradient from={alpha(c.foreground, 0)} to={alpha(c.foreground, 0.35)} /> },
    { min: strainMin, fill: <View className="flex-1 bg-strain" /> },
    { min: debtMin, fill: <View className="flex-1 bg-foreground/80" /> },
  ];
  return (
    <View>
      <Headline value={(h.asleepMin / h.needMin) * 100} stat={stat} />
      <View className="mt-4 gap-4">
        <View>
          <View className="mb-1.5 flex-row items-baseline justify-between gap-3">
            <Text className={cn(LABEL, "text-muted-foreground")}>Hours of sleep</Text>
            <Text className={NUM_LG}>{hmm(h.asleepMin)}</Text>
          </View>
          {/* The reference app's bar fades in from the track to sleep blue at the night's length. */}
          <View accessibilityElementsHidden className={cn("overflow-hidden", BAR)} style={{ width: pct(h.asleepMin) }}>
            <Gradient from={alpha(c.sleep, 0)} to={c.sleep} />
          </View>
        </View>
        <View>
          {h.calibrating ? (
            <Text className={CAPTION}>Your need settles after 7 nights. Using {hmm(h.needMin)} until then.</Text>
          ) : (
            <View accessibilityElementsHidden className="flex-row gap-0.5" style={{ width: pct(h.needMin) }}>
              {parts.map((p, i) => (
                <View
                  key={i}
                  className={cn("overflow-hidden", BAR)}
                  // The first part is square on its right, where the next one begins.
                  style={[{ flexGrow: Math.max(0, p.min), flexBasis: 0 }, i === 0 && { borderTopRightRadius: 0, borderBottomRightRadius: 0 }]}
                >
                  {p.fill}
                </View>
              ))}
            </View>
          )}
          <View className="mt-1.5 flex-row items-baseline justify-between gap-3">
            <Text className={cn(LABEL, "text-muted-foreground")}>Sleep needed</Text>
            <Text className={NUM_LG}>{hmm(h.needMin)}</Text>
          </View>
        </View>
      </View>
      {!h.calibrating && (
        <Legend
          rows={[
            { swatch: "bg-foreground/35", label: "Healthy Minimum", value: hmm(baselineMin) },
            { swatch: "bg-strain", label: "Recent Strain", value: signed(strainMin, "+") },
            { swatch: "bg-foreground/80", label: "Sleep Debt", value: signed(debtMin, "+") },
            ...(napMin > 0 ? [{ swatch: "bg-sleep", label: "Naps", value: signed(napMin, "−") }] : []),
          ]}
        />
      )}
    </View>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Minutes from local midnight (negative = before it) as 24-hour clock text. */
const at = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/**
 * A path through the nights' optimal times (x in px, y in px): level across each night's column, easing to the next
 * night's height between columns, from the first column's left edge to the last one's right. A missing night breaks it.
 * The offsets are the web's, in its 100-unit width (9 and 4 units each side of a column's centre), scaled by `k`.
 */
function optimalPath(points: ({ x: number; y: number } | null)[], k: number) {
  let d = "";
  let prev: { x: number; y: number } | null = null;
  for (const p of points) {
    if (!p) {
      prev = null;
      continue;
    }
    if (!prev) d += `M${p.x - 9 * k} ${p.y} L${p.x + 4 * k} ${p.y}`;
    else {
      const mid = (prev.x + p.x) / 2;
      d += ` C${mid} ${prev.y} ${mid} ${p.y} ${p.x - 4 * k} ${p.y} L${p.x + 4 * k} ${p.y}`;
    }
    prev = p;
  }
  return prev ? `${d} L${prev.x + 9 * k} ${prev.y}` : d;
}

/** The plot's height: the web's h-52. */
const PLOT_H = 208;

export function SleepConsistency({ vm }: { vm: SleepVM }) {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const m = vm.consistency;
  if (m.value === null) return <ReasonPlaceholder reason={m.reason} nightsLeft={m.nightsLeft} size="md" />;
  const cons = m.value;
  const nights = cons.nights.flatMap((n) => (n ? [n] : []));
  const beds = nights.flatMap((n) => [n.bed, ...(n.typicalBed != null ? [n.typicalBed] : [])]);
  const wakes = nights.flatMap((n) => [n.wake, ...(n.typicalWake != null ? [n.typicalWake] : [])]);
  // The reference app's fixed axis, 21:00 to 13:00 in 4-hour steps, stretched by whole steps only when a night falls
  // outside it.
  const lo = Math.min(-180, Math.floor((Math.min(...beds) - 60 + 180) / 240) * 240 - 180);
  const hi = Math.max(780, Math.ceil((Math.max(...wakes) + 60 - 780) / 240) * 240 + 780);
  const pctOf = (min: number) => ((min - lo) / (hi - lo)) * 100;
  const yOf = (min: number) => (pctOf(min) / 100) * PLOT_H;
  const ticks = Array.from({ length: Math.floor((hi - lo) / 240) + 1 }, (_, i) => lo + i * 240);
  const last = cons.nights.at(-1);
  const k = w / 100;
  const optimal = (pick: (n: (typeof nights)[number]) => number | null) => optimalPath(cons.nights.map((n, i) => (n && pick(n) != null ? { x: (i * 20 + 10) * k, y: yOf(pick(n)!) } : null)), k);
  return (
    <View>
      <View className="flex-row items-end justify-between gap-3">
        <Headline value={cons.pct} stat={vm.summary.find((s) => s.key === "consistency")} />
        <View className="flex-row items-center gap-2 pb-px">
          <View accessibilityElementsHidden className="w-5 border-t-[1.5px] border-dashed border-foreground/55" />
          <Text className="text-[13px] font-medium leading-4 text-foreground-secondary">Optimal bed/wake time</Text>
        </View>
      </View>
      <View accessible accessibilityRole="image" accessibilityLabel={`Bed and wake times for the last five nights${last ? `, last night ${at(last.bed)} to ${at(last.wake)}` : ""}`} className="mt-4 flex-row gap-3">
        <View accessibilityElementsHidden className="w-10 shrink-0" style={{ height: PLOT_H }}>
          {ticks.map((t) => (
            <Text key={t} className="absolute right-0 font-numeric text-[12px] font-semibold leading-3 tabular-nums text-muted-foreground" style={{ top: yOf(t) - 6 }}>
              {at(t)}
            </Text>
          ))}
        </View>
        <View className="min-w-0 flex-1">
          <View accessibilityElementsHidden onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: PLOT_H }}>
            {ticks.map((t) => (
              <View key={t} className="absolute inset-x-0 border-t border-border" style={{ top: yOf(t) }} />
            ))}
            <View className="absolute inset-0 flex-row">
              {cons.nights.map((n, i) =>
                n ? (
                  <View key={i} className="flex-1">
                    <View className={cn("absolute w-[18px] rounded-[3px]", i === 4 ? "bg-sleep" : "bg-foreground/30")} style={{ left: "50%", marginLeft: -9, top: `${pctOf(n.bed)}%`, bottom: `${100 - pctOf(n.wake)}%` }} />
                  </View>
                ) : (
                  <View key={i} className="flex-1" />
                ),
              )}
            </View>
            {/* Each night's optimal bed and wake time, joined into one dashed line that eases from night to night. */}
            {w > 0 && (
              <Svg pointerEvents="none" width={w} height={PLOT_H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
                {[optimal((n) => n.typicalBed), optimal((n) => n.typicalWake)].map((d, i) => (
                  <Path key={i} d={d} fill="none" stroke={alpha(c.foreground, 0.55)} strokeWidth={1.5} strokeDasharray="5 4" />
                ))}
              </Svg>
            )}
            {/* Last night's times beside its bar, as WHOOP labels them: bed above, wake below, clear of the dashed lines. */}
            {last && (
              <View pointerEvents="none" className="absolute inset-y-0 right-0" style={{ width: "20%" }}>
                <View className="absolute inset-x-0 items-center" style={{ top: yOf(Math.min(last.bed, last.typicalBed ?? last.bed)) - 20 }}>
                  <Text className="font-numeric text-[13px] font-bold leading-4 tabular-nums text-sleep">{at(last.bed)}</Text>
                </View>
                <View className="absolute inset-x-0 items-center" style={{ top: yOf(Math.max(last.wake, last.typicalWake ?? last.wake)) + 4 }}>
                  <Text className="font-numeric text-[13px] font-bold leading-4 tabular-nums text-sleep">{at(last.wake)}</Text>
                </View>
              </View>
            )}
          </View>
          <View accessibilityElementsHidden className="mt-2 flex-row">
            {cons.nights.map((n, i) => (
              <Text key={i} className={cn("flex-1 text-center text-[13px] font-medium leading-4", i === 4 ? "font-bold text-foreground" : "text-muted-foreground")}>
                {n?.label ?? "·"}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/** Tick marks where you woke: thin cuts through a bar, at least 2 px wide. */
function Wakes({ wakes, className }: { wakes: { at: number; width: number }[]; className: string }) {
  return wakes.map((w, i) => <View key={i} className={cn("absolute inset-y-0", className)} style={{ left: `${w.at * 100}%`, width: `${w.width * 100}%`, minWidth: 2 }} />);
}

/**
 * The reference app's Sleep Efficiency card (sleep-24, sleep-25): the share with its arrow and prior mean, an asleep bar
 * cut where each spell awake fell, an awake bar on the hatched track marked at the same places, then the wake events.
 */
export function SleepEfficiency({ vm }: { vm: SleepVM }) {
  const m = vm.efficiency;
  if (m.value === null) return <ReasonPlaceholder reason={m.reason} nightsLeft={m.nightsLeft} size="md" />;
  const e = m.value;
  return (
    <View>
      <Headline value={e.pct} stat={e} />
      <View className="mt-4 gap-2">
        <View className="flex-row items-baseline justify-between gap-3">
          <Text className={cn(LABEL, "text-muted-foreground")}>Asleep</Text>
          <Text className={NUM_LG}>{hmm(e.asleepMin)}</Text>
        </View>
        <View accessibilityElementsHidden className={cn("overflow-hidden bg-sleep", BAR)}>
          <Wakes wakes={e.wakes} className="bg-card" />
        </View>
        <Hatch accessibilityElementsHidden className={BAR}>
          <Wakes wakes={e.wakes} className="bg-foreground" />
        </Hatch>
        <View className="flex-row items-baseline justify-between gap-3">
          <Text className={cn(LABEL, "text-muted-foreground")}>Awake</Text>
          <Text className={NUM_LG}>{hmm(e.awakeMin)}</Text>
        </View>
      </View>
      <View className="mt-4 flex-row items-center gap-3 border-t border-border pt-4">
        <View accessibilityElementsHidden className="size-3.5 shrink-0 rounded-[3px] bg-foreground/80" />
        <Text className={cn(LABEL, "flex-1")}>Wake events</Text>
        <Text className="font-numeric text-xl font-bold leading-6 tabular-nums">{e.wakeEvents ?? "--"}</Text>
      </View>
    </View>
  );
}
