// Health Monitor's Heart rhythm section: the latest ECG (result, average heart rate, date), older readings as rows, and
// the irregular rhythm notification count. Ported from pulse src/app/(app)/health/monitor/HeartRhythm.tsx. Each reading
// opens its sheet (`/ecg?id=`, app/(sheets)/ecg.tsx) where the web sets `?ecg=<id>`. With nothing recorded it is one
// quiet row, so a screen most owners see empty never looks broken.
import { Pressable, View } from "react-native";
import { Activity, ChevronRight, HeartPulse } from "lucide-react-native";
import { DAY, formatDay, formatValue } from "@/lib/format";
import type { EcgReading, HeartRhythm as HeartRhythmVM } from "@/queries/types";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { CAPTION, LABEL, StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { openSheet } from "@/ui/shells/sheets";
import { Text } from "@/ui/Text";

/** Fitbit's and the reference app's notes both say "not a diagnosis" and name what ECG can't detect (pulse docs/research/heart-rhythm-ui.md). */
export const RHYTHM_DISCLAIMER = "Not a diagnosis. ECG and irregular rhythm notifications can’t detect a heart attack, blood clots or stroke. Talk to your doctor about any result.";

const ROW = "min-h-14 flex-row items-center gap-3 px-4 py-2";
export const when = (e: EcgReading) => `${formatDay(e.day, DAY.short)}, ${e.time}`;
export const bpm = (e: EcgReading) => (e.avgBpm === null ? "--" : formatValue("int", e.avgBpm));

const open = (e: EcgReading) => openSheet(`/ecg?id=${encodeURIComponent(e.id)}`);

export function HeartRhythm({ rhythm }: { rhythm: HeartRhythmVM }) {
  const { ecg, irn } = rhythm;

  if (!ecg.length && !irn.count)
    return (
      <Card className={ROW}>
        <Icon icon={HeartPulse} size={20} tone="muted-foreground" strokeWidth={1.5} />
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] leading-5 text-foreground-secondary">No heart rhythm readings yet</Text>
          <Text className={cn(CAPTION, "mt-0.5")}>ECG readings and irregular rhythm notifications from the Google Health app show up here after they sync.</Text>
        </View>
      </Card>
    );

  const [latest, ...older] = ecg;
  return (
    <View className="gap-3">
      <Card className="py-0">
        {latest ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Latest ECG, ${when(latest)}: ${latest.label}, average ${bpm(latest)} bpm`} onPress={() => open(latest)} className="w-full gap-3 p-4 active:bg-accent">
            <View accessibilityElementsHidden className="w-full flex-row items-center gap-2.5">
              <Icon icon={Activity} size={20} tone="muted-foreground" strokeWidth={1.5} />
              <Text className={cn(LABEL, "flex-1 text-foreground-secondary")}>Latest ECG</Text>
              <Text className={cn(CAPTION, "tabular-nums")}>{when(latest)}</Text>
              <View className="-mr-1">
                <Icon icon={ChevronRight} size={16} tone="muted-foreground" strokeWidth={1.75} />
              </View>
            </View>
            <View accessibilityElementsHidden className="items-start gap-2">
              <ValueUnit value={bpm(latest)} unit="bpm avg" className="font-numeric text-[30px] leading-9 font-bold tracking-[-0.01em]" unitClassName="text-sm leading-5 font-medium text-foreground" />
              <StatusChip tone={latest.tone}>{latest.label}</StatusChip>
            </View>
          </Pressable>
        ) : (
          <View className={ROW}>
            <Icon icon={Activity} size={20} tone="muted-foreground" strokeWidth={1.5} />
            <Text className="flex-1 text-[15px] leading-5 text-foreground-secondary">No ECG readings yet</Text>
          </View>
        )}
        {older.length > 0 && (
          // ponytail: every reading listed; page it if someone ever has hundreds.
          <View accessibilityLabel="Earlier ECG readings" className="border-t border-border">
            {older.map((e, i) => (
              <Pressable key={e.id} accessibilityRole="button" onPress={() => open(e)} className={cn(ROW, "w-full active:bg-accent", i > 0 && "border-t border-border")}>
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
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      <Card className={ROW}>
        <Icon icon={HeartPulse} size={20} tone="muted-foreground" strokeWidth={1.5} />
        <View className="min-w-0 flex-1">
          <Text className={LABEL}>Irregular rhythm notifications</Text>
          <Text className={cn(CAPTION, "mt-0.5")}>
            {irn.latestDay ? `Latest ${formatDay(irn.latestDay, DAY.short)}` : "None. The check runs from time to time while you’re still, so no alert doesn’t rule out AFib."}
          </Text>
        </View>
        <Text className="font-numeric text-xl leading-6 font-bold tabular-nums">{irn.count}</Text>
      </Card>

      <Text className={cn(CAPTION, "px-1")}>{RHYTHM_DISCLAIMER}</Text>
    </View>
  );
}
