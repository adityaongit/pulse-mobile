// A Healthspan group (Sleep, Strain, Fitness): one row per factor that opens in place (health-03), showing how the
// factor stands ("Outperforming"), the target for your age, the evidence and VIEW TREND. `?contributor=` opens a row on
// arrival. Ported from pulse src/app/(app)/health/healthspan/ContributorCard.tsx (Radix Accordion, type "multiple").
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated";
import { ChevronDown, CircleGauge, Dumbbell, Footprints, Heart, Moon, Timer } from "lucide-react-native";
import { formatValue, isSymbolUnit, NBSP, type FormatKey } from "@/lib/format";
import type { HealthspanContributor } from "@/queries/types";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { ContributorRow } from "@/ui/metrics/ContributorRow";
import { CAPTION } from "@/ui/metrics/primitives";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { trendHref } from "@/lib/url";
import { TextLink } from "./CardButton";
import { factorCopy } from "./factor";
import { Press } from "@/ui/Press";
import { DURATION } from "@/ui/motion";

const glyph = (g: Parameters<typeof Icon>[0]["icon"]): ReactNode => <Icon icon={g} size={20} tone="muted-foreground" strokeWidth={1.75} />;
/** Each factor's Trend View (halo's contributors carry no link). */
const HS_TREND: Record<string, string> = {
  sleepHours: "hours",
  sri: "consistency",
  zone13: "zones13",
  zone45: "zones45",
  strength: "strength",
  steps: "steps",
  vo2max: "vo2max",
  restingHr: "rhr",
  leanMass: "lean_mass",
};

const ICON: Record<string, ReactNode> = {
  sleepHours: glyph(Moon),
  sri: glyph(Moon),
  zone13: glyph(Timer),
  zone45: glyph(Timer),
  strength: glyph(Dumbbell),
  steps: glyph(Footprints),
  vo2max: glyph(CircleGauge),
  restingHr: glyph(Heart),
};

const SHOW: Record<string, { format: FormatKey; unit?: string; scale?: number }> = {
  sleepHours: { format: "duration", scale: 60 },
  sri: { format: "int", unit: "%" },
  zone13: { format: "duration" },
  zone45: { format: "duration" },
  strength: { format: "duration" },
  steps: { format: "grouped" },
  vo2max: { format: "decimal1", unit: "ml/kg/min" },
  restingHr: { format: "int", unit: "bpm" },
  // Lean mass as a share of body weight, the engine’s term (health.ts HS_META), not kilograms.
  leanMass: { format: "decimal1", unit: "%" },
};

const withUnit = (text: string, unit?: string) => (unit ? `${text}${isSymbolUnit(unit) ? "" : NBSP}${unit}` : text);

function Chevron({ open }: { open: boolean }) {
  const reduced = useReducedMotion();
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: reduced ? (open ? "180deg" : "0deg") : withTiming(open ? "180deg" : "0deg", { duration: DURATION.base }) }] }), [open, reduced]);
  return (
    <Animated.View style={style} className="mt-3.5">
      <Icon icon={ChevronDown} size={20} tone="muted-foreground" strokeWidth={2} />
    </Animated.View>
  );
}

export function ContributorCard({ title, items }: { title: string; items: HealthspanContributor[] }) {
  const { contributor } = useLocalSearchParams<{ contributor?: string }>();
  const { t } = useTranslation("health");
  const [open, setOpen] = useState<string[]>(contributor ? [contributor] : []);
  const toggle = (key: string) => {
    haptic.toggle(!open.includes(key));
    setOpen((o) => (o.includes(key) ? o.filter((k) => k !== key) : [...o, key]));
  };
  return (
    <SectionShell
      variant="card"
      title={title}
      info={{ title: t("contributor.infoTitle", { title }), body: t("contributor.infoBody") }}
      fill
    >
      <View>
        {items.map((c, i) => {
          const s = SHOW[c.key] ?? { format: "decimal1" as const };
          const k = s.scale ?? 1;
          const show = (v: number) => withUnit(formatValue(s.format, v * k), s.unit);
          const isOpen = open.includes(c.key);
          return (
            <Animated.View key={c.key} layout={LinearTransition.duration(DURATION.base)} className={cn(i > 0 && "border-t border-border")}>
              <Press activeBg="bg-accent" accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={() => toggle(c.key)} className="-mx-2 flex-row items-start gap-1 rounded-lg px-2">
                <ContributorRow
                  variant="healthspan"
                  icon={ICON[c.key]}
                  label={c.label}
                  metric={c.metric.value === null ? c.metric : { ...c.metric, value: c.metric.value * k }}
                  recent={null}
                  unit={s.unit}
                  format={s.format}
                  domain={[c.domain[0] * k, c.domain[1] * k]}
                  years={c.years}
                  higherIsBetter={c.higherIsBetter}
                  reasonCopy={c.metric.value === null ? c.caption : undefined}
                  className="min-w-0 flex-1"
                />
                <Chevron open={isOpen} />
              </Press>
              {isOpen && (
                <Animated.View entering={FadeIn.duration(DURATION.base)} exiting={FadeOut.duration(DURATION.fast)} className="gap-3 pb-5">
                  {c.years !== null && (
                    <View className="gap-1">
                      <Text className="text-[17px] font-semibold leading-6">{factorCopy(c.label, c.years).title}</Text>
                      <Text className="text-[15px] leading-[22px] text-foreground-secondary">{factorCopy(c.label, c.years).body}</Text>
                    </View>
                  )}
                  <Text className="text-[15px] leading-[22px] text-foreground-secondary">{t("contributor.target", { value: show(c.target) })}</Text>
                  {!!c.caption && c.metric.value !== null && <Text className={CAPTION}>{c.caption}</Text>}
                  <Text className="text-[15px] leading-[22px]">{c.explanation}</Text>
                  <Text className={CAPTION}>{t("contributor.source", { source: c.source })}</Text>
                  {!!HS_TREND[c.key] && <TextLink href={trendHref(HS_TREND[c.key])}>{t("contributor.viewTrend")}</TextLink>}
                </Animated.View>
              )}
            </Animated.View>
          );
        })}
      </View>
    </SectionShell>
  );
}
