// Health Monitor's Heart rhythm section: the latest ECG (result, average heart rate, date), older readings as rows, and
// the irregular rhythm notification count. Ported from pulse src/app/(app)/health/monitor/HeartRhythm.tsx. Each reading
// opens its sheet (`/ecg?id=`, app/ecg.tsx) where the web sets `?ecg=<id>`. With nothing recorded it is one
// quiet row, so a screen most people see empty never looks broken.
import { View } from "react-native";
import { Activity, ChevronRight, HeartPulse } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { DAY, formatDay, formatValue } from "@/lib/format";
import type { EcgReading, HeartRhythm as HeartRhythmVM } from "@/queries/types";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { CAPTION, LABEL, StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { Text } from "@/ui/Text";
import { Press } from "@/ui/Press";
import { push } from "@/ui/navigate";

/** Fitbit's and the reference app's notes both say "not a diagnosis" and name what ECG can't detect (pulse docs/research/heart-rhythm-ui.md). */
export const rhythmDisclaimer = () => i18n.t("health:rhythm.disclaimer");

const ROW = "min-h-14 flex-row items-center gap-3 px-4 py-2";
export const when = (e: EcgReading) => i18n.t("health:rhythm.when", { day: formatDay(e.day, DAY.short), time: e.time });
export const bpm = (e: EcgReading) => (e.avgBpm === null ? "--" : formatValue("int", e.avgBpm));

const open = (e: EcgReading) => push(`/ecg?id=${encodeURIComponent(e.id)}`);

export function HeartRhythm({ rhythm }: { rhythm: HeartRhythmVM }) {
  const { ecg, irn } = rhythm;
  const { t } = useTranslation("health");

  if (!ecg.length && !irn.count)
    return (
      <Card className={ROW}>
        <Icon icon={HeartPulse} size={20} tone="muted-foreground" strokeWidth={1.5} />
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] leading-5 text-foreground-secondary">{t("rhythm.none")}</Text>
          <Text className={cn(CAPTION, "mt-0.5")}>{t("rhythm.noneBody")}</Text>
        </View>
      </Card>
    );

  const [latest, ...older] = ecg;
  return (
    <View className="gap-3">
      <Card className="py-0">
        {latest ? (
          <Press activeBg="bg-accent" accessibilityRole="button" accessibilityLabel={t("rhythm.latestAria", { when: when(latest), label: latest.label, bpm: bpm(latest) })} onPress={() => open(latest)} className="w-full gap-3 p-4">
            <View accessibilityElementsHidden className="w-full flex-row items-center gap-2.5">
              <Icon icon={Activity} size={20} tone="muted-foreground" strokeWidth={1.5} />
              <Text className={cn(LABEL, "flex-1 text-foreground-secondary")}>{t("rhythm.latest")}</Text>
              <Text className={cn(CAPTION, "tabular-nums")}>{when(latest)}</Text>
              <View className="-mr-1">
                <Icon icon={ChevronRight} size={16} tone="muted-foreground" strokeWidth={1.75} />
              </View>
            </View>
            <View accessibilityElementsHidden className="items-start gap-2">
              <ValueUnit value={bpm(latest)} unit={t("rhythm.bpmAvg")} className="font-numeric text-[30px] leading-9 font-bold tracking-[-0.01em]" unitClassName="text-sm leading-5 font-medium text-foreground" />
              <StatusChip tone={latest.tone}>{latest.label}</StatusChip>
            </View>
          </Press>
        ) : (
          <View className={ROW}>
            <Icon icon={Activity} size={20} tone="muted-foreground" strokeWidth={1.5} />
            <Text className="flex-1 text-[15px] leading-5 text-foreground-secondary">{t("rhythm.noEcg")}</Text>
          </View>
        )}
        {older.length > 0 && (
          // ponytail: every reading listed; page it if someone ever has hundreds.
          <View accessibilityLabel={t("rhythm.earlier")} className="border-t border-border">
            {older.map((e, i) => (
              <Press activeBg="bg-accent" key={e.id} accessibilityRole="button" onPress={() => open(e)} className={cn(ROW, "w-full", i > 0 && "border-t border-border")}>
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-[15px] font-medium leading-5">
                    {e.label}
                  </Text>
                  <Text className={cn(CAPTION, "mt-0.5 tabular-nums")}>{when(e)}</Text>
                </View>
                <ValueUnit value={bpm(e)} unit="bpm" className="font-numeric text-xl leading-6 font-bold" />
                <View className="-mr-1">
                  <Icon icon={ChevronRight} size={16} tone="muted-foreground" strokeWidth={1.75} />
                </View>
              </Press>
            ))}
          </View>
        )}
      </Card>

      <Card className={ROW}>
        <Icon icon={HeartPulse} size={20} tone="muted-foreground" strokeWidth={1.5} />
        <View className="min-w-0 flex-1">
          <Text className={LABEL}>{t("rhythm.irn")}</Text>
          <Text className={cn(CAPTION, "mt-0.5")}>
            {irn.latestDay ? t("rhythm.irnLatest", { day: formatDay(irn.latestDay, DAY.short) }) : t("rhythm.irnNone")}
          </Text>
        </View>
        <Text className="font-numeric text-xl leading-6 font-bold tabular-nums">{irn.count}</Text>
      </Card>

      <Text className={cn(CAPTION, "px-1")}>{rhythmDisclaimer()}</Text>
    </View>
  );
}
