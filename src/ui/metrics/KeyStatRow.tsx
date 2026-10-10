import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { deltaTone, type ChipTone, type DeltaDir, type GoodDirection, type Tone } from "@/lib/bands";
import { formatValue, MISSING, statSentence, type FormatKey } from "@/lib/format";
import { reasonCopy, type Metric, type ReasonCode } from "@/lib/reasons";
import { CARD_CLASS, CardFill, useCardStyle } from "../Card";
import { cn } from "../cn";
import { alpha } from "../color";
import { Icon } from "../Icon";
import { MetricState, type MetricMeta } from "../shells/MetricState";
import { SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { CAPTION, DeltaMark, LABEL, MetricTags, StatusChip, ValueUnit } from "./primitives";
import { Sparkline } from "./Sparkline";

export type SleepStatus = "poor" | "sufficient" | "optimal";

export type KeyStatRowProps = {
  variant: "row" | "card" | "tile";
  icon?: ReactNode;
  label: string;
  caption?: string;
  metric: Metric<number> | null | undefined;
  unit?: string;
  format: FormatKey;
  /** The 30-day average, shown under the value (row) or as the delta chip (tile). */
  average?: number | null;
  /** Spoken name of the comparison; default "30-day average". */
  averageLabel?: string;
  /** Good direction for the arrow tone; "none" hides the arrow (Strain Target, stage rows). */
  direction: GoodDirection | "none";
  sd?: number;
  status?: SleepStatus;
  chip?: { tone: ChipTone; text: string };
  href?: string;
  /** The tile or row becomes a button (opens a sheet). */
  onSelect?: () => void;
  /** A full-width tile: label and value on the left, the comparison on the right. (The web restricts it to a breakpoint; on a phone every setting is wide.) */
  wide?: boolean | "md" | "xl";
  /** A wide tile's recent values (oldest first) drawn on its right as a sparkline, with `band` shaded as the normal range. */
  spark?: { values: (number | null)[]; band?: { low: number; high: number } | null; caption?: string };
  className?: string;
};

const TILE_LABEL = "text-[10px] font-bold uppercase leading-3 tracking-[0.1em]";
const TILE_CHIP = "min-h-5 px-1.5 py-0.5";
const STATUS_ACTIVE: Record<SleepStatus, string> = { poor: "bg-warning", sufficient: "bg-foreground-secondary", optimal: "bg-optimal" };

type Computed = { valueText: string; avgText?: string; diffText?: string; dir?: DeltaDir; tone?: Tone; reason?: string; meta?: MetricMeta; loading?: boolean };
const LOADING: Computed = { valueText: "", loading: true };

function compute(p: KeyStatRowProps, value: number | null, meta?: MetricMeta, reason?: ReasonCode): Computed {
  if (value === null) return { valueText: MISSING, reason: reasonCopy(reason, meta?.nightsLeft).short };
  const avg = p.average ?? null;
  const t = avg !== null && p.direction !== "none" ? deltaTone(p.direction, value, avg, p.sd) : undefined;
  const diff = avg !== null ? value - avg : null;
  const diffText = diff === null || formatValue(p.format, Math.abs(diff)) === formatValue(p.format, 0) ? undefined : `${diff > 0 ? "+" : "−"}${formatValue(p.format, Math.abs(diff))}`;
  return { valueText: formatValue(p.format, value), avgText: avg !== null ? formatValue(p.format, avg) : undefined, diffText, dir: t?.dir, tone: t?.tone, meta };
}

/** The row's outer element: a link, a button, or a plain view. It reads as one sentence to a screen reader and hides its parts. */
function Frame({ p, className, children, sentence, style }: { p: KeyStatRowProps; className: string; children: ReactNode; sentence: string; style?: object }) {
  const press = p.href ? () => router.push(p.href as Href) : p.onSelect;
  if (press)
    return (
      <Pressable accessibilityRole={p.href ? "link" : "button"} accessibilityLabel={sentence} onPress={press} className={cn(className, "active:scale-[0.96]")} style={style}>
        {children}
      </Pressable>
    );
  return (
    <View accessible accessibilityLabel={sentence || undefined} className={className} style={style}>
      {children}
    </View>
  );
}

const TONE_TEXT: Record<Tone, string> = { good: "text-optimal-text", bad: "text-warning-text", neutral: "text-foreground-secondary" };
const unitSuffix = (unit?: string) => (unit ? (unit === "%" ? "%" : ` ${unit}`) : "");

function Row({ p, c }: { p: KeyStatRowProps; c: Computed }) {
  const card = p.variant === "card";
  const shadow = useCardStyle();
  const sentence = c.loading
    ? ""
    : c.reason
      ? `${p.label}: ${c.reason}`
      : statSentence({ label: p.label, valueText: c.valueText, unit: p.unit, averageText: c.avgText, averageLabel: p.averageLabel, dir: c.dir, tone: c.tone });
  const disabled = c.loading ? { ...p, href: undefined, onSelect: undefined } : p;
  return (
    <Frame p={disabled} sentence={sentence} className={card ? cn(CARD_CLASS, "min-h-14 flex-row items-center gap-3 px-4 py-2", p.className) : cn("min-h-14 flex-row items-center gap-3 py-2", p.className)} style={card ? shadow : undefined}>
      {card && <CardFill />}
      {p.icon && <View className="size-5 shrink-0 items-center justify-center">{p.icon}</View>}
      <View className="min-w-0 flex-1">
        {/* Long metric labels must wrap to fit narrow phone widths. */}
        {p.label ? <Text className={LABEL}>{p.label}</Text> : <SkeletonText className="w-32" />}
        {(c.reason || p.caption) && (
          <Text className={cn(CAPTION, "mt-0.5")} numberOfLines={1}>
            {c.reason ?? p.caption}
          </Text>
        )}
        {/* Tags sit under the label so a phone never truncates it. */}
        {c.meta && <MetricTags provisional={c.meta.provisional} tags={c.meta.tags} className="mt-1 justify-start" />}
      </View>
      {p.status && (
        <View className="shrink-0 flex-row gap-1">
          {(["poor", "sufficient", "optimal"] as const).map((k) => (
            <View key={k} className={cn("h-1 w-4 rounded-sm", !c.reason && p.status === k ? STATUS_ACTIVE[k] : "bg-dial-track")} />
          ))}
        </View>
      )}
      <View className="shrink-0 flex-row gap-2">
        <View className="items-end">
          {c.loading ? (
            <View className="w-10">
              <SkeletonText lh={24} fs={20} />
            </View>
          ) : (
            // A My Dashboard card prints the number alone ("43", "5,185"), percent kept, as the reference app does (dashboard-01); the spoken sentence keeps the unit.
            <ValueUnit value={c.valueText} unit={card && p.unit !== "%" ? undefined : p.unit} className={cn("font-numeric text-xl font-bold leading-6", c.reason && "text-muted-foreground")} />
          )}
          {c.avgText && !c.reason && (
            <Text className="font-numeric text-[13px] font-medium leading-4 tabular-nums text-muted-foreground">
              {c.avgText}
              {p.unit === "%" && "%"}
            </Text>
          )}
        </View>
        {p.direction !== "none" && <View className="h-6 w-2 items-center justify-center">{c.dir && <DeltaMark dir={c.dir} tone={c.tone!} />}</View>}
      </View>
      {p.href && !card && <Icon icon={ChevronRight} size={16} tone="muted-foreground" />}
    </Frame>
  );
}

function Tile({ p, c }: { p: KeyStatRowProps; c: Computed }) {
  const { c: colors } = useTheme();
  const shadow = useCardStyle();
  const flagged = !c.reason && !c.loading && (p.chip?.tone === "warning" || p.chip?.tone === "alert");
  const wide = !!p.wide;
  const sentence = c.loading
    ? ""
    : c.reason
      ? `${p.label}: ${c.reason}`
      : [statSentence({ label: p.label, valueText: c.valueText, unit: p.unit, averageText: p.chip ? undefined : c.avgText, averageLabel: p.averageLabel, dir: c.dir, tone: c.tone }), p.chip?.text].filter(Boolean).join(", ");
  const ring = flagged ? `, inset 0 0 0 1px ${alpha(colors.warning, 0.5)}` : "";
  return (
    <Frame
      p={c.loading ? { ...p, href: undefined, onSelect: undefined } : p}
      sentence={sentence}
      className={cn(CARD_CLASS, "min-w-0 gap-3 p-3", wide ? "flex-row items-center" : "min-h-[124px]", p.className)}
      style={{ boxShadow: `${shadow.boxShadow}${ring}` }}
    >
      <CardFill ring={flagged ? alpha(colors.warning, 0.5) : undefined} />
      <View className={cn(wide ? "min-w-0 flex-1 gap-2" : "flex-1 gap-3", p.spark && "flex-none")}>
        <View className="flex-row items-center gap-2.5">
          {p.icon && <View className="size-5 shrink-0 items-center justify-center">{p.icon}</View>}
          {p.label ? (
            <Text className={cn(TILE_LABEL, "min-w-0 shrink text-foreground-secondary")} numberOfLines={3}>
              {p.label}
            </Text>
          ) : (
            <SkeletonText className="w-24" lh={12} fs={10} />
          )}
        </View>
        <View className={cn("items-start gap-2", !wide && "mt-auto")}>
          {c.loading ? (
            <>
              <View className="w-10">
                <SkeletonText lh={36} fs={30} />
              </View>
              <SkeletonText className="w-28" lh={20} fs={11} />
            </>
          ) : (
            <ValueUnit value={c.valueText} unit={p.unit} className={cn("font-numeric text-[30px] font-bold leading-9 tracking-[-0.01em]", c.reason && "text-muted-foreground")} unitClassName="text-sm font-medium leading-5 text-foreground" />
          )}
          {c.loading ? null : c.reason ? (
            <Text className={CAPTION}>{c.reason}</Text>
          ) : (
            <>
              {c.meta && <MetricTags provisional={c.meta.provisional} tags={c.meta.tags} className="justify-start" />}
              {/* On a wide tile the comparison moves to the right (below), unless there is a sparkline to show instead. */}
              {!wide &&
                (p.chip ? (
                  <StatusChip tone={p.chip.tone} className={TILE_CHIP} textClassName="text-[11px]">
                    {p.chip.text}
                  </StatusChip>
                ) : (
                  c.avgText && (
                    <StatusChip tone="neutral" delta={c.dir} className={TILE_CHIP} textClassName="text-[11px]">
                      {c.avgText}
                      {p.unit && <Text className="font-semibold">{p.unit === "%" ? "%" : ` ${p.unit}`}</Text>}
                    </StatusChip>
                  )
                ))}
            </>
          )}
        </View>
      </View>
      {wide && p.spark && !c.loading && (
        <Sparkline values={p.spark.values} band={p.spark.band} color={p.chip?.tone === "warning" || p.chip?.tone === "alert" ? colors.warning : colors["foreground-secondary"]} caption={p.spark.caption} className="h-16 min-w-0 flex-1 self-center" />
      )}
      {wide && !p.spark && !c.loading && !c.reason && (p.chip || c.avgText) && (
        <View className="shrink-0 items-end gap-1">
          <Text className={CAPTION}>{p.chip ? "Your range" : (p.averageLabel ?? "30-day avg")}</Text>
          {p.chip ? (
            <StatusChip tone={p.chip.tone} className={TILE_CHIP} textClassName="text-[11px]">
              {p.chip.text}
            </StatusChip>
          ) : (
            <>
              <ValueUnit value={c.avgText!} unit={p.unit} className="font-numeric text-lg font-bold leading-6" unitClassName="text-xs font-medium leading-4 text-muted-foreground" />
              {c.diffText && (
                <Text className={cn("font-numeric text-xs font-bold leading-4 tabular-nums", TONE_TEXT[c.tone ?? "neutral"])}>
                  {c.diffText}
                  {unitSuffix(p.unit)} vs avg
                </Text>
              )}
            </>
          )}
        </View>
      )}
    </Frame>
  );
}

export function KeyStatRow(p: KeyStatRowProps) {
  const View_ = p.variant === "tile" ? Tile : Row;
  return (
    <MetricState
      metric={p.metric}
      skeleton={<View_ p={p} c={LOADING} />}
      empty={<View_ p={p} c={compute(p, null, undefined, "no_data")} />}
      renderReason={(reason, meta) => <View_ p={p} c={compute(p, null, meta, reason)} />}
    >
      {(value, meta) => <View_ p={p} c={compute(p, value, meta)} />}
    </MetricState>
  );
}

export function KeyStatRowSkeleton({ variant, label = "", icon }: { variant: KeyStatRowProps["variant"]; label?: string; icon?: ReactNode }) {
  const p: KeyStatRowProps = { variant, label, icon, metric: undefined, format: "int", direction: "none" };
  return variant === "tile" ? <Tile p={p} c={LOADING} /> : <Row p={p} c={LOADING} />;
}
KeyStatRow.Skeleton = KeyStatRowSkeleton;
