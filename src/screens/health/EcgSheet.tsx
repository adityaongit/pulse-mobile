// An ECG reading's sheet (the web's `?ecg=<id>` ResponsiveSheet "ECG reading", pulse monitor/HeartRhythm.tsx).
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { DAY, formatDay } from "@/lib/format";
import { getEcgReading } from "@/queries/health";
import { StatusChip, ValueUnit, CAPTION } from "@/ui/metrics/primitives";
import { SheetScreen } from "@/ui/shells/SheetScreen";
import { Text } from "@/ui/Text";
import { useScreen } from "../useScreen";
import { bpm, RHYTHM_DISCLAIMER } from "./HeartRhythm";

export function EcgSheet() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: shown } = useScreen((ctx) => getEcgReading(ctx, id ?? ""), [id]);
  return (
    <SheetScreen title="ECG reading" size="default">
      {shown && (
        <View className="gap-4">
          <View className="items-start gap-2">
            <ValueUnit value={bpm(shown)} unit="bpm avg" className="font-numeric text-4xl font-bold leading-10 tracking-[-0.01em]" />
            <StatusChip tone={shown.tone}>{shown.label}</StatusChip>
          </View>
          <Text className="text-[15px] leading-[22px] tabular-nums text-foreground-secondary">
            {formatDay(shown.day, DAY.long)} at {shown.time}
          </Text>
          <Text className="text-[15px] leading-[22px]">{shown.explanation}</Text>
          <Text className={CAPTION}>{RHYTHM_DISCLAIMER}</Text>
        </View>
      )}
    </SheetScreen>
  );
}
