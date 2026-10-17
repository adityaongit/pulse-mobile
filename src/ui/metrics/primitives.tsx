import { View } from "react-native";
import { Check, CircleAlert, Triangle, TriangleAlert, type LucideIcon } from "lucide-react-native";
import { CHIP_TONE_CLASS, type ChipTone, type DeltaDir, type Tone } from "@/lib/bands";
import { isSymbolUnit } from "@/lib/format";
import { TAG_COPY } from "@/lib/reasons";
import { cn } from "../cn";
import { Icon } from "../Icon";
import type { Family } from "../fontClasses";
import type { TokenName } from "../palette";
import { Text } from "../Text";
import { useTheme } from "../theme";

// Small shared marks used by every kit component (spec §5.0). One look per meaning.

/** Shared type styles: the uppercase small label and the muted caption. */
export const LABEL = "text-xs leading-4 font-bold tracking-[0.1em] uppercase";
export const CAPTION = "text-xs leading-4 font-medium text-muted-foreground";
/**
 * The web's CAP_TRIM (`leading-none` and `text-box: trim-both cap alphabetic`): the text's box runs from the capital
 * height to the baseline, so a margin measures from the letters themselves. React Native has no text-box-trim, so this
 * sets a 1 em line and cuts it with negative margins from the fonts' metrics (ascent 1.0 / 0.95 em, descent 0.2 / 0.25
 * em for Barlow / Figtree, capital height 0.7 em for both), with the glyphs placed as CSS places them (<Text> does that
 * on iOS). Add a margin of your own to the returned one.
 */
export function capTrim(fontSize: number, family: Family = "sans") {
  const [ascent, descent] = family === "numeric" ? [1, 0.2] : [0.95, 0.25];
  const half = (1 - ascent - descent) / 2; // the half-leading of a 1 em line (negative)
  return { lineHeight: fontSize, marginTop: -(half + ascent - 0.7) * fontSize, marginBottom: -(half + descent) * fontSize };
}

export type TagKind = keyof typeof TAG_COPY | "so_far" | "partial_week" | "partial_month" | "estimate" | "beta";

const CHIP_ICON: Record<ChipTone, LucideIcon | null> = { optimal: Check, warning: TriangleAlert, alert: CircleAlert, neutral: null };

/** Value plus tone, e.g. "✓ within 16.1 - 16.9". Icon follows the tone unless `delta` is given. Children may be text or nested <Text>. */
export function StatusChip({ tone, children, delta, className, textClassName }: { tone: ChipTone; children: React.ReactNode; delta?: DeltaDir; className?: string; textClassName?: string }) {
  // CHIP_TONE_CLASS is "bg-... text-..." for the web, where the text colour inherits; here the two go to different elements.
  const classes = CHIP_TONE_CLASS[tone].split(" ");
  const bg = classes.find((k) => k.startsWith("bg-"));
  const text = classes.find((k) => k.startsWith("text-")) ?? "";
  const glyph = CHIP_ICON[tone];
  return (
    <View className={cn("min-h-6 flex-row items-center gap-1 self-start rounded-md px-2 py-1", bg, className)}>
      {delta ? <DeltaMark dir={delta} tone="neutral" color={text.slice(5) as TokenName} /> : glyph && <Icon icon={glyph} size={12} tone={text.slice(5) as TokenName} strokeWidth={2.5} />}
      <Text className={cn("text-xs font-bold leading-4 tabular-nums", text, textClassName)}>{children}</Text>
    </View>
  );
}

const DELTA_TONE: Record<Tone, TokenName> = { good: "optimal-text", bad: "warning-text", neutral: "foreground-secondary" };

/** Filled 8 px triangle (up/down), or a 6 px dot when flat. `color` overrides the tone's colour (a chip's own text colour). */
export function DeltaMark({ dir, tone, color }: { dir: DeltaDir; tone: Tone; color?: TokenName }) {
  const { c } = useTheme();
  if (dir === "flat") return <View accessibilityElementsHidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />;
  const fill = c[color ?? DELTA_TONE[tone]];
  return (
    <View accessibilityElementsHidden style={dir === "down" ? { transform: [{ rotate: "180deg" }] } : undefined}>
      <Triangle size={8} color={fill} fill={fill} strokeWidth={0} />
    </View>
  );
}

/** A formatted value with its unit in the unit role ("124 ms", "72%"). Nest it inside a <Text>; it renders as one. */
/** The advance of a space in Figtree SemiBold at 13 px (0.241 em). */
const SPACE_13 = 0.241 * 13;

/**
 * `fit`: one line, the type scaled down to the width it is given rather than breaking inside the number (a phone has no room for text running past its column at 320 px).
 */
export function ValueUnit({ value, unit, className, unitClassName, fit }: { value: string; unit?: string; className?: string; unitClassName?: string; fit?: boolean }) {
  return (
    <Text className={cn("whitespace-nowrap tabular-nums", className)} numberOfLines={fit ? 1 : undefined} adjustsFontSizeToFit={fit}>
      {value}
      {!!unit && value !== "--" && (
        <>
          {/* The web's ml-0.5 before a symbol, ml-1 before a word. A nested text has no margin, so the gap is a space of
              a known face and size (Figtree SemiBold 13 px: 0.241 em, 3.13 px) with letter spacing making up the rest. */}
          <Text className="font-sans text-[13px] font-semibold" style={{ letterSpacing: (isSymbolUnit(unit) ? 2 : 4) - SPACE_13 }}>{" "}</Text>
          <Text className={cn("text-[13px] font-semibold leading-4 text-foreground-secondary", unitClassName)}>{unit}</Text>
        </>
      )}
    </Text>
  );
}
