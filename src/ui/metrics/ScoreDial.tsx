import { View } from "react-native";

import Svg, { Defs, LinearGradient, Path, Polygon, RadialGradient, Stop } from "react-native-svg";
import { ChevronRight } from "lucide-react-native";
import { BAND_WORD, DATA_COLORS, dialColor, recoveryBand, STRESS_COLOR, STRESS_WORD, stressLevel, type DataColor } from "@/lib/bands";
import { dialAriaLabel, formatValue, type FormatKey } from "@/lib/format";
import { reasonCopy, type MetricTag, type ReasonCode } from "@/lib/reasons";
import { Wordmark } from "../brand";
import { arcPath, polar } from "../charts/geometry";
import { cn } from "../cn";
import { Icon } from "../Icon";
import { REASON_ICON } from "../icons";
import { markerSlices, ringShare } from "@/lib/charts";
import { SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { ARC_FROM, ARC_SWEEP } from "./MiniRing";
import { capTrim, type TagKind } from "./primitives";
import { push } from "../navigate";
import { Press } from "../Press";

export type DialSize = "sm" | "md" | "lg";
export type DialVariant = "recovery" | "strain" | "sleep" | "stat" | "gauge";

export type ScoreDialProps = {
  variant: DialVariant;
  size: DialSize;
  /** null with a `reason` renders the reason state. */
  value: number | null;
  reason?: ReasonCode | null;
  nightsLeft?: number;
  provisional?: boolean;
  tags?: MetricTag[];
  /** Extra tags such as "so_far" (today's strain) or "estimate" (forecast). */
  extraTags?: TagKind[];
  /** Strain Target range on the percent track (the arc is full at 100). */
  target?: readonly [number, number] | null;
  /** Overrides the default label ("Recovery", "Strain"…). Required for `stat`. */
  label?: string;
  /** `stat` only: colour token, domain max, value format and unit. */
  color?: DataColor;
  max?: number;
  format?: FormatKey;
  unit?: string;
  /** `gauge`: "Last updated 15:05" or "Day average". */
  caption?: string;
  /** `sleep lg`: the reference app's three-segment status bar under the label, the matching segment lit. */
  status?: "poor" | "sufficient" | "optimal";
  /** Home: the dial and label become one link. */
  href?: string;
  /** Loading (spec §5.19): the real track and label, bars where the numbers go. */
  loading?: boolean;
  /** The sticky header's form (docs/design/sticky.md B2): a 64 px ring with the value inside, no label or tags. `size` is ignored. */
  compact?: boolean;
};

// Centre type is sized in "cqi" of the ring's hole (the square inside the stroke), so every size keeps the same
// proportions and clearance (spec §11 F23). The web uses CSS container units (1cqi = 1% of the inner diameter);
// React Native has none, so a cqi is `hole / 100` px and every size below is `n * cqi`.
const SIZE = {
  sm: { d: 56, ring: 5, value: 38, tracking: 0 },
  // Home row: an 88 px ring 6 px thick inside the 92 px box, the reference app's size at 390 (spec §11 F2).
  md: { d: 92, ring: 6, value: 34, tracking: -0.01 },
  // v2 hero ring: a 252 px ring 17 px thick at 390, measured on the reference app's recovery and strain screens (spec §11 F11).
  lg: { d: 256, ring: 17, value: 31, tracking: -0.01 },
} as const;
const COMPACT = { d: 64, ring: 5, value: 40, tracking: 0 } as const;
const INSET = 2;

const DIAL_LABEL = "text-xs font-bold uppercase leading-4 tracking-[0.1em]";
/** The web's TRIM on the 12 px labels under the value (the band word, the caption, the label). */
const LABEL_TRIM = capTrim(12);
const STATUS_LIT = { poor: "bg-warning", sufficient: "bg-foreground-secondary", optimal: "bg-optimal" } as const;

type Resolved = { label: string; max: number; color: string; unit?: string; text: string; word?: { text: string; className: string } };

function resolve(p: ScoreDialProps): Resolved {
  const lg = p.size === "lg";
  switch (p.variant) {
    case "recovery": {
      const band = p.value === null ? null : recoveryBand(p.value);
      const col = p.value === null ? DATA_COLORS.muted : DATA_COLORS[dialColor("recovery", p.value)];
      return {
        label: p.label ?? "Recovery",
        max: 100,
        color: col.css,
        unit: "%",
        text: formatValue("int", p.value),
        // The ring carries the colour; the word stays secondary so it reads as a label (spec §5.1 v2).
        word: band ? { text: BAND_WORD[band], className: lg ? "text-foreground-secondary" : col.text } : undefined,
      };
    }
    case "strain":
      // Strain is a percent: the ring is full at 100 and stays full above it; the label keeps the real value.
      return { label: p.label ?? "Strain", max: 100, color: DATA_COLORS[dialColor("strain", p.value ?? 0)].css, unit: "%", text: formatValue("int", p.value) };
    case "sleep":
      return { label: p.label ?? (lg ? "Sleep performance" : "Sleep"), max: 100, color: DATA_COLORS[dialColor("sleep", p.value ?? 0)].css, unit: "%", text: formatValue("int", p.value) };
    case "gauge": {
      const level = p.value === null ? null : stressLevel(p.value);
      return {
        label: p.label ?? "Stress",
        max: 100,
        color: "transparent",
        text: formatValue("int", p.value),
        word: level ? { text: STRESS_WORD[level], className: DATA_COLORS[STRESS_COLOR[level]].text } : undefined,
      };
    }
    default:
      return { label: p.label ?? "", max: p.max ?? 100, color: DATA_COLORS[p.color ?? "chart-5"].css, unit: p.unit, text: formatValue(p.format ?? "int", p.value) };
  }
}

/** The reference app's ring (spec §5.1): a track, a fill arc, the Strain Target band and tick, or the stress gauge; the centre text over it. */
export function ScoreDial(props: ScoreDialProps) {
  const { variant, size, value, href, loading, compact } = props;
  const { c, css } = useTheme();
  const r = resolve(props);
  const s = compact ? COMPACT : SIZE[size];
  const lg = !compact && size === "lg";
  const d = s.d;
  const rad = d / 2;
  const holeInset = INSET + s.ring;
  const cqi = (d - 2 * holeInset) / 100;
  const empty = value === null;
  const reason = empty ? reasonCopy(props.reason, props.nightsLeft) : null;
  const gauge = variant === "gauge";
  const target = variant === "strain" ? props.target : null;
  const sweepAt = (v: number, max: number) => ARC_FROM + ARC_SWEEP * ringShare(v, max);
  // The track sits 0.25 px inside each edge of the arc, so no dark fringe shows along the fill.
  const trackR = rad - 2.25 - (s.ring - 0.5) / 2;
  const fillR = rad - INSET - s.ring / 2;
  const valueSize = s.value * cqi;

  // Gauge geometry: a thin arc inset 4 px (room for the needle's overhang) and a needle reaching 22 px inside it.
  const gaugeRing = compact ? 4 : lg ? 7 : 4;
  const gInner = rad - 4 - gaugeRing;
  const gR = rad - 4 - gaugeRing / 2;
  const gStart = 235;
  const gSweep = 250;
  // Where the arc's ends (215° and −35° in the web's angles) fall across the dial, for the 0.0 and 3.0 labels.
  const gEndPct = 50 * (1 - Math.cos((35 * Math.PI) / 180) * ((gInner + gaugeRing / 2) / rad));


  const aria = dialAriaLabel({
    variant,
    label: r.label,
    value,
    valueText: r.text,
    unit: r.unit,
    provisional: props.provisional,
    reasonText: reason?.long,
    bandWord: r.word?.text ?? (props.status && value !== null ? props.status[0].toUpperCase() + props.status.slice(1) : undefined),
    target,
    soFar: props.extraTags?.includes("so_far"),
  });

  const needle = (() => {
    if (!gauge || empty) return null;
    const [a, w, b] = markerSlices(value, 100, 4 / 3);
    const mid = gStart + ((a + w / 2) / (a + w + b)) * gSweep;
    const half = ((w / 100) * gSweep) / 2;
    const rin = gInner - 22;
    const pts = [polar(rad, rad, rin, mid - half), polar(rad, rad, rad, mid - half), polar(rad, rad, rad, mid + half), polar(rad, rad, rin, mid + half)];
    return { points: pts.map((p) => `${p.x},${p.y}`).join(" "), tail: (gInner - 22) / rad, head: (gInner - 2) / rad };
  })();

  const ring = (
    <View accessible accessibilityRole="image" accessibilityLabel={aria} importantForAccessibility={href ? "no-hide-descendants" : "yes"} style={{ width: d, height: d }}>
      <Svg width={d} height={d}>
        {gauge ? (
          <>
            <Defs>
              <LinearGradient id="arc" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={c["stress-low"]} />
                <Stop offset="0.5" stopColor={c["stress-medium"]} />
                <Stop offset="0.78" stopColor={c["recovery-yellow"]} />
                <Stop offset="1" stopColor={c["stress-high"]} />
              </LinearGradient>
              <RadialGradient id="needle" gradientUnits="userSpaceOnUse" cx={rad} cy={rad} r={rad}>
                <Stop offset={needle?.tail ?? 0} stopColor={c.foreground} stopOpacity={0} />
                <Stop offset={needle?.head ?? 0} stopColor={c.foreground} stopOpacity={1} />
                <Stop offset={1} stopColor={c.foreground} stopOpacity={1} />
              </RadialGradient>
            </Defs>
            {/* One continuous arc, blue → teal → green → yellow → orange, thin with round ends, and a white needle that fades in from the centre. */}
            <Path d={arcPath(rad, rad, gR, gStart, gStart + gSweep)} stroke={empty ? c["dial-track"] : "url(#arc)"} strokeWidth={gaugeRing} strokeLinecap="round" fill="none" />
            {needle && <Polygon points={needle.points} fill="url(#needle)" />}
          </>
        ) : (
          <>
            <Path d={arcPath(rad, rad, trackR, ARC_FROM, ARC_FROM + ARC_SWEEP)} stroke={c["dial-track"]} strokeWidth={s.ring - 0.5} fill="none" />
            {target && <Path d={arcPath(rad, rad, trackR, sweepAt(target[0], 100), sweepAt(target[1], 100))} stroke={c["dial-target"]} strokeWidth={s.ring - 0.5} fill="none" />}
            {/* Fill layer: draws above the target band, so the band is covered once strain passes it. */}
            {!loading && !empty && value > 0 && <Path d={arcPath(rad, rad, fillR, ARC_FROM, sweepAt(value, r.max))} stroke={css(r.color)} strokeWidth={s.ring} fill="none" />}
            {/* Strain Target tick: one white tick across the ring, above the fill. */}
            {target &&
              (() => {
                const [a, w] = markerSlices((target[0] + target[1]) / 2, 100, 1);
                return <Path d={arcPath(rad, rad, fillR, sweepAt(a, 100), sweepAt(a + w, 100))} stroke={c.foreground} strokeWidth={s.ring} fill="none" />;
              })()}
          </>
        )}
      </Svg>

      {/* The hole: the square inside the stroke. One centred column whose type and gaps scale with the inner diameter. */}
      <View pointerEvents="none" className="absolute items-center justify-center" style={{ left: holeInset, right: holeInset, top: holeInset, bottom: holeInset }}>
        {lg && (!empty || loading) && !gauge && (
          // The wordmark over the value (brand.md: never "PULSE" in a font); never under the brand minimum (h 15 px).
          <View style={{ marginBottom: 10 * cqi }}>
            <Wordmark height={Math.max(15, 6.8 * cqi)} tone="foreground-secondary" />
          </View>
        )}
        {loading ? (
          size !== "sm" && (
            <View style={{ width: valueSize * (lg ? 1.4 : 1.2) }}>
              <SkeletonText lh={valueSize} fs={valueSize} />
            </View>
          )
        ) : lg && empty && reason?.code !== "no_data" ? (
          <ReasonCentre code={reason!.code} text={reason!.short} cqi={cqi} />
        ) : (
          <Text
            className={cn("font-numeric font-bold tabular-nums", empty && "text-muted-foreground", compact && gauge && r.word?.className)}
            style={{ fontSize: valueSize, ...capTrim(valueSize, "numeric"), letterSpacing: s.tracking * valueSize }}
          >
            {r.text}
            {!!r.unit && !empty && <Text style={{ fontSize: valueSize * 0.55 }}>{r.unit}</Text>}
          </Text>
        )}
        {gauge && !compact && r.word && <Text className={cn(DIAL_LABEL, r.word.className)} style={{ ...LABEL_TRIM, marginTop: 8 * cqi + LABEL_TRIM.marginTop }}>{r.word.text}</Text>}
        {gauge && !compact && !!props.caption && <Text className="text-xs font-medium text-foreground-secondary" style={{ ...LABEL_TRIM, marginTop: 5 * cqi + LABEL_TRIM.marginTop }}>{props.caption}</Text>}
        {lg && !gauge && (
          <>
            <Text className={cn(DIAL_LABEL, "max-w-36 text-center")} style={{ ...LABEL_TRIM, marginTop: 9 * cqi + LABEL_TRIM.marginTop }}>{r.label}</Text>
            {/* No band word under the large ring: the colour carries it on screen, as in the reference app, and the dial's accessible name still says it (spec §11 R34). */}
            {props.status && !empty && !loading && (
              <View className="flex-row gap-1" style={{ marginTop: 8 * cqi }}>
                {(["poor", "sufficient", "optimal"] as const).map((k) => (
                  <View key={k} className={cn("h-1 w-5 rounded-full", props.status === k ? STATUS_LIT[k] : "bg-dial-track")} />
                ))}
              </View>
            )}
          </>
        )}
      </View>
      {gauge && lg && (
        <View pointerEvents="none" className="absolute inset-x-0" style={{ top: d * 0.79 }}>
          {/* Each label centred under its end of the arc. */}
          <Text className="absolute -ml-4 w-8 text-center font-numeric text-xs font-medium tabular-nums text-muted-foreground" style={{ left: `${gEndPct}%` }}>0</Text>
          <Text className="absolute -mr-4 w-8 text-center font-numeric text-xs font-medium tabular-nums text-muted-foreground" style={{ right: `${gEndPct}%` }}>100</Text>
        </View>
      )}
    </View>
  );

  if (compact) return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{ring}</View>;

  const below = !lg && (
    <View className="items-center gap-1.5">
      <View className="flex-row items-center gap-0.5">
        {/* shrink: a phone's text in a row overflows instead of wrapping. */}
        <Text className={cn(size === "sm" ? "text-xs font-medium leading-4 text-foreground-secondary" : DIAL_LABEL, "shrink text-center")}>{r.label}</Text>
        {!!href && <Icon icon={ChevronRight} size={12} tone="foreground" strokeWidth={2.5} />}
      </View>
    </View>
  );
  const longReason = lg && empty && !loading && reason && <Text className="max-w-72 text-center text-xs font-medium leading-4 text-muted-foreground">{reason.long}</Text>;
  const content = (
    <>
      {ring}
      {below}
      {longReason}
    </>
  );

  if (href)
    return (
      <Press
        activeScale={0.96}
        accessibilityRole="link"
        accessibilityLabel={`${aria}. Open ${r.label} details`}
        onPress={() => push(href)}
        className="min-w-24 items-center gap-1 rounded-xl p-1"
      >
        {content}
      </Press>
    );
  // A loading md dial keeps the Home link's 4 px padding, so the swap to the linked dial moves nothing.
  return <View className={cn("items-center", lg ? "gap-3" : size === "md" ? "gap-1" : "gap-2", loading && size === "md" && "min-w-24 p-1")}>{content}</View>;
}

function ReasonCentre({ code, text, cqi }: { code: ReasonCode; text: string; cqi: number }) {
  const glyph = REASON_ICON[code];
  return (
    <View className="items-center gap-2">
      {glyph && <Icon icon={glyph} size={24} tone="foreground-secondary" strokeWidth={1.75} />}
      <Text className="text-center text-base font-semibold leading-[22px] text-foreground-secondary" numberOfLines={2} style={{ maxWidth: 72 * cqi }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * Loading shape (spec §5.19): the dial itself with its real track and label, bars for the numbers,
 * so the swap moves nothing.
 */
export function ScoreDialSkeleton({ size, variant = "stat", label }: { size: DialSize; variant?: DialVariant; label?: string }) {
  return (
    <View accessibilityElementsHidden>
      <ScoreDial variant={variant} size={size} value={null} label={label} loading />
    </View>
  );
}

ScoreDial.Skeleton = ScoreDialSkeleton;
