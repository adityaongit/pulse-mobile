// Home's "Tonight's sleep" body: bedtime for the chosen goal, typical wake, goal toggle (spec §7.1, journey 4). Ported
// from pulse (app)/_lib/TonightPlan.tsx. Left out: the smart alarm (`FEATURES.sleepAlarm`, off), so the right block is
// always the typical wake time.
import { useState } from "react";
import { View } from "react-native";
import Svg, { Line } from "react-native-svg";
import { AlarmClock, Sunset } from "lucide-react-native";
import { clock, hmm } from "@/lib/format";
import type { SleepPlanVM } from "@/queries/types";
import { alpha } from "@/ui/color";
import { Icon } from "@/ui/Icon";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

const LABEL = "text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary";

/** The two times step down with the card's width, as the web's container query does: 32 px from 288 px, 26 px from 240 px, else 22 px. */
const timeSize = (w: number) => (w >= 288 ? "text-[32px]" : w >= 240 ? "text-[26px]" : "text-[22px]");

export function TonightPlan({ plan, timeZone }: { plan: SleepPlanVM; timeZone: string }) {
  const { c } = useTheme();
  const [key, setKey] = useState<SleepPlanVM["plans"][number]["key"]>("peak");
  const [width, setWidth] = useState(0);
  const chosen = plan.plans.find((p) => p.key === key) ?? plan.plans[0];
  const bed = clock(chosen.bedtimeAt, timeZone);
  const time = `font-numeric font-bold leading-none tabular-nums ${timeSize(width)}`;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} className="flex-1 gap-4">
      {/* The reference app's "(sunset) 11:20 - - - - (alarm) 8:30" [latest-home-top-1]: two time blocks joined by a dashed rule. */}
      <View className="my-auto gap-1.5">
        <View className="flex-row items-center gap-3">
          <View className="flex-row items-center gap-2">
            <Icon icon={Sunset} size={24} tone="foreground-secondary" strokeWidth={1.5} />
            <Text accessibilityLiveRegion="polite" className={time}>{bed}</Text>
          </View>
          <View accessibilityElementsHidden className="min-w-0 flex-1 items-center">
            <View className="h-0.5 w-full max-w-28">
              <Svg width="100%" height={2}>
                <Line x1={0} y1={1} x2="100%" y2={1} stroke={alpha(c.foreground, 0.2)} strokeWidth={2} strokeDasharray="4 3" />
              </Svg>
            </View>
          </View>
          <View className="flex-row items-center gap-2">
            <Icon icon={AlarmClock} size={24} tone="foreground-secondary" strokeWidth={1.5} />
            <Text className={time}>{clock(plan.wakeAt, timeZone)}</Text>
          </View>
        </View>
        <View className="flex-row justify-between gap-3">
          <Text className={LABEL}>Recommended bedtime</Text>
          <Text className={`${LABEL} text-right`}>Typical wake</Text>
        </View>
      </View>
      {/* At the foot of a stretched card, level with the Energy Bank's Charged / Drained tiles beside it (SYM4). */}
      <View className="mt-auto">
        <Segmented
          fill
          label="Sleep goal"
          value={key}
          onChange={setKey}
          textClassName="text-[13px] font-bold uppercase tracking-[0.1em]"
          options={plan.plans.map((p) => ({ value: p.key, label: p.label, accessibilityLabel: `${p.label}, ${Math.round(p.share * 100)} percent of need` }))}
        />
      </View>
      <Text className="text-xs font-medium leading-4 text-muted-foreground">
        Need tonight: <Text className="font-numeric tabular-nums">{hmm(plan.needMin)}</Text>
      </Text>
    </View>
  );
}
