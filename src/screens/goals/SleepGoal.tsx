// Settings › Goals, the sleep goal (reference study, shared-machinery.md § Sleep goal, sleep.md § Automatic goal
// estimator): automatic, from the nights before your best Recovery, or set by hand. It is what Sleep Performance, Sleep
// Need, Sleep Debt and Energy Bank aim at, so saving it rescores the history (src/state/app.ts saveProfile).
import { useState } from "react";
import { View } from "react-native";
import { durationWords } from "@/lib/format";
import { sleepGoalView } from "@/queries/sleepGoal";
import { useScreen } from "@/screens/useScreen";
import { BODY, HINT, RadioSegments, ROW, ROW_LABEL, ROW_RULE, ROW_VALUE, SmallButton, TextField } from "@/screens/settings/controls";
import { appState, saveProfile } from "@/state/app";
import { Skeleton } from "@/ui/Skeleton";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { cn } from "@/ui/cn";

type Method = "manual" | "automatic";
const METHODS = [
  { value: "automatic", label: "Automatic" },
  { value: "manual", label: "Manual" },
] as const;

const words = (hours: number) => durationWords(hours * 60);

async function save(hours: number, method: Method) {
  const p = appState().profile;
  if (!p) return;
  await saveProfile({ ...p, sleepGoal: { hours, method } });
  toast.success(`Sleep goal: ${words(hours)}`);
}

/** Hours and minutes as typed: a goal from 4 to 12 hours, or an error. */
function parseGoal(h: string, m: string): { hours: number } | { error: string } {
  const hh = Number(h.trim() || "0");
  const mm = Number(m.trim() || "0");
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || mm < 0 || mm > 59) return { error: "Whole hours, and minutes from 0 to 59" };
  const hours = hh + mm / 60;
  return hours >= 4 && hours <= 12 ? { hours } : { error: "Between 4 and 12 hours" };
}

function ManualGoal({ hours }: { hours: number }) {
  const [h, setH] = useState(String(Math.trunc(hours)));
  const [m, setM] = useState(String(Math.round((hours % 1) * 60)));
  const r = parseGoal(h, m);
  const error = "error" in r ? r.error : null;
  return (
    <View className="pt-3">
      <View className="flex-row items-center gap-2">
        <View className="w-[70px]">
          <TextField variant="number" value={h} onChangeText={setH} keyboardType="number-pad" accessibilityLabel="Sleep goal hours" invalid={!!error} />
        </View>
        <Text className={HINT}>h</Text>
        <View className="w-[70px]">
          <TextField variant="number" value={m} onChangeText={setM} keyboardType="number-pad" accessibilityLabel="Sleep goal minutes" invalid={!!error} />
        </View>
        <Text className={cn(HINT, "flex-1")}>min</Text>
        <SmallButton solid label="Save" accessibilityLabel="Save sleep goal" onPress={() => "hours" in r && void save(r.hours, "manual")} />
      </View>
      {!!error && <Text accessibilityRole="alert" className="pt-1 text-[13px] font-medium leading-[18px] text-recovery-red-text">{error}</Text>}
    </View>
  );
}

export function SleepGoal() {
  const { data } = useScreen(sleepGoalView, ["sleep-goal"]);
  const [method, setMethod] = useState<Method | null>(null);
  if (!data)
    return (
      <SectionShell variant="card" title="Sleep goal">
        <Skeleton className="h-[52px] rounded-[14px]" />
      </SectionShell>
    );
  const shown = method ?? data.method;
  const est = data.estimate;
  const pick = (m: Method) => {
    setMethod(m);
    if (m === "automatic") void save(est?.hours ?? data.hours, "automatic");
  };
  return (
    <SectionShell variant="card" title="Sleep goal">
      <Text className={cn(BODY, "pb-1")}>What Sleep Performance, Sleep Need, Sleep Debt and Energy Bank aim at. Changing it rescores your history.</Text>
      <View className={ROW}>
        <Text className={ROW_LABEL}>Goal</Text>
        <Text className={ROW_VALUE}>{words(data.hours)}</Text>
      </View>
      <View className={cn(ROW_RULE, "pt-3")}>
        <RadioSegments label="How the goal is set" value={shown} options={METHODS} onChange={pick} />
      </View>
      {shown === "manual" ? (
        <ManualGoal key={data.hours} hours={data.hours} />
      ) : est ? (
        <View className="pt-3">
          <Text className={HINT}>
            {`The average sleep before your ${Math.trunc(est.nights * 0.15)} best Recovery mornings of the last ${est.nights}: ${words(est.hours)}.`}
            {est.status === "insufficient" && ` An early estimate: it firms up with 90 nights, 15 of them at Recovery 67 or more (${est.high} so far).`}
          </Text>
          {Math.abs(est.hours - data.hours) > 1e-9 && (
            <View className="items-start pt-2">
              <SmallButton solid label={`Use ${words(est.hours)}`} accessibilityLabel={`Use ${words(est.hours)} as the sleep goal`} onPress={() => void save(est.hours, "automatic")} />
            </View>
          )}
        </View>
      ) : (
        <Text className={cn(HINT, "pt-3")}>Not enough nights yet: the estimate needs nights with a Recovery score, one of them at 67 or more. Until then the goal stays as it is.</Text>
      )}
    </SectionShell>
  );
}
