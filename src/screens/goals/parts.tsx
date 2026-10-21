// The pieces the Goals and Weekly plan cards and pages share, in the look of Strain's own rows: KeyStatRow's row (caps
// label, grey caption, value over a grey sub-value, a small DeltaMark), ZoneBars' bar (a solid fill on a hatched track),
// and the week as seven small grey dots.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ChevronRight, type LucideIcon } from "lucide-react-native";
import type { DeltaDir, Tone } from "@/lib/bands";
import type { GoalKey } from "@/queries/goals";
import type { PlanKey } from "@/queries/weeklyPlan";
import { cn } from "@/ui/cn";
import { Hatch } from "@/ui/Hatch";
import { Icon } from "@/ui/Icon";
import { CAPTION, DeltaMark, LABEL } from "@/ui/metrics/primitives";
import type { Palette } from "@/ui/palette";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

/** The count beside a card's title ("3 of 7 done"), a quiet caption in the header. */
export const ASIDE = "font-numeric text-[13px] font-bold tabular-nums text-foreground-secondary";

/** Left inset that lines a block up under a row's label (20 px icon + 12 px gap). */
export const UNDER_LABEL = "ml-8";

/** A goal's colour by family: activity Strain's blue, sleep Sleep's, water the recovery blue. */
export const goalColor = (c: Palette, key: GoalKey) => (key === "sleep" ? c.sleep : key === "water" ? c["recovery-blue"] : c.strain);
/** A weekly target's colour: training Strain's blue, steps the activity chart's, sleep Sleep's. */
export const planColor = (c: Palette, key: PlanKey) => (key === "consistency" || key === "sleepNeed" ? c.sleep : key === "steps" ? c["chart-1"] : c.strain);

/** ZoneBars' bar: a 12 px hatched track with a solid fill to `value` (0-1; null: empty), and an optional thin tick (0-1) where an even pace would be. */
export function Bar({ value, color, tick, className }: { value: number | null; color: string; tick?: number | null; className?: string }) {
  const { c } = useTheme();
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <View accessibilityElementsHidden className={cn("h-3", className)}>
      <Hatch className="h-3 rounded-xs">
        <View className="absolute inset-y-0 left-0 rounded-xs" style={{ width: `${v * 100}%`, backgroundColor: color }} />
      </Hatch>
      {tick != null && tick > 0 && tick < 1 && <View pointerEvents="none" style={{ position: "absolute", left: `${tick * 100}%`, top: -2, bottom: -2, width: 2, marginLeft: -1, borderRadius: 1, backgroundColor: c.foreground, opacity: 0.6 }} />}
    </View>
  );
}

/** A bar with a grey caption after it (a percent, a status word), for under a row's label. */
export function BarLine({ caption, ...bar }: { value: number | null; color: string; tick?: number | null; caption?: string | null }) {
  return (
    <View className="mt-1.5 flex-row items-center gap-2">
      <Bar {...bar} className="flex-1" />
      {!!caption && <Text className={cn(CAPTION, "shrink-0 font-numeric tabular-nums")}>{caption}</Text>}
    </View>
  );
}

export type Mark = { dir: DeltaDir; tone: Tone } | null;

/**
 * KeyStatRow's "row" (min-h-14, py-2, gap-3): icon, caps label with a grey caption and anything under it (`children`,
 * a BarLine), the value over its grey "of 150 min", and the DeltaMark slot. Put rows in <Divided>.
 */
export function GoalRowShell({ icon, label, caption, value, of, muted, mark, spoken, onPress, children }: { icon: LucideIcon; label: string; caption?: string | null; value: string; of: string; muted?: boolean; mark: Mark; spoken: string; onPress?: () => void; children?: ReactNode }) {
  const body = (
    <>
      <View className="size-5 shrink-0 items-center justify-center">
        <Icon icon={icon} size={20} tone="muted-foreground" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={LABEL} numberOfLines={1}>{label}</Text>
        {!!caption && <Text className={cn(CAPTION, "mt-0.5")}>{caption}</Text>}
        {children}
      </View>
      <View className="shrink-0 flex-row gap-2">
        <View className="items-end">
          <Text className={cn("font-numeric text-xl font-bold leading-6 tabular-nums", muted && "text-muted-foreground")}>{value}</Text>
          <Text className="font-numeric text-[13px] font-medium leading-4 tabular-nums text-muted-foreground">{of}</Text>
        </View>
        <View className="h-6 w-2 items-center justify-center">{mark && <DeltaMark dir={mark.dir} tone={mark.tone} />}</View>
      </View>
      {onPress && <Icon icon={ChevronRight} size={16} tone="muted-foreground" />}
    </>
  );
  const row = "min-h-14 flex-row items-center gap-3 py-2";
  return onPress ? (
    <Press activeBg="bg-fill-pressed" accessibilityRole="link" accessibilityLabel={spoken} onPress={onPress} className={cn(row, "-mx-2 rounded-xl px-2")}>
      {body}
    </Press>
  ) : (
    <View accessible accessibilityLabel={spoken} className={row}>
      {body}
    </View>
  );
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

export type WeekColumn = { day: string; met: boolean };

/** The week as seven small grey dots under day letters: filled on days that met their share; `current`'s letter in ink. */
export function WeekColumns({ cols, current, label, className }: { cols: WeekColumn[]; current: string; label: string; className?: string }) {
  const { t } = useTranslation("goals");
  return (
    <View accessible accessibilityLabel={label} className={cn("flex-row", className)}>
      {cols.map((col) => (
        <View key={col.day} className="flex-1 items-center gap-1">
          <Text className={cn("text-[10px] font-semibold leading-3 text-muted-foreground", col.day === current && "text-foreground")}>{t(`weekdayLetter.${DAYS[weekday(col.day)]}`)}</Text>
          <View className={cn("size-2 rounded-full", col.met ? "bg-foreground-secondary" : "border border-border")} />
        </View>
      ))}
    </View>
  );
}
