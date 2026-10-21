// Settings › Goals `/settings?s=goals` (halo src/screens/settings/goals.tsx and weeklyPlan.tsx), on our kit: each daily
// goal as a row with its target in a box (its unit inside, in the person's units), the weekly Active Zone Minutes
// target, then the Weekly plan's targets with the evidence behind each default. A cleared box turns its goal off. Saved as typed (src/state/goals.ts, src/state/weeklyPlan.ts), so the
// cards and trend lines follow at once; an out-of-range number is shown in red and not saved.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ChevronDown, Moon, Target, type LucideIcon } from "lucide-react-native";
import { isDefaultPlan, parsePlanTarget, withPlanEnabled, withPlanTarget } from "@/core/algorithms/weeklyPlan";
import { i18n } from "@/i18n/config";
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
  const { t } = useTranslation("goals");
  return (
    <TextField
      variant="number"
      value={value}
      onChangeText={onChange}
      onBlur={onBlur}
      placeholder={t("settings.off")}
      keyboardType={decimals ? "decimal-pad" : "number-pad"}
      accessibilityLabel={label}
      invalid={invalid}
      right={value ? <Text className="pl-1 pr-2 text-[13px] leading-[18px] text-muted-foreground">{unit}</Text> : undefined}
    />
  );
}

/** Sleep's goal follows the night's sleep need, or is off; a fixed number of hours set before stays a choice until changed. */
function SleepChoice({ goals, update }: Pick<ReturnType<typeof useGoals>, "goals" | "update">) {
  const { t } = useTranslation("goals");
  const { ref, anchor, open, close } = useMenu();
  const fixed = goals.targets.sleep;
  const value: SleepChoiceKey = !goals.enabled.sleep ? "off" : fixed === null ? "need" : "fixed";
  const options: SelectOption<SleepChoiceKey>[] = [
    { value: "need", label: t("settings.sleepNeed") },
    ...(fixed === null ? [] : [{ value: "fixed" as const, label: t("settings.fixed", { duration: hmm(fixed * 60) }) }]),
    { value: "off", label: t("settings.off") },
  ];
  const on = options.find((o) => o.value === value)!;
  const pick = (v: SleepChoiceKey) => void update((g) => (v === "off" ? withEnabled(g, "sleep", false) : withEnabled(v === "need" ? withTarget(g, "sleep", null) : g, "sleep", true)));
  return (
    <View ref={ref} collapsable={false}>
      <Press activeBg="bg-fill-pressed" accessibilityRole="button" accessibilityLabel={t("settings.sleepChoiceAria", { choice: on.label })} accessibilityState={{ expanded: !!anchor }} onPress={() => (haptic.tap(), open())} className="h-9 flex-row items-center justify-end gap-1 rounded-lg border border-input px-2 dark:bg-input/30">
        <Text numberOfLines={1} className={cn("shrink text-[15px]", value === "off" && "text-muted-foreground")}>{value === "need" ? t("settings.need") : on.label}</Text>
        <Icon icon={ChevronDown} size={16} tone="muted-foreground" strokeWidth={2} />
      </Press>
      <ChoiceMenu anchor={anchor} close={close} value={value} options={options} onChange={pick} />
    </View>
  );
}
type SleepChoiceKey = "need" | "fixed" | "off";

function DailyGoals() {
  const { t } = useTranslation("goals");
  const { goals, update, reset } = useGoals();
  const d = useDrafts<TargetKey>();
  // A goal that is off shows an empty box; its last target is kept for when a number is typed again.
  const text = (k: GoalKey, tk: TargetKey) => d.drafts[tk] ?? (k === tk && !goals.enabled[k] ? "" : targetText(tk, goals.targets[tk]));
  const field = (k: GoalKey, tk: TargetKey, rule: boolean) => {
    const l = TARGET_LIMITS[tk];
    const weekly = tk === "azmWeek";
    const label = weekly ? t("settings.azmWeek") : GOAL_META[k].label;
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
              label={t("settings.targetAria", { label })}
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
    toast.success(t("settings.goalsReset"));
  };
  return (
    <>
      <SectionShell variant="card" title={t("settings.dailyTitle")}>
        <Text className={cn(BODY, "pb-1")}>{t("settings.dailyBody")}</Text>
        <View>{GOAL_KEYS.map((k, i) => field(k, k, i > 0))}</View>
      </SectionShell>
      <SectionShell variant="card" title={t("settings.weeklyTitle")}>
        <Text className={cn(BODY, "pb-1")}>{t("settings.weeklyBody")}</Text>
        {field("azm", "azmWeek", false)}
        <Text className={cn(HINT, "pt-2")}>{t("settings.azmWeekHint")}</Text>
      </SectionShell>
      <Button variant="outline-pill" disabled={isDefaultGoals(goals)} onPress={() => void doReset()}>{t("settings.resetGoals")}</Button>
    </>
  );
}

function WeeklyTargets() {
  const { t: tr } = useTranslation("goals");
  const { plan, update, reset } = useWeeklyPlan();
  const d = useDrafts<PlanKey>();
  const doReset = async () => {
    await reset();
    d.clear();
    toast.success(tr("settings.planReset"));
  };
  return (
    <>
      <SectionShell variant="card" title={tr("settings.planTitle")}>
        <Text className={cn(BODY, "pb-1")}>{tr("settings.planBody")}</Text>
        <View>
          {PLAN_KEYS.map((k, i) => (
            <TargetField
              key={k}
              rule={i > 0}
              icon={PLAN_ICON[k]}
              label={PLAN_META[k].label}
              on={plan.enabled[k]}
              error={d.errors[k]}
              hint={tr(`planHint.${k}`)}
              field={
                <NumberField
                  value={d.drafts[k] ?? (plan.enabled[k] ? String(plan.targets[k]) : "")}
                  unit={tr(`planUnit.${k}`)}
                  onChange={(t) => {
                    // Cleared: the target goes off, its number kept for when one is typed again.
                    if (!t.trim()) {
                      d.type(k, t, null);
                      void update((p) => withPlanEnabled(p, k, false));
                      return;
                    }
                    const r = parsePlanTarget(k, t);
                    d.type(k, t, r.error && i18n.t(`errors:goals.${r.error.code}`, r.error.params));
                    if (r.value !== null) void update((p) => withPlanEnabled(withPlanTarget(p, k, r.value!), k, true));
                  }}
                  onBlur={() => d.blur(k)}
                  invalid={!!d.errors[k]}
                  label={tr("settings.targetAria", { label: PLAN_META[k].label })}
                  decimals={0}
                />
              }
            />
          ))}
        </View>
      </SectionShell>
      <Button variant="outline-pill" disabled={isDefaultPlan(plan)} onPress={() => void doReset()}>{tr("settings.resetPlan")}</Button>
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
