// Settings › Goals `/settings?s=goals` (halo src/screens/settings/goals.tsx and weeklyPlan.tsx), on our kit: each daily
// goal with a switch and a numeric target in its unit, the weekly Active Zone Minutes target, then the Weekly plan's
// targets with the evidence behind each default. Saved as typed (src/state/goals.ts, src/state/weeklyPlan.ts), so the
// cards and trend lines follow at once; an out-of-range number is shown in red and not saved.
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { Moon, Target, type LucideIcon } from "lucide-react-native";
import { isDefaultPlan, parsePlanTarget, PLAN_DEFAULTS, PLAN_LIMITS, withPlanEnabled, withPlanTarget } from "@/core/algorithms/weeklyPlan";
import { GOAL_KEYS, GOAL_META, type GoalKey } from "@/queries/goals";
import { PLAN_KEYS, PLAN_META, type PlanKey } from "@/queries/weeklyPlan";
import { STAT_ICON } from "@/screens/_lib/view";
import { BODY, HINT, ROW_LABEL, ROW_RULE, Switch, TextField } from "@/screens/settings/controls";
import { quantity } from "@/lib/units";
import { useGoals, isDefaultGoals, parseTarget, TARGET_LIMITS, targetText, withEnabled, withTarget, type TargetKey } from "@/state/goals";
import { useWeeklyPlan } from "@/state/weeklyPlan";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { SleepGoal } from "./SleepGoal";
import { PLAN_ICON } from "./WeeklyPlan";

const GOAL_HINT: Partial<Record<TargetKey, string>> = {
  azmWeek: "Fitbit counts moderate minutes once and vigorous or peak minutes twice.",
};

const PLAN_HINT: Record<PlanKey, string> = {
  zone13: "WHO: 150–300 minutes a week. Zones 1–3, from 50% of your max heart rate, a brisk walk.",
  zone45: "WHO: 75–150 minutes a week, or mix them with moderate minutes.",
  strength: "Strength, weights, HIIT or calisthenics workouts. WHO: 2 or more days a week.",
  steps: "The benefit levels off around 8,000 to 10,000 steps a day (Paluch 2022).",
  consistency: "Your sleep consistency over the last 7 nights. 80% and up is optimal.",
  sleepNeed: "Nights you sleep the need Pulse sets for that night.",
};

/**
 * One goal or habit: one row (icon, name, the target with its unit, the switch), then its error or hint under the row
 * at full width from the name's edge, so a long hint never squeezes the row. Off, the name and target dim.
 */
function TargetField({ icon, label, on, onToggle, unit, error, hint, field, rule }: { icon: LucideIcon; label: string; on: boolean; onToggle: (on: boolean) => void; unit: string; error?: string; hint?: string; field: ReactNode; rule: boolean }) {
  return (
    <View className={cn("py-3", rule && ROW_RULE)}>
      <View className="flex-row items-center gap-3">
        <Icon icon={icon} size={20} tone={on ? "foreground" : "muted-foreground"} />
        <Text className={cn(ROW_LABEL, "min-w-0 flex-1", !on && "text-muted-foreground")}>{label}</Text>
        {/* The unit sits beside the number in the person's units (the card's title already says daily or weekly). */}
        <View className={cn("flex-row items-center gap-1.5", !on && "opacity-40")}>
          <View className="w-[70px]">{field}</View>
          <Text numberOfLines={1} className="w-9 text-[13px] leading-[18px] text-muted-foreground">{unit}</Text>
        </View>
        <Switch value={on} onValueChange={onToggle} label={`${label} target`} />
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="pl-8 pt-1 text-[13px] font-medium leading-[18px] text-recovery-red-text">{error}</Text>
      ) : hint ? (
        <Text className={cn(HINT, "pl-8 pt-1")}>{hint}</Text>
      ) : null}
    </View>
  );
}


/** Drafts and errors for typed targets: a field shows what is typed until it loses focus, then the stored value. */
function useDrafts<K extends string>() {
  const [drafts, setDrafts] = useState<Partial<Record<K, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const type = (k: K, t: string, error: string | null) => {
    setDrafts((d) => ({ ...d, [k]: t }));
    setErrors((e) => ({ ...e, [k]: error ?? undefined }));
  };
  const blur = (k: K) => {
    if (errors[k]) return; // keep the rejected text in view with its error
    setDrafts(({ [k]: _, ...rest }) => rest as Partial<Record<K, string>>);
  };
  const clear = () => (setDrafts({}), setErrors({}));
  return { drafts, errors, type, blur, clear };
}

function NumberField({ value, onChange, onBlur, placeholder, invalid, label, decimals }: { value: string; onChange: (t: string) => void; onBlur: () => void; placeholder: string; invalid: boolean; label: string; decimals: number }) {
  return <TextField variant="number" value={value} onChangeText={onChange} onBlur={onBlur} placeholder={placeholder} keyboardType={decimals ? "decimal-pad" : "number-pad"} accessibilityLabel={label} invalid={invalid} />;
}

function DailyGoals() {
  const { goals, update, reset } = useGoals();
  const d = useDrafts<TargetKey>();
  const text = (k: TargetKey) => d.drafts[k] ?? targetText(k, goals.targets[k]);
  const field = (k: GoalKey, targetKey: TargetKey, rule: boolean) => {
    const l = TARGET_LIMITS[targetKey];
    const label = targetKey === "azmWeek" ? "Active Zone Minutes a week" : GOAL_META[k].label;
    return (
      <TargetField
        key={targetKey}
        rule={rule}
        icon={(k === "sleep" ? Moon : STAT_ICON[k]) ?? Target}
        label={label}
        on={goals.enabled[k]}
        onToggle={(on) => void update((g) => withEnabled(g, k, on))}
        unit={quantity(l.unit).unit}
        error={d.errors[targetKey]}
        field={
          <NumberField
            value={text(targetKey)}
            onChange={(t) => {
              const r = parseTarget(targetKey, t);
              d.type(targetKey, t, r.error);
              if (!r.error) void update((g) => withTarget(g, targetKey, r.value));
            }}
            onBlur={() => d.blur(targetKey)}
            placeholder={l.optional ? "Auto" : targetText(targetKey, l.min)}
            invalid={!!d.errors[targetKey]}
            label={`${label} target`}
            decimals={l.decimals}
          />
        }
      />
    );
  };
  const doReset = async () => {
    await reset();
    d.clear();
    toast.success("Goals reset to Fitbit’s defaults");
  };
  return (
    <>
      <SectionShell variant="card" title="Daily goals">
        <Text className={cn(BODY, "pb-1")}>Each goal is a row on Strain that fills through the day.</Text>
        <View>{GOAL_KEYS.map((k, i) => field(k, k, i > 0))}</View>
        <Text className={cn(HINT, "pt-2")}>Sleep: blank follows Pulse’s sleep need for the night.</Text>
      </SectionShell>
      <SectionShell variant="card" title="Weekly goal">
        <Text className={cn(BODY, "pb-1")}>Active Zone Minutes add up Monday to Sunday. The switch is the daily goal’s.</Text>
        {field("azm", "azmWeek", false)}
        <Text className={cn(HINT, "pt-2")}>{GOAL_HINT.azmWeek}</Text>
      </SectionShell>
      <Button variant="outline-pill" disabled={isDefaultGoals(goals)} onPress={() => void doReset()}>Reset to Fitbit defaults</Button>
    </>
  );
}

function WeeklyTargets() {
  const { plan, update, reset } = useWeeklyPlan();
  const d = useDrafts<PlanKey>();
  const doReset = async () => {
    await reset();
    d.clear();
    toast.success("Weekly plan reset to its defaults");
  };
  return (
    <>
      <SectionShell variant="card" title="Weekly plan">
        <Text className={cn(BODY, "pb-1")}>Weekly targets for the habits Pulse Age scores, Monday to Sunday, with a streak for every week you meet them.</Text>
        <View>
          {PLAN_KEYS.map((k, i) => (
            <TargetField
              key={k}
              rule={i > 0}
              icon={PLAN_ICON[k]}
              label={PLAN_META[k].label}
              on={plan.enabled[k]}
              onToggle={(on) => void update((p) => withPlanEnabled(p, k, on))}
              unit={PLAN_LIMITS[k].unit}
              error={d.errors[k]}
              hint={PLAN_HINT[k]}
              field={
                <NumberField
                  value={d.drafts[k] ?? String(plan.targets[k])}
                  onChange={(t) => {
                    const r = parsePlanTarget(k, t);
                    d.type(k, t, r.error);
                    if (r.value !== null) void update((p) => withPlanTarget(p, k, r.value!));
                  }}
                  onBlur={() => d.blur(k)}
                  placeholder={String(PLAN_DEFAULTS.targets[k])}
                  invalid={!!d.errors[k]}
                  label={`${PLAN_META[k].label} target`}
                  decimals={0}
                />
              }
            />
          ))}
        </View>
      </SectionShell>
      <Button variant="outline-pill" disabled={isDefaultPlan(plan)} onPress={() => void doReset()}>Reset weekly plan</Button>
    </>
  );
}

export function GoalsSettings() {
  return (
    <>
      <SleepGoal />
      <DailyGoals />
      <WeeklyTargets />
    </>
  );
}
