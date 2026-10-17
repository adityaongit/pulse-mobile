// "Build your first Pulse Age" (docs/onboarding.md, Baro's Age checklist): in place of Pace of Aging until the first
// Pulse Age exists, what it is waiting for. The profile's optional height is asked here, where it is used.
import { View } from "react-native";
import { Check, ChevronRight, Circle } from "lucide-react-native";
import { AGE_LABEL, heightText } from "@/lib/format";
import type { HealthspanVM } from "@/queries/types";
import { daysBetween } from "@/lib/time";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { CAPTION } from "@/ui/metrics/primitives";
import { SectionShell } from "@/ui/shells/SectionShell";
import { useOptionalShellCalendar } from "@/ui/shells/ShellStatus";
import { Text } from "@/ui/Text";
import { useScreen } from "../useScreen";
import { push } from "@/ui/navigate";

/** Days of data before the first Pulse Age (HealthspanScreen's "needs 20 days"). */
const FIRST_AGE_DAYS = 20;
const GROUPS = [
  { group: "sleep", label: "Sleep" },
  { group: "strain", label: "Strain" },
  { group: "fitness", label: "Fitness" },
] as const;

function Row({ done, title, detail, onPress }: { done: boolean; title: string; detail: string; onPress?: () => void }) {
  const body = (
    <>
      <Icon icon={done ? Check : Circle} size={18} tone={done ? "optimal" : "muted-foreground"} strokeWidth={2} />
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold leading-5">{title}</Text>
        <Text className={CAPTION}>{detail}</Text>
      </View>
      {onPress && <Icon icon={ChevronRight} size={18} tone="muted-foreground" />}
    </>
  );
  return onPress ? (
    <Press activeOpacity={0.7} accessibilityRole="button" onPress={onPress} className="min-h-11 flex-row items-center gap-3">
      {body}
    </Press>
  ) : (
    <View accessibilityLabel={`${title}: ${detail}${done ? ", done" : ""}`} className="min-h-11 flex-row items-center gap-3">
      {body}
    </View>
  );
}

export function FirstAge({ vm }: { vm: HealthspanVM }) {
  const height = useScreen(async (ctx) => ctx.profile.heightCm, ["firstAge"]).data ?? null;
  const first = useOptionalShellCalendar()?.firstDay;
  const days = first ? Math.max(0, daysBetween(first, vm.day) + 1) : 0;
  return (
    <SectionShell variant="card" title={`Build your first ${AGE_LABEL}`}>
      <Text className={`${CAPTION} mb-3`}>Your profile and recorded days build a {AGE_LABEL}. What is still missing stays missing until it is recorded.</Text>
      <View className="gap-2">
        <Row done={days >= FIRST_AGE_DAYS} title="Recorded days" detail={`${Math.min(days, FIRST_AGE_DAYS)} of ${FIRST_AGE_DAYS} days`} />
        {GROUPS.map(({ group, label }) => {
          const all = vm.contributors.filter((c) => c.group === group);
          if (!all.length) return null;
          const ready = all.filter((c) => c.metric.value !== null).length;
          return <Row key={group} done={ready === all.length} title={label} detail={`${ready} of ${all.length} measures ready`} />;
        })}
        <Row done={height !== null} title="Height" detail={height !== null ? heightText(height) : "Optional. Adds lean body mass."} onPress={() => push("/profile")} />
      </View>
    </SectionShell>
  );
}
