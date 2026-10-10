import { Pressable, View } from "react-native";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react-native";
import { formatValue } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { CARD_CLASS, CardFill, useCardStyle, useInCard } from "../Card";
import { cn } from "../cn";
import { Hatch } from "../Hatch";
import { Icon } from "../Icon";
import { EmptyState } from "../shells/EmptyState";
import { MetricState } from "../shells/MetricState";
import { SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { MetricTags } from "./primitives";

export type DriverItem = {
  key: string;
  label: string;
  /** Signed effect, in `unit`. U10 sorts by |delta| descending. */
  delta: number;
  /** "none": no clear effect (CI crosses zero). Defaults to the sign of `delta`. */
  effect?: "positive" | "negative" | "none";
  /** Impact variant: days with and without the behaviour, and the 90% CI. */
  yes?: number;
  no?: number;
  ci?: [number, number];
};

export type DriverListProps = {
  variant: "recovery" | "impact";
  unit: "pts" | "%" | "SD";
  data: Metric<DriverItem[]> | null | undefined;
  selectedKey?: string;
  /** Impact rows open their detail. */
  onSelect?: (key: string) => void;
  /** Impact variant: the next-day outcome in the spoken sentence ("Recovery", "HRV", "sleep performance"). */
  outcome?: string;
};

const fmt = (v: number, unit: DriverListProps["unit"]) => (unit === "SD" ? `${formatValue("signed1", v)} SD` : `${formatValue("signedInt", v)}${unit === "%" ? "%" : ""}`);
const effectOf = (i: DriverItem) => i.effect ?? (i.delta > 0 ? "positive" : i.delta < 0 ? "negative" : "none");
const unitWord = { pts: "points", "%": "percent", SD: "standard deviations" };

function sentence(i: DriverItem, variant: DriverListProps["variant"], unit: DriverListProps["unit"], outcome = "Recovery") {
  const e = effectOf(i);
  const size = `${formatValue(unit === "SD" ? "decimal1" : "int", Math.abs(i.delta))} ${unitWord[unit]}`;
  if (variant === "recovery") return e === "none" ? `${i.label}: no clear effect` : `${i.label} ${e === "positive" ? "raised" : "lowered"} Recovery by ${size}`;
  const k = unit === "SD" ? "decimal1" : "int";
  const ci = i.ci ? `, 90 percent confidence ${formatValue(k, Math.min(Math.abs(i.ci[0]), Math.abs(i.ci[1])))} to ${formatValue(k, Math.max(Math.abs(i.ci[0]), Math.abs(i.ci[1])))}` : "";
  const n = i.yes !== undefined && i.no !== undefined ? `, from ${i.yes} days with and ${i.no} without` : "";
  const verb = e === "none" ? `had no clear effect on next-day ${outcome}` : `${e === "positive" ? "raised" : "lowered"} next-day ${outcome} by ${size}`;
  return `${i.label} ${verb}${ci}${n}`;
}

function Header({ variant, unit, provisional }: { variant: DriverListProps["variant"]; unit: DriverListProps["unit"]; provisional: boolean }) {
  const [left, mid, right] = variant === "recovery" ? ["Lowered", "Points", "Raised"] : ["Hurts", unit === "SD" ? "Impact (SD)" : "% Impact", "Helps"];
  const cap = "text-xs font-bold uppercase leading-4 tracking-[0.1em]";
  return (
    <View accessibilityElementsHidden className="mb-2 flex-row items-center justify-between gap-2">
      <View className="flex-1 flex-row items-center gap-2">
        <View className="size-4 items-center justify-center rounded-sm bg-warning/20">
          <Icon icon={ChevronDown} size={12} tone="warning-text" strokeWidth={2.5} />
        </View>
        <Text className={cn(cap, "text-warning-text")}>{left}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <Text className={cn(cap, "text-muted-foreground")}>{mid}</Text>
        {provisional && <MetricTags provisional />}
      </View>
      <View className="flex-1 flex-row items-center justify-end gap-2">
        <Text className={cn(cap, "text-optimal-text")}>{right}</Text>
        <View className="size-4 items-center justify-center rounded-sm bg-optimal/20">
          <Icon icon={ChevronUp} size={12} tone="optimal-text" strokeWidth={2.5} />
        </View>
      </View>
    </View>
  );
}

function Item({ i, max, p }: { i: DriverItem; max: number; p: DriverListProps }) {
  const e = effectOf(i);
  const inCard = useInCard();
  const shadow = useCardStyle();
  const impact = p.variant === "impact";
  const value = <Text className={cn("shrink-0 font-numeric text-base font-bold tabular-nums", e === "positive" ? "text-optimal-text" : e === "negative" ? "text-warning-text" : "text-foreground-secondary")}>{fmt(i.delta, p.unit)}</Text>;
  const track = (
    <Hatch className={cn("h-2 rounded-sm", impact && "flex-1")}>
      {i.delta !== 0 && <View className={cn("absolute inset-y-0 rounded-sm", i.delta > 0 ? "left-1/2" : "right-1/2", e === "positive" ? "bg-optimal" : e === "negative" ? "bg-warning" : "bg-muted-foreground")} style={{ width: `${(Math.abs(i.delta) / (max || 1)) * 50}%` }} />}
      <View className={cn("absolute left-1/2 top-1/2 -ml-[5px] -mt-[5px] size-2.5 rounded-full border-2 bg-foreground", inCard ? "border-secondary" : "border-card")} />
    </Hatch>
  );
  const content = (
    <View accessible accessibilityLabel={sentence(i, p.variant, p.unit, p.outcome)} className="gap-2">
      {impact ? (
        // The reference app's behaviour rows: the name in sentence case with a chevron, the % at the track's end (spec §11 F17).
        <View className="flex-row items-center justify-between gap-3">
          <Text className="min-w-0 flex-1 text-[15px] font-medium leading-5">{i.label}</Text>
          {p.onSelect && <Icon icon={ChevronRight} size={20} tone="foreground-secondary" />}
        </View>
      ) : (
        <View className="flex-row items-baseline justify-between gap-3">
          <Text className="min-w-0 flex-1 text-xs font-bold uppercase leading-4 tracking-[0.1em]">{i.label}</Text>
          {value}
        </View>
      )}
      {impact ? (
        <View className="flex-row items-center gap-3">
          {track}
          {value}
        </View>
      ) : (
        track
      )}
      {impact && i.yes !== undefined && i.no !== undefined && (
        <Text className="text-xs font-medium leading-4 tabular-nums text-muted-foreground">
          {i.yes} days with, {i.no} without.
          {i.ci && ` 90% CI ${fmt(i.ci[0], p.unit).replace(/^\+/, "")} to ${fmt(i.ci[1], p.unit).replace(/^\+/, "")}`}
        </Text>
      )}
    </View>
  );
  // Each row is its own card; inside a card it steps down to a 10 px bg-secondary row (no card in a card). Rows that open a sheet press in.
  const cls = cn(inCard ? "rounded-lg bg-secondary" : CARD_CLASS, "px-4 py-3");
  const style = inCard ? undefined : shadow;
  const selected = p.selectedKey === i.key;
  const ring = selected ? { boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.6)" } : null;
  const fill = !inCard && <CardFill ring={selected ? "rgba(255, 255, 255, 0.6)" : undefined} />;
  return p.onSelect ? (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => p.onSelect?.(i.key)} className={cn(cls, "active:scale-[0.96]")} style={[style, ring]}>
      {fill}
      {content}
    </Pressable>
  ) : (
    <View className={cls} style={style}>
      {fill}
      {content}
    </View>
  );
}

/** Ranked effects as diverging bars on the reference app's hatched track (spec §5.4). */
export function DriverList(p: DriverListProps) {
  const empty =
    p.variant === "recovery" ? (
      <EmptyState body="No drivers yet: Recovery needs 7 nights first." />
    ) : (
      <EmptyState body="Not enough check-ins yet. Insights need 5 days with and 5 without a behaviour in the last 90 days." action={{ label: "Check in", sheet: "checkin" }} />
    );
  return (
    <MetricState metric={p.data} skeleton={<DriverListSkeleton variant={p.variant} unit={p.unit} />} empty={empty} renderReason={() => null}>
      {(items, meta) => {
        const max = Math.max(...items.map((i) => Math.abs(i.delta)));
        return (
          <View>
            <Header variant={p.variant} unit={p.unit} provisional={meta.provisional} />
            <View className="gap-2">
              {items.map((i) => (
                <Item key={i.key} i={i} max={max} p={p} />
              ))}
            </View>
          </View>
        );
      }}
    </MetricState>
  );
}

/** Loading shape (spec §5.19): the real header and each row's own box, with bars for the label, value and caption. */
export function DriverListSkeleton({ variant = "impact", unit = "%", rows = 3 }: { variant?: DriverListProps["variant"]; unit?: DriverListProps["unit"]; rows?: number }) {
  const impact = variant === "impact";
  const shadow = useCardStyle();
  const value = (
    <View className="w-14 shrink-0">
      <SkeletonText lh={24} fs={16} />
    </View>
  );
  return (
    <View accessibilityElementsHidden>
      <Header variant={variant} unit={unit} provisional={false} />
      <View className="gap-2">
        {Array.from({ length: rows }, (_, k) => (
          <View key={k} className={cn(CARD_CLASS, "gap-2 px-4 py-3")} style={shadow}>
            <CardFill />
            <View className="flex-row items-center justify-between gap-3">
              <SkeletonText className="w-28" lh={impact ? 20 : 16} fs={impact ? 15 : 12} />
              {!impact && value}
            </View>
            <View className={cn(impact && "flex-row items-center gap-3")}>
              <Hatch className={cn("h-2 rounded-sm", impact && "flex-1")} />
              {impact && value}
            </View>
            {impact && <SkeletonText className="w-56" />}
          </View>
        ))}
      </View>
    </View>
  );
}
DriverList.Skeleton = DriverListSkeleton;
