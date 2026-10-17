// Settings › Goals `/settings?s=goals` (halo src/screens/settings/goals.tsx and weeklyPlan.tsx), on our kit: each daily
// goal as a row with its target in a box (its unit inside, in the person's units), the weekly Active Zone Minutes
// target, then the Weekly plan's targets with the evidence behind each default. A cleared box turns its goal off. Saved as typed (src/state/goals.ts, src/state/weeklyPlan.ts), so the
// cards and trend lines follow at once; an out-of-range number is shown in red and not saved.
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { ChevronDown, Moon, Target, type LucideIcon } from "lucide-react-native";
import { isDefaultPlan, parsePlanTarget, PLAN_LIMITS, withPlanEnabled, withPlanTarget } from "@/core/algorithms/weeklyPlan";
import { GOAL_KEYS, GOAL_META, type GoalKey } from "@/queries/goals";
import { PLAN_KEYS, PLAN_META, type PlanKey } from "@/queries/weeklyPlan";
import { STAT_ICON } from "@/screens/_lib/view";
import { BODY, ChoiceMenu, HINT, ROW_LABEL, ROW_RULE, TextField, type SelectOption } from "@/screens/settings/controls";
import { hmm } from "@/lib/format";
import { quantity } from "@/lib/units";
import { useGoals, isDefaultGoals, parseTarget, TARGET_LIMITS, targetText, withEnabled, withTarget, type TargetKey } from "@/state/goals";
import { useWeeklyPlan } from "@/state/weeklyPlan";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { useMenu } from "@/ui/Menu";
import { Press } from "@/ui/Press";
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
  steps: "Your daily average over the week. The benefit levels off around 8,000 to 10,000 steps a day (Paluch 2022).",
  consistency: "Your sleep consistency over the last 7 nights. 80% and up is optimal.",
  sleepNeed: "Nights you sleep the need Pulse sets for that night.",
};

/**
 * One goal or habit: one row (icon, name, the target's box), then its error or hint under the row at full width from the
 * name's edge, so a long hint never squeezes the row. Off, the icon and name dim and the box reads "Off".
 */
function TargetField({ icon, label, on, error, hint, field, rule }: { icon: LucideIcon; label: string; on: boolean; error?: string; hint?: string; field: ReactNode; rule: boolean }) {
  return (
    <View className={cn("py-3", rule && ROW_RULE)}>
      <View className="flex-row items-center gap-3">
        <Icon icon={icon} size={20} tone={on ? "foreground" : "muted-foreground"} />
        <Text className={cn(ROW_LABEL, "min-w-0 flex-1", !on && "text-muted-foreground")}>{label}</Text>
        <View className={BOX_WIDTH}>{field}</View>
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="pl-8 pt-1 text-[13px] font-medium leading-[18px] text-recovery-red-text">{error}</Text>
      ) : hint ? (
        <Text className={cn(HINT, "pl-8 pt-1")}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** Every target's box: wide enough for "10000 steps" and "2 sessions". */
const BOX_WIDTH = "w-32";

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

/** A target's number with its unit inside the box; blank shows "Off" (a cleared target turns its goal off). */
function NumberField({ value, unit, onChange, onBlur, invalid, label, decimals }: { value: string; unit: string; onChange: (t: string) => void; onBlur: () => void; invalid: boolean; label: string; decimals: number }) {
  return (
    <TextField
      variant="number"
      value={value}
      onChangeText={onChange}
      onBlur={onBlur}
      placeholder="Off"
      keyboardType={decimals ? "decimal-pad" : "number-pad"}
      accessibilityLabel={label}
      invalid={invalid}
      right={value ? <Text className="pl-1 pr-2 text-[13px] leading-[18px] text-muted-foreground">{unit}</Text> : undefined}
    />
  );
}

/** Sleep's goal follows the night's sleep need, or is off; a fixed number of hours set before stays a choice until changed. */
function SleepChoice({ goals, update }: Pick<ReturnType<typeof useGoals>, "goals" | "update">) {
  const { ref, anchor, open, close } = useMenu();
  const fixed = goals.targets.sleep;
  const value: SleepChoiceKey = !goals.enabled.sleep ? "off" : fixed === null ? "need" : "fixed";
  const options: SelectOption<SleepChoiceKey>[] = [
    { value: "need", label: "Sleep need" },
    ...(fixed === null ? [] : [{ value: "fixed" as const, label: `${hmm(fixed * 60)} a night` }]),
    { value: "off", label: "Off" },
  ];
  const on = options.find((o) => o.value === value)!;
  const pick = (v: SleepChoiceKey) => void update((g) => (v === "off" ? withEnabled(g, "sleep", false) : withEnabled(v === "need" ? withTarget(g, "sleep", null) : g, "sleep", true)));
  return (
    <View ref={ref} collapsable={false}>
      <Press activeBg="bg-fill-pressed" accessibilityRole="button" accessibilityLabel={`Sleep goal, ${on.label}`} accessibilityState={{ expanded: !!anchor }} onPress={() => (haptic.tap(), open())} className="h-9 flex-row items-center justify-end gap-1 rounded-lg border border-input px-2 dark:bg-input/30">
        <Text numberOfLines={1} className={cn("shrink text-[15px]", value === "off" && "text-muted-foreground")}>{value === "need" ? "Need" : on.label}</Text>
        <Icon icon={ChevronDown} size={16} tone="muted-foreground" strokeWidth={2} />
      </Press>
      <ChoiceMenu anchor={anchor} close={close} value={value} options={options} onChange={pick} />
    </View>
  );
}
type SleepChoiceKey = "need" | "fixed" | "off";

function DailyGoals() {
  const { goals, update, reset } = useGoals();
  const d = useDrafts<TargetKey>();
  // A goal that is off shows an empty box; its last target is kept for when a number is typed again.
  const text = (k: GoalKey, tk: TargetKey) => d.drafts[tk] ?? (k === tk && !goals.enabled[k] ? "" : targetText(tk, goals.targets[tk]));
  const field = (k: GoalKey, tk: TargetKey, rule: boolean) => {
    const l = TARGET_LIMITS[tk];
    const weekly = tk === "azmWeek";
    const label = weekly ? "Active Zone Minutes a week" : GOAL_META[k].label;
    return (
      <TargetField
        key={tk}
        rule={rule}
        icon={(k === "sleep" ? Moon : STAT_ICON[k]) ?? Target}
        label={label}
        on={goals.enabled[k]}
        error={d.errors[tk]}
        field={
          k === "sleep" ? (
            <SleepChoice goals={goals} update={update} />
          ) : (
            <NumberField
              value={text(k, tk)}
              unit={quantity(l.unit).unit}
              onChange={(t) => {
                // Cleared: the daily goal goes off. The weekly target belongs to the daily goal's switch, so it needs a number.
                if (!t.trim() && !weekly) {
                  d.type(tk, t, null);
                  void update((g) => withEnabled(g, k, false));
                  return;
                }
                const r = parseTarget(tk, t);
                d.type(tk, t, r.error);
                if (!r.error && r.value !== null) void update((g) => (weekly ? withTarget(g, tk, r.value) : withEnabled(withTarget(g, tk, r.value), k, true)));
              }}
              onBlur={() => d.blur(tk)}
              invalid={!!d.errors[tk]}
              label={`${label} target`}
              decimals={l.decimals}
            />
          )
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
        <Text className={cn(BODY, "pb-1")}>Each goal is a row on Strain that fills through the day. Clear a number to turn its goal off.</Text>
        <View>{GOAL_KEYS.map((k, i) => field(k, k, i > 0))}</View>
      </SectionShell>
      <SectionShell variant="card" title="Weekly goal">
        <Text className={cn(BODY, "pb-1")}>Active Zone Minutes add up Monday to Sunday, while the daily Active Zone Minutes goal is on.</Text>
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
        <Text className={cn(BODY, "pb-1")}>Weekly targets for the habits Pulse Age scores, Monday to Sunday, with a streak for every week you meet them. Clear a number to turn it off.</Text>
        <View>
          {PLAN_KEYS.map((k, i) => (
            <TargetField
              key={k}
              rule={i > 0}
              icon={PLAN_ICON[k]}
              label={PLAN_META[k].label}
              on={plan.enabled[k]}
              error={d.errors[k]}
              hint={PLAN_HINT[k]}
              field={
                <NumberField
                  value={d.drafts[k] ?? (plan.enabled[k] ? String(plan.targets[k]) : "")}
                  unit={PLAN_LIMITS[k].unit}
                  onChange={(t) => {
                    // Cleared: the target goes off, its number kept for when one is typed again.
                    if (!t.trim()) {
                      d.type(k, t, null);
                      void update((p) => withPlanEnabled(p, k, false));
                      return;
                    }
                    const r = parsePlanTarget(k, t);
                    d.type(k, t, r.error);
                    if (r.value !== null) void update((p) => withPlanEnabled(withPlanTarget(p, k, r.value!), k, true));
                  }}
                  onBlur={() => d.blur(k)}
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
