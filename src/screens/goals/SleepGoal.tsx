// Settings › Goals, the sleep goal (reference study, shared-machinery.md § Sleep goal, sleep.md § Automatic goal
// estimator): automatic, from the nights before your best Recovery, or set by hand. It is what Sleep Performance, Sleep
// Need, Sleep Debt and Energy Bank aim at, so saving it rescores the history (src/state/app.ts saveProfile).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { i18n } from "@/i18n/config";
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
const words = (hours: number) => durationWords(hours * 60);

async function save(hours: number, method: Method) {
  const p = appState().profile;
  if (!p) return;
  await saveProfile({ ...p, sleepGoal: { hours, method } });
  toast.success(i18n.t("goals:sleepGoal.toast", { duration: words(hours) }));
}

/** Hours and minutes as typed: a goal from 4 to 12 hours, or an error. */
function parseGoal(h: string, m: string): { hours: number } | { error: string } {
  const hh = Number(h.trim() || "0");
  const mm = Number(m.trim() || "0");
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || mm < 0 || mm > 59) return { error: i18n.t("goals:sleepGoal.errorFormat") };
  const hours = hh + mm / 60;
  return hours >= 4 && hours <= 12 ? { hours } : { error: i18n.t("goals:sleepGoal.errorRange") };
}

function ManualGoal({ hours }: { hours: number }) {
  const { t } = useTranslation("goals");
  const [h, setH] = useState(String(Math.trunc(hours)));
  const [m, setM] = useState(String(Math.round((hours % 1) * 60)));
  const r = parseGoal(h, m);
  const error = "error" in r ? r.error : null;
  return (
    <View className="pt-3">
      <View className="flex-row items-center gap-2">
        <View className="w-[70px]">
          <TextField variant="number" value={h} onChangeText={setH} keyboardType="number-pad" accessibilityLabel={t("sleepGoal.hoursAria")} invalid={!!error} />
        </View>
        <Text className={HINT}>h</Text>
        <View className="w-[70px]">
          <TextField variant="number" value={m} onChangeText={setM} keyboardType="number-pad" accessibilityLabel={t("sleepGoal.minutesAria")} invalid={!!error} />
        </View>
        <Text className={cn(HINT, "flex-1")}>min</Text>
        <SmallButton solid label={t("actions.save", { ns: "common" })} accessibilityLabel={t("sleepGoal.saveAria")} onPress={() => "hours" in r && void save(r.hours, "manual")} />
      </View>
      {!!error && <Text accessibilityRole="alert" className="pt-1 text-[13px] font-medium leading-[18px] text-recovery-red-text">{error}</Text>}
    </View>
  );
}

export function SleepGoal() {
  const { t } = useTranslation("goals");
  const methods = [
    { value: "automatic", label: t("sleepGoal.automatic") },
    { value: "manual", label: t("sleepGoal.manual") },
  ] as const;
  const { data } = useScreen(sleepGoalView, ["sleep-goal"]);
  const [method, setMethod] = useState<Method | null>(null);
  if (!data)
    return (
      <SectionShell variant="card" title={t("sleepGoal.title")}>
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
    <SectionShell variant="card" title={t("sleepGoal.title")}>
      <Text className={cn(BODY, "pb-1")}>{t("sleepGoal.body")}</Text>
      <View className={ROW}>
        <Text className={ROW_LABEL}>{t("sleepGoal.goal")}</Text>
        <Text className={ROW_VALUE}>{words(data.hours)}</Text>
      </View>
      <View className={cn(ROW_RULE, "pt-3")}>
        <RadioSegments label={t("sleepGoal.method")} value={shown} options={methods} onChange={pick} />
      </View>
      {shown === "manual" ? (
        <ManualGoal key={data.hours} hours={data.hours} />
      ) : est ? (
        <View className="pt-3">
          <Text className={HINT}>
            {t(est.status === "insufficient" ? "sleepGoal.estimateEarly" : "sleepGoal.estimate", { best: Math.trunc(est.nights * 0.15), nights: est.nights, duration: words(est.hours), high: est.high })}
          </Text>
          {Math.abs(est.hours - data.hours) > 1e-9 && (
            <View className="items-start pt-2">
              <SmallButton solid label={t("sleepGoal.use", { duration: words(est.hours) })} accessibilityLabel={t("sleepGoal.useAria", { duration: words(est.hours) })} onPress={() => void save(est.hours, "automatic")} />
            </View>
          )}
        </View>
      ) : (
        <Text className={cn(HINT, "pt-3")}>{t("sleepGoal.notEnough")}</Text>
      )}
    </SectionShell>
  );
}
