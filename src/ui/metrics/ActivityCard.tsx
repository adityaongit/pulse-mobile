import type { ReactNode } from "react";
import { View } from "react-native";
import { clock, formatValue, spoken } from "@/lib/format";
import { quantity } from "@/lib/units";
import type { Metric } from "@/lib/reasons";
import { cn } from "../cn";
import { Icon } from "../Icon";
import { ACTIVITY_ICON, type ActivityKind } from "../icons";
import { Skeleton, SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { capTrim } from "./primitives";
import { push } from "../navigate";
import { Press } from "../Press";
import { SECONDARY_ROW } from "../Card";

/** The chip's 20 px value, cap-trimmed as the web's CAP_TRIM. */
const VALUE_TRIM = capTrim(20, "numeric");

export type { ActivityKind };
export { ACTIVITY_ICON };

export type ActivityCardProps = {
  /** "Running", "Strength training", "Cycling", "Walking", "Workout". */
  name: string;
  kind: ActivityKind;
  /** Activity strain; null with `insufficient_hr_data` shows "--". */
  strain: Metric<number>;
  /** Epoch ms. */
  start: number;
  end: number;
  /** `/activity/[id]`. */
  href: string;
  timeZone?: string;
  /** Recorded distance; the caption shows it (with pace) under the name. Omit or null for none. */
  distanceKm?: number | null;
  /** Seconds per km (runs and walks). */
  paceS?: number | null;
};

/** "5.21 km at 5:32 /km", "3.24 mi at 8:55 /mi", "18.40 km", or null with no distance: in the person's units. */
export function distanceText(km: number | null | undefined, paceS?: number | null) {
  if (km == null) return null;
  const d = quantity("km");
  const p = quantity("/km");
  const distance = `${formatValue("decimal2", d.value(km))} ${d.unit}`;
  return paceS == null ? distance : `${distance} at ${formatValue("pace", p.value(paceS))} ${p.unit}`;
}

// Rows are 10 px inside a 16 px card with a 6 px inset; the chip is 8 px inside the row (concentric, spec §2.4).
const ROW = `${SECONDARY_ROW} h-14 flex-row items-center gap-3 pl-1.5 pr-3`;
// One fixed width, so every row's title starts on the same line whatever the number ("6.3", "11.4", "7:13").
const CHIP = "h-11 w-[84px] shrink-0 flex-row items-center justify-center gap-1.5 rounded-md";

/** One row on the day's timeline (spec §5.12). Shared by ActivityCard and SleepCard. */
export function TimelineRow({
  href,
  chip,
  chipClass,
  barClass,
  name,
  caption,
  start,
  end,
  label,
}: {
  href: string;
  chip: ReactNode;
  chipClass: string;
  /** The thin bar after the times: white for sleep, strain blue for activities (spec §11 F18). */
  barClass: string;
  name: string;
  caption?: string;
  start: string;
  end: string;
  label: string;
}) {
  return (
    <Press activeScale={0.96} activeBg="bg-accent" accessibilityRole="link" accessibilityLabel={label} onPress={() => push(href)} className={ROW}>
      <View className={cn(CHIP, chipClass)}>{chip}</View>
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-bold uppercase leading-5 tracking-[0.1em]">{name}</Text>
        {!!caption && (
          <Text className="text-xs font-medium leading-4 text-muted-foreground" numberOfLines={1}>
            {caption}
          </Text>
        )}
      </View>
      <View className="shrink-0 items-end">
        <Text className="font-numeric text-xs font-medium leading-4 tabular-nums text-foreground-secondary">{start}</Text>
        <Text className="font-numeric text-xs font-medium leading-4 tabular-nums text-foreground-secondary">{end}</Text>
      </View>
      <View accessibilityElementsHidden className={cn("-ml-1 h-7 w-0.5 shrink-0 rounded-full", barClass)} />
    </Press>
  );
}

export function ActivityCard({ name, kind, strain, start, end, href, timeZone, distanceKm, paceS }: ActivityCardProps) {
  const glyph = ACTIVITY_ICON[kind];
  const s = clock(start, timeZone);
  const e = clock(end, timeZone);
  const value = formatValue("pct", strain.value);
  const distance = distanceText(distanceKm, paceS);
  const noStrain = strain.value === null;
  // The full reason when it is the only caption; beside a distance, the short form keeps the row on one line.
  const caption = distance ? (noStrain ? `${distance} · No strain` : distance) : noStrain ? "No strain: not enough heart-rate data" : undefined;
  const [d, p] = [quantity("km"), quantity("/km")];
  const spokenDistance = distanceKm == null ? "" : `, ${spoken(formatValue("decimal2", d.value(distanceKm)), d.unit)}${paceS == null ? "" : ` at ${spoken(formatValue("pace", p.value(paceS)), p.unit)}`}`;
  return (
    <TimelineRow
      href={href}
      chipClass="bg-strain"
      barClass="bg-strain"
      chip={
        <>
          <Icon icon={glyph} size={16} tone="foreground" strokeWidth={1.75} />
          <Text className={cn("font-numeric text-xl font-bold tabular-nums", noStrain && "text-foreground-secondary")} style={VALUE_TRIM}>{value}</Text>
        </>
      }
      name={name}
      caption={caption}
      start={s}
      end={e}
      label={`${name}${spokenDistance}, ${noStrain ? "no strain" : `strain ${value}`}, ${s} to ${e}`}
    />
  );
}

/** Two timeline rows in their real box: the row, its chip, bars for the name and times. */
export function TimelineSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <View accessibilityElementsHidden className="gap-1.5">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className={ROW}>
          <Skeleton className={cn(CHIP, "bg-muted")} />
          <SkeletonText className="w-20 flex-1" lh={20} fs={15} />
          <View className="w-10 shrink-0">
            <SkeletonText />
            <SkeletonText />
          </View>
          <View className="-ml-1 h-7 w-0.5 shrink-0 rounded-full bg-muted" />
        </View>
      ))}
    </View>
  );
}
ActivityCard.Skeleton = TimelineSkeleton;
