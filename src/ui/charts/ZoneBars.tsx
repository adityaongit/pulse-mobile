import { View } from "react-native";

import { DATA_COLORS, ZONE_COLOR, type DataColor } from "@/lib/bands";
import { durationWords, hmm } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { cn } from "../cn";
import { Hatch } from "../Hatch";
import { LABEL } from "../metrics/primitives";
import { EmptyState } from "../shells/EmptyState";
import { MetricState } from "../shells/MetricState";
import { Skeleton, SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { push } from "../navigate";
import { SECONDARY_ROW } from "../Card";
import { BAR_CORNERS } from "@/ui/radius";

/** `zone` 0-5 orders the rows (0 is time under Zone 1: `min` 0, `max` the bpm below Zone 1); `label` names it ("Zone 1"). */
export type ZoneRow = {
  zone: number;
  label: string;
  min: number;
  max: number | null;
  seconds: number;
  /** Activity only: the middle half of this zone's share (0-1) over the last 30 days of the same kind. */
  typical?: { low: number; high: number };
};
export type StackedSegment = { key: string; label: string; count: number; color: DataColor };

export type ZoneBarsProps =
  | {
      variant: "rows";
      /** Zones in any order; drawn top zone first. `max: null` is the open top zone ("173+ bpm"). */
      data: Metric<ZoneRow[]> | null | undefined;
      /** Where the zones came from, under the rows. */
      note?: string;
      /** A link after the note (activity-02's "View HR Settings"). */
      noteLink?: { label: string; href: string };
      emptyCopy?: string;
    }
  | {
      variant: "stacked";
      /** "days": Recovery breakdown (4x). "minutes": stress levels (h:mm). */
      unit: "days" | "minutes";
      data: Metric<StackedSegment[]> | null | undefined;
      emptyCopy?: string;
    };

function share(part: number, total: number) {
  if (!total || !part) return "0%";
  const p = (part / total) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
}

function Rows({ zones, note, noteLink }: { zones: ZoneRow[]; note?: string; noteLink?: { label: string; href: string } }) {
  const total = zones.reduce((a, z) => a + z.seconds, 0);
  const sorted = [...zones].sort((a, b) => b.zone - a.zone);
  const typical = sorted.some((z) => z.typical);
  // No time in any zone (an easy walk): one line that says so, not greyed rows of 0:00:00.
  const lowest = sorted.findLast((z) => z.zone > 0);
  if (!total && lowest)
    return (
      <View>
        <Text className={cn(SECONDARY_ROW, "px-3 py-3 text-[15px] leading-[22px] text-foreground-secondary")}>
          Heart rate stayed under the {lowest.label} zone ({lowest.min}{" "}bpm) the whole time.
        </Text>
        <Note note={note} link={noteLink} />
      </View>
    );
  const T = Math.round(total);
  return (
    <View>
      <View accessibilityElementsHidden className="mb-2 flex-row items-baseline justify-between px-1">
        <View className={cn("shrink flex-row items-center gap-1.5", !typical && "opacity-0")}>
          <Hatch className="size-2.5 rounded-xs border border-border" />
          <Text className={cn(LABEL, "text-muted-foreground")}>Typical range</Text>
        </View>
        <View className="flex-row items-baseline gap-2">
          <Text className={cn(LABEL, "text-muted-foreground")}>Duration</Text>
          <Text className="font-numeric text-[15px] font-bold leading-5 tabular-nums text-foreground">
            {hmm(Math.floor(T / 60))}
            <Text className="text-xs text-muted-foreground">{`:${String(T % 60).padStart(2, "0")}`}</Text>
          </Text>
        </View>
      </View>
      <View className="gap-2">
        {sorted.map((z) => {
          const below = z.zone === 0;
          const range = below ? `<${z.max! + 1} bpm` : z.max === null ? `${z.min}+ bpm` : `${z.min}-${z.max} bpm`;
          const spoken = below ? `under ${z.max! + 1} bpm` : range.replace("-", " to ").replace("+", " and above");
          const sh = share(z.seconds, total);
          const t = Math.round(z.seconds);
          const minutes = Math.floor(t / 60);
          const color = ZONE_COLOR[z.zone] ? DATA_COLORS[ZONE_COLOR[z.zone]] : null;
          const lo = z.typical ? Math.min(100, z.typical.low * 100) : 0;
          const hi = z.typical ? Math.min(100, z.typical.high * 100) : 0;
          return (
            <View
              key={z.zone}
              accessible
              accessibilityLabel={`${z.label} zone, ${spoken}, ${durationWords(minutes)}, ${sh === "<1%" ? "under 1 percent" : sh.replace("%", " percent")}`}
              className={cn(SECONDARY_ROW, "gap-2 px-3 py-2.5", !z.seconds && "opacity-40")}
            >
              <View className="flex-row items-baseline gap-2">
                <Text className={cn(LABEL)}>{z.label}</Text>
                <Text className={cn(LABEL, "font-numeric text-muted-foreground")}>{range}</Text>
                {/* The share in the zone's colour, 0% included; Zones 0 and 1 stay white. */}
                <Text className={cn(LABEL, "font-numeric tabular-nums", color && z.zone > 1 ? color.text : "text-foreground")}>{sh}</Text>
                <Text className="ml-auto font-numeric text-lg font-bold leading-6 tabular-nums">
                  {hmm(minutes)}
                  <Text className="text-xs text-muted-foreground">{`:${String(t % 60).padStart(2, "0")}`}</Text>
                </Text>
              </View>
              <Hatch accessibilityElementsHidden className="h-3 rounded-xs">
                <View className={cn("absolute inset-y-0 left-0 rounded-xs", color ? color.bg : "bg-foreground")} style={{ width: total ? `${(z.seconds / total) * 100}%` : 0 }} />
                {/* Your typical range for this kind of activity: a lit band between two dashed ticks, over the bar. */}
                {z.typical && (
                  <View
                    className="absolute -inset-y-0.5 border-x border-dashed border-foreground/80 bg-fill-pressed"
                    style={{ left: `${lo}%`, width: `${Math.max(0, hi - lo)}%` }}
                  />
                )}
              </Hatch>
            </View>
          );
        })}
      </View>
      <Note note={note} link={noteLink} />
    </View>
  );
}

function Note({ note, link }: { note?: string; link?: { label: string; href: string } }) {
  if (!note) return null;
  return (
    <Text className="mt-3 text-xs font-medium leading-4 text-muted-foreground">
      {note}
      {link && (
        <>
          {" "}
          <Text accessibilityRole="link" onPress={() => push(link.href)} className="text-foreground-secondary underline">
            {link.label}
          </Text>
        </>
      )}
    </Text>
  );
}

function Stacked({ segments, unit }: { segments: StackedSegment[]; unit: "days" | "minutes" }) {
  const shown = segments.filter((s) => s.count > 0);
  const count = (n: number) => (unit === "days" ? `${n}x` : hmm(n));
  return (
    <View>
      <View accessibilityElementsHidden className={cn("h-3 flex-row gap-0.5 overflow-hidden", BAR_CORNERS)}>
        {shown.map((s) => (
          <View key={s.key} className={cn("h-full", DATA_COLORS[s.color].bg)} style={{ flexGrow: s.count, flexBasis: 0 }} />
        ))}
      </View>
      <View className="mt-3 gap-1.5">
        {segments.map((s) => (
          <View key={s.key} accessible accessibilityLabel={`${s.label}: ${unit === "days" ? `${s.count} ${s.count === 1 ? "day" : "days"}` : durationWords(s.count)}`} className="flex-row items-center gap-3">
            <View className={cn("size-2.5 shrink-0 rounded-sm", DATA_COLORS[s.color].bg)} />
            <Text className="w-12 font-numeric text-[15px] font-bold leading-5 tabular-nums">{count(s.count)}</Text>
            <Text className={cn(LABEL, "text-muted-foreground")}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Time in zones as rows, or a stacked breakdown bar (spec §5.8, D5): plain views, not a chart. */
export function ZoneBars(p: ZoneBarsProps) {
  const empty = <EmptyState body={p.emptyCopy ?? (p.variant === "rows" ? "No heart-rate zones yet today." : "No days with Recovery in this period.")} />;
  if (p.variant === "rows")
    return (
      <MetricState metric={p.data} skeleton={<ZoneBarsSkeleton variant="rows" />} empty={empty}>
        {(zones) => <Rows zones={zones} note={p.note} noteLink={p.noteLink} />}
      </MetricState>
    );
  return (
    <MetricState metric={p.data} skeleton={<ZoneBarsSkeleton variant="stacked" />} empty={empty}>
      {(segments) => (segments.some((s) => s.count > 0) ? <Stacked segments={segments} unit={p.unit} /> : empty)}
    </MetricState>
  );
}

export function ZoneBarsSkeleton({ variant }: { variant: "rows" | "stacked" }) {
  if (variant === "rows")
    return (
      // Each zone row's own box: the real zone name, bars for range and time, the hatched track.
      <View accessibilityElementsHidden className="gap-2">
        {["Zone 5", "Zone 4", "Zone 3", "Zone 2", "Zone 1", "Zone 0"].map((k) => (
          <View key={k} className={cn(SECONDARY_ROW, "gap-2 px-3 py-2.5")}>
            <View className="flex-row items-center gap-3">
              <Text className={LABEL}>{k}</Text>
              <SkeletonText className="w-20" />
              <SkeletonText className="ml-auto w-14" lh={24} fs={18} />
            </View>
            <Hatch className="h-3 rounded-xs" />
          </View>
        ))}
      </View>
    );
  return (
    <View accessibilityElementsHidden className="gap-3">
      <Skeleton className="h-3 rounded-sm" />
      {[0, 1, 2].map((k) => (
        <Skeleton key={k} className="h-4 w-40" />
      ))}
    </View>
  );
}
ZoneBars.Skeleton = ZoneBarsSkeleton;
