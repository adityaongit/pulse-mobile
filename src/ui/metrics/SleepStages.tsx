import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { DATA_COLORS, deltaTone, GOOD_DIRECTION } from "@/lib/bands";
import { durationWords, hmm, statSentence } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { HypnogramChart } from "../charts/Hypnogram";
import { SleepHrChart, SleepHrChartSkeleton, type SleepHr } from "../charts/SleepHrChart";
import { cn } from "../cn";
import { Gradient } from "../Gradient";
import { haptic } from "../haptics";
import { Hatch } from "../Hatch";
import { Segmented } from "../Segmented";
import { EmptyState } from "../shells/EmptyState";
import { MetricState } from "../shells/MetricState";
import { Skeleton, SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { DeltaMark, LABEL } from "./primitives";
import { ReasonPlaceholder } from "./ReasonPlaceholder";

type Stage = "awake" | "rem" | "light" | "deep";
export type SleepStagesNight = {
  bed: number;
  wake: number;
  segments: { stage: Stage; start: number; end: number }[];
  rows: { stage: Stage; label: string; pct: number; minutes: number; typical: [number, number] }[];
};
/** Time asleep in the main sleep and the prior 30 nights' mean, minutes. */
export type SleepHours = { asleepMin: number; average: number | null; sd?: number };

export type SleepStagesProps = {
  /** The hero: no value means no night, and the whole card shows the reason. */
  hours: Metric<SleepHours> | undefined;
  /** Deep + REM against the prior 30 nights: the row that closes the breakdown (spec §11 R33). */
  restorative?: Metric<{ minutes: number; average: number | null; sd?: number }>;
  hr: Metric<SleepHr> | undefined;
  /** null: a night Fitbit did not stage. */
  data: Metric<SleepStagesNight> | null | undefined;
};

// The reference app's order, top to bottom.
const ORDER: Stage[] = ["awake", "light", "deep", "rem"];
const EMPTY = "No stage data for this sleep. Fitbit only stages sleeps longer than about 3 hours.";
const HERO = "font-numeric text-[32px] font-bold leading-9 tracking-[-0.01em]";

/** The reference app's "Hours of sleep": time asleep, the arrow against the prior 30 nights and their mean under it. */
function HoursHero({ h }: { h: SleepHours }) {
  const t = h.average === null ? undefined : deltaTone(GOOD_DIRECTION.hours, h.asleepMin, h.average, h.sd);
  const sentence = statSentence({
    label: "Hours of sleep",
    valueText: durationWords(h.asleepMin),
    averageText: h.average === null ? undefined : durationWords(h.average),
    dir: t?.dir,
    tone: t?.tone,
  });
  return (
    <View accessible accessibilityLabel={sentence}>
      <Text className={cn(LABEL, "text-foreground-secondary")}>Hours of sleep</Text>
      <View className="mt-1.5 flex-row gap-2 self-start">
        <View>
          <Text className={cn(HERO, "tabular-nums")}>{hmm(h.asleepMin)}</Text>
          {h.average !== null && <Text className="font-numeric text-[13px] font-medium leading-4 tabular-nums text-muted-foreground">{hmm(h.average)}</Text>}
        </View>
        <View className="h-9 w-2 items-center justify-center">{t && <DeltaMark dir={t.dir} tone={t.tone} />}</View>
      </View>
    </View>
  );
}

/** WHOOP's stage names; Fitbit's "Deep" is slow-wave sleep. */
const ROW_LABEL: Record<Stage, string> = { awake: "Awake", light: "Light", deep: "SWS (Deep)", rem: "REM" };
const TABS = [
  { value: "breakdown", label: "Breakdown" },
  { value: "timeline", label: "Timeline" },
] as const;
type Tab = (typeof TABS)[number]["value"];

/** The typical-range mark: a dashed box over the track (the legend's swatch and each row's range). */
const RANGE_BOX = "border-x-[1.5px] border-dashed border-foreground/75 bg-foreground/[0.12]";

/** The reference app's closing row: a deep-to-REM swatch, "Restorative sleep", the minutes with an arrow and the prior mean. */
function RestorativeRow({ r }: { r: { minutes: number; average: number | null; sd?: number } }) {
  const { c } = useTheme();
  const t = r.average === null ? undefined : deltaTone("up", r.minutes, r.average, r.sd);
  return (
    <View accessible accessibilityLabel={statSentence({ label: "Restorative sleep", valueText: durationWords(r.minutes), averageText: r.average === null ? undefined : durationWords(r.average), dir: t?.dir, tone: t?.tone })} className="flex-row items-center gap-3 border-t border-border pt-4">
      <View className="size-4 shrink-0 overflow-hidden rounded-[3px]">
        <Gradient from={c["stage-deep"]} to={c["stage-rem"]} angle="xy" />
      </View>
      <Text className={cn(LABEL, "min-w-0 flex-1 text-[13px]")}>Restorative sleep</Text>
      <View className="flex-row gap-2">
        <View className="items-end">
          <Text className="font-numeric text-[22px] font-bold leading-7 tabular-nums">{hmm(r.minutes)}</Text>
          {r.average !== null && <Text className="font-numeric text-[13px] font-medium leading-4 tabular-nums text-muted-foreground">{hmm(r.average)}</Text>}
        </View>
        <View className="h-7 w-2 items-center justify-center">{t && <DeltaMark dir={t.dir} tone={t.tone} />}</View>
      </View>
    </View>
  );
}

function Rows({ night, selected, onSelect, restorative }: { night: SleepStagesNight; selected: Stage; onSelect: (s: Stage) => void; restorative?: SleepStagesProps["restorative"] }) {
  const { css } = useTheme();
  const [tab, setTab] = useState<Tab>("breakdown");
  const span = Math.max(1, night.wake - night.bed);
  const rows = ORDER.map((s) => night.rows.find((r) => r.stage === s)).filter((r) => !!r);

  return (
    <View className="gap-4">
      {/* One view at a time: the stage breakdown (WHOOP's rows) or the night's timeline (the hypnogram). */}
      <Segmented label="Stages view" value={tab} options={TABS} onChange={setTab} fill textClassName="text-[13px] font-bold uppercase tracking-[0.1em]" />
      {/* One baseline for the label and "Duration 6:59" (the 17 px value sets it). */}
      <View className="flex-row items-baseline justify-between gap-2">
        {tab === "breakdown" ? (
          <View className="flex-row items-center gap-2">
            <View className={cn("h-4 w-3.5", RANGE_BOX)} />
            <Text className={cn(LABEL, "text-foreground-secondary")}>Typical range</Text>
          </View>
        ) : (
          <Text accessibilityRole="header" className={cn(LABEL, "text-foreground-secondary")}>
            Stages
          </Text>
        )}
        <View className="flex-row items-baseline gap-2">
          <Text className={cn(LABEL, "text-muted-foreground")}>Duration</Text>
          <Text className="font-numeric text-[17px] font-bold leading-5 tabular-nums text-foreground">{hmm(span / 60_000)}</Text>
        </View>
      </View>
      {tab === "timeline" ? (
        <HypnogramChart night={night} />
      ) : (
        // Choosing a stage lights its stretches on the heart-rate line above.
        <View accessibilityRole="radiogroup" accessibilityLabel="Highlight a sleep stage" className="gap-5 pt-1">
          {rows.map((r) => {
            const on = r.stage === selected;
            const color = DATA_COLORS[`stage-${r.stage}`];
            return (
              <Pressable
                key={r.stage}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${ROW_LABEL[r.stage]}, ${Math.round(r.pct)} percent, ${hmm(r.minutes)}. Typical ${r.typical[0]} to ${r.typical[1]} percent`}
                onPress={() => {
                  if (!on) haptic.select();
                  onSelect(r.stage);
                }}
                className="gap-3"
              >
                <View className="flex-row items-center gap-3">
                  {/* The reference app's radio: a white ring, filled white with a dark centre when chosen. */}
                  <View className={cn("size-[26px] shrink-0 items-center justify-center rounded-full border-2", on ? "border-foreground bg-foreground" : "border-foreground/90")}>{on && <View className="size-2.5 rounded-full bg-background" />}</View>
                  <View className="min-w-0 flex-1 flex-row items-baseline gap-2.5">
                    <Text className={cn(LABEL, "text-[13px]")}>{ROW_LABEL[r.stage]}</Text>
                    <Text className={cn("font-numeric text-[15px] font-bold leading-5 tabular-nums", color.text)}>{`${Math.round(r.pct)}%`}</Text>
                  </View>
                  <Text className="font-numeric text-[22px] font-bold leading-7 tabular-nums">{hmm(r.minutes)}</Text>
                </View>
                {/* WHOOP's row: the stage's share of the night filled over the hatched track, the typical range boxed. */}
                <Hatch className="h-3.5 rounded-[4px]" style={{ overflow: "visible" }}>
                  <View className="absolute inset-y-0 left-0 rounded-[4px]" style={{ width: `${Math.min(100, r.pct)}%`, backgroundColor: css(color.css) }} />
                  <View className={cn("absolute -inset-y-1.5", RANGE_BOX)} style={{ left: `${r.typical[0]}%`, width: `${r.typical[1] - r.typical[0]}%` }} />
                </Hatch>
              </Pressable>
            );
          })}
        </View>
      )}
      {tab === "breakdown" && restorative?.value && <RestorativeRow r={restorative.value} />}
    </View>
  );
}

/**
 * The reference app's "Last night's sleep" card (spec §7.5, §11 V8, R9): the hours hero, the overnight heart rate, then the
 * stages as a breakdown (rows) or a timeline (hypnogram). Choosing a stage row lights its stretches on the heart-rate line.
 */
export function SleepStages({ hours, hr, data, restorative }: SleepStagesProps) {
  const [selected, setSelected] = useState<Stage>("awake");
  const segments = data?.value?.segments;
  const highlight = useMemo(() => (segments?.length ? segments.filter((g) => g.stage === selected) : undefined), [segments, selected]);
  return (
    <MetricState
      metric={hours}
      skeleton={<SleepStagesSkeleton />}
      renderReason={(r, meta) => (
        <View className="items-center">
          <ReasonPlaceholder reason={r} nightsLeft={meta.nightsLeft} size="md" />
        </View>
      )}
    >
      {(h) => (
        <View className="gap-4">
          <HoursHero h={h} />
          <SleepHrChart data={hr} highlight={highlight} />
          <View className="border-t border-border pt-4">
            <MetricState metric={data} skeleton={<StageRowsSkeleton />} empty={<EmptyState body={EMPTY} />} renderReason={(r) => <ReasonPlaceholder reason={r} size="md" />}>
              {(night) => (night.segments.length ? <Rows night={night} selected={selected} onSelect={setSelected} restorative={restorative} /> : <EmptyState body={EMPTY} />)}
            </MetricState>
          </View>
        </View>
      )}
    </MetricState>
  );
}

function StageRowsSkeleton() {
  return (
    <View accessibilityElementsHidden className="gap-4">
      <Skeleton className="h-11 rounded-lg" />
      <View className="flex-row items-baseline justify-between">
        <Text className={cn(LABEL, "text-foreground-secondary")}>Typical range</Text>
        <View className="w-24">
          <SkeletonText lh={20} fs={17} />
        </View>
      </View>
      {["Awake", "Light", "SWS (Deep)", "REM"].map((l) => (
        <View key={l} className="gap-2.5">
          <View className="flex-row items-center gap-3">
            <View className="size-[26px] rounded-full border-2 border-foreground/30" />
            <Text className={cn(LABEL, "flex-1")}>{l}</Text>
            <View className="w-12">
              <SkeletonText lh={24} fs={20} />
            </View>
          </View>
          <Skeleton className="h-3.5 rounded-[4px] bg-muted/60" />
        </View>
      ))}
    </View>
  );
}

/** Loading shape: the hero's label and number, the chart box, then the rows with real stage names and their tracks. */
export function SleepStagesSkeleton() {
  return (
    <View accessibilityElementsHidden className="gap-4">
      <View>
        <Text className={cn(LABEL, "text-foreground-secondary")}>Hours of sleep</Text>
        <View className="mt-1.5 w-16">
          <SkeletonText lh={36} fs={32} />
        </View>
        <View className="w-16">
          <SkeletonText />
        </View>
      </View>
      <SleepHrChartSkeleton />
      <View className="border-t border-border pt-4">
        <StageRowsSkeleton />
      </View>
    </View>
  );
}
SleepStages.Skeleton = SleepStagesSkeleton;
