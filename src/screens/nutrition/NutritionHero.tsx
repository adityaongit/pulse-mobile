// The Nutrition hero (spec §7.22): today's calories on the kit's ring, then protein, carbs and fat as three tiles on one
// card, each a small ring with the grams inside. Shaped like the Recovery hero: the dial bare on the page, a card under it.
import { useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Path } from "react-native-svg";
import { DATA_COLORS, type DataColor } from "@/lib/bands";
import { ringShare } from "@/lib/charts";
import { FORMATS } from "@/lib/format";
import { progressOf } from "@/nutrition/targets";
import type { NutritionVM } from "@/queries/nutrition";
import { Card } from "@/ui/Card";
import { arcPath } from "@/ui/charts/geometry";
import { cn } from "@/ui/cn";
import { ARC_FROM, ARC_SWEEP } from "@/ui/metrics/MiniRing";
import { CAPTION, LABEL } from "@/ui/metrics/primitives";
import { ScoreDial } from "@/ui/metrics/ScoreDial";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

const grouped = (v: number) => FORMATS.grouped(v);
const grams = (v: number) => FORMATS.int(v);
const show = (v: number | null, f: (x: number) => string) => (v === null ? "--" : f(v));

const MACROS: readonly { key: "protein" | "carbs" | "fat"; color: DataColor }[] = [
  { key: "protein", color: "strain" },
  { key: "carbs", color: "optimal" },
  { key: "fat", color: "stage-rem" },
];

const D = 64;
const STROKE = 6;

/** A 64 px ring in the kit's arc (4 degree gap at 12 o'clock) with the value inside; the track alone when there is no value. */
function MacroRing({ share, color, children }: { share: number | null; color: DataColor; children: string }) {
  const { c, css } = useTheme();
  const r = (D - STROKE) / 2;
  return (
    <View className="items-center justify-center" style={{ width: D, height: D }}>
      <Svg width={D} height={D} style={{ position: "absolute" }}>
        <Path d={arcPath(D / 2, D / 2, r, ARC_FROM, ARC_FROM + ARC_SWEEP)} stroke={c["dial-track"]} strokeWidth={STROKE} fill="none" />
        {!!share && <Path d={arcPath(D / 2, D / 2, r, ARC_FROM, ARC_FROM + ARC_SWEEP * ringShare(share, 1))} stroke={css(DATA_COLORS[color].css)} strokeWidth={STROKE} fill="none" />}
      </Svg>
      <Text className={cn("font-numeric text-[17px] font-bold leading-5 tabular-nums", share === null && "text-muted-foreground")}>{children}</Text>
    </View>
  );
}

/** Today: calories against the target on a ring, then the three macros on a card. */
export function Today({ vm }: { vm: NutritionVM }) {
  const { t: tr } = useTranslation("nutrition");
  const { totals: t, targets } = vm;
  const kcal = targets.kcal.value;
  const left = t.kcal === null ? kcal : kcal - t.kcal;
  // The hero slot centres and shrinks its content, so the card takes the page's width (16 px gutters) itself.
  const { width } = useWindowDimensions();
  return (
    <View className="items-center gap-6">
      <View className="items-center gap-3">
        <View accessible accessibilityLabel={tr("today.a11y", { eaten: show(t.kcal, grouped), target: grouped(kcal) })}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <ScoreDial variant="stat" size="lg" value={t.kcal} reason={t.kcal === null ? "no_data" : null} max={kcal} format="grouped" label={tr("unit.kcal")} color={left < 0 ? "warning" : "energy-active"} />
          </View>
        </View>
        <View className="items-center gap-1">
          <Text className={LABEL}>{t.kcal === null ? tr("today.nothing") : tr("today.soFar")}</Text>
          <Text className="text-sm font-medium leading-5 text-muted-foreground">{tr("today.ofTarget", { target: grouped(kcal) })}</Text>
          <Text className={cn(CAPTION, "text-center")}>{left > 0 ? tr("today.left", { kcal: grouped(left) }) : left < 0 ? tr("today.over", { kcal: grouped(-left) }) : tr("today.reached")}</Text>
        </View>
      </View>
      <Card style={{ width: width - 32 }}>
        <View className="flex-row px-2">
          {MACROS.map(({ key, color }, i) => (
            <View
              key={key}
              accessible
              accessibilityLabel={tr("today.macroA11y", { label: tr(`target.${key}`), value: show(t[key], grams), target: grams(targets[key].value) })}
              className={cn("min-w-0 flex-1 items-center gap-2 px-1", i > 0 && "border-l border-border")}
            >
              <MacroRing share={progressOf(t[key], targets[key].value)} color={color}>
                {show(t[key], grams)}
              </MacroRing>
              <Text className={cn(LABEL, "text-[10px] leading-3")} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {tr(`target.${key}`)}
              </Text>
              <Text className={cn(CAPTION, "tabular-nums")}>{tr("today.macroOf", { target: grams(targets[key].value) }).trim()}</Text>
            </View>
          ))}
        </View>
        {t.fiber !== null && <Text className={cn(CAPTION, "mt-3 px-4 text-center tabular-nums")}>{tr("today.fiber", { g: grams(t.fiber) })}</Text>}
      </Card>
    </View>
  );
}
