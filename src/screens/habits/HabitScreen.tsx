// One habit `/habits/[id]`: the strength score, streaks, Loop's history calendar and the score curve. Tapping a day
// ticks it, opens the amount dialog, or skips it; the menu edits, archives and deletes the habit.
import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, SkipForward, Trash2 } from "lucide-react-native";
import type { Habit } from "@/core/habits/types";
import { habitIcon } from "@/core/habits/icons";
import type { DayState } from "@/core/habits/logic";
import { addDays } from "@/lib/time";
import { periodText, streakText } from "@/lib/habits";
import { getHabit } from "@/queries/habits";
import { archiveHabit, clearHabitEntry, deleteHabit, setHabitEntry, skipHabitDay, toggleHabit } from "@/actions/habits";
import { actionCtx } from "@/state/app";
import { habitsChanged } from "@/state/habits";
import { useScreen } from "@/screens/useScreen";
import { Card, CardFill } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import { MenuPanel, useMenu } from "@/ui/Menu";
import { HabitRing } from "@/ui/metrics/HabitRing";
import { LABEL } from "@/ui/metrics/primitives";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { ConfirmDialog, MenuItem, MiniLine } from "@/screens/gym/parts";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { QueryError } from "@/ui/shells/QueryError";
import { SectionShell } from "@/ui/shells/SectionShell";
import { goBack, push } from "@/ui/navigate";
import { toast } from "@/ui/Toast";
import { HabitValueDialog, habitColor } from "./parts";

const nowS = () => Math.floor(Date.now() / 1000);

export function HabitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation("habits");
  const { data, error, reload } = useScreen((ctx) => getHabit(ctx, id), ["habit", id], { eager: true, freshMs: 0 });
  const [value, setValue] = useState<{ habit: Habit; day: string; initial: number | null } | null>(null);
  const [removing, setRemoving] = useState(false);
  const { ref: menuRef, anchor, open: openMenu, close: closeMenu } = useMenu();
  const { c } = useTheme();

  if (data === null) {
    return <DetailShell title={t("title")} backHref="/habits" floatingAction={false} primary={<EmptyState body={t("detail.notFoundBody")} />} />;
  }
  if (!data) {
    return error ? (
      <DetailShell title={t("title")} backHref="/habits" floatingAction={false} primary={<QueryError compact error={error} reload={reload} />} />
    ) : (
      <DetailShell title={t("title")} backHref="/habits" floatingAction={false} loading primary={<View className="h-40" />} />
    );
  }

  const { habit, stats, days, scores } = data;
  const color = habitColor(c, habit.color);
  const changed = () => habitsChanged();
  const store = () => actionCtx().store;
  const openDay = (day: string, state: DayState) => {
    if (habit.kind === "numeric") {
      setValue({ habit, day, initial: state.state === "done" ? state.value : null });
      return;
    }
    void toggleHabit(store(), habit, day, nowS()).then(changed);
  };
  const saveValue = async (day: string, amount: number) => {
    await setHabitEntry(store(), habit, { day, value: amount }, nowS());
    setValue(null);
    changed();
  };
  const clearValue = async (day: string) => {
    await clearHabitEntry(store(), habit.id, day);
    setValue(null);
    changed();
  };
  const skipValue = async (day: string) => {
    await skipHabitDay(store(), habit, day, nowS());
    setValue(null);
    changed();
  };
  const skipToday = async () => {
    await skipHabitDay(store(), habit, days[days.length - 1].day, nowS());
    changed();
  };
  const archive = async (archived: boolean) => {
    await archiveHabit(store(), habit.id, archived, nowS());
    changed();
    toast.success(archived ? t("menu.archived") : t("menu.unarchived"));
  };

  return (
    <View className="flex-1">
      <DetailShell
        title={habit.name}
        backHref="/habits"
        floatingAction={false}
        action={
          <View ref={menuRef} collapsable={false}>
            <Press accessibilityRole="button" accessibilityLabel={t("menu.label")} onPress={openMenu} className="size-11 items-center justify-center">
              <Icon icon={MoreHorizontal} size={20} tone="muted-foreground" />
            </Press>
          </View>
        }
        primary={
          <View className="gap-4">
            <Card className="items-center gap-4 px-4 py-5">
              <CardFill />
              <Text className="text-[30px] leading-9">{habitIcon(habit)}</Text>
              <HabitRing value={stats.score} color={color} size={132} stroke={10}>
                <View className="items-center">
                  <Text className="font-numeric text-[34px] font-bold leading-10">{Math.round(stats.score * 100)}%</Text>
                  <Text className={LABEL}>{t("detail.score")}</Text>
                </View>
              </HabitRing>
              <Text className="text-center text-[15px] leading-[22px] text-foreground-secondary">{periodText(habit, stats)}</Text>
              {!!habit.question && <Text className="text-center text-[14px] leading-[20px] text-muted-foreground">{habit.question}</Text>}
              <View className="w-full flex-row gap-3">
                <Stat label={t("detail.current")} value={stats.current > 0 ? streakText(habit, stats.current) : "—"} />
                <Stat label={t("detail.best")} value={stats.best > 0 ? streakText(habit, stats.best) : "—"} />
              </View>
            </Card>

            <SectionShell variant="card" title={t("detail.history")}>
              <HistoryGrid habit={habit} days={days} today={days[days.length - 1]?.day ?? ""} onDay={openDay} />
            </SectionShell>

            <SectionShell variant="card" title={t("detail.chart")}>
              {scores.some((s) => s.value > 0) ? <MiniLine values={scores.map((s) => s.value * 100)} color={color} /> : <EmptyState body={t("detail.noHistory")} />}
            </SectionShell>

            {!!habit.notes && (
              <Card className="gap-1 px-4 py-4">
                <CardFill />
                <Text className={LABEL}>{t("detail.notes")}</Text>
                <Text className="text-[15px] leading-[22px] text-foreground-secondary">{habit.notes}</Text>
              </Card>
            )}
          </View>
        }
      />
      <MenuPanel anchor={anchor} onClose={closeMenu} align="end">
        <MenuItem icon={Pencil} label={t("menu.edit")} onPress={() => (closeMenu(), push(`/habits/edit?id=${habit.id}`))} />
        {!habit.archived && <MenuItem icon={SkipForward} label={t("menu.skip")} onPress={() => (closeMenu(), void skipToday())} />}
        <MenuItem icon={habit.archived ? ArchiveRestore : Archive} label={habit.archived ? t("menu.unarchive") : t("menu.archive")} onPress={() => (closeMenu(), void archive(!habit.archived))} />
        <MenuItem icon={Trash2} label={t("menu.delete")} danger onPress={() => (closeMenu(), setRemoving(true))} />
      </MenuPanel>
      {value && (
        <HabitValueDialog
          key={`${value.habit.id}-${value.day}`}
          habit={value.habit}
          day={value.day}
          initial={value.initial}
          onClose={() => setValue(null)}
          onSave={(amount) => void saveValue(value.day, amount)}
          onClear={() => void clearValue(value.day)}
          onSkip={() => void skipValue(value.day)}
        />
      )}
      <ConfirmDialog
        open={removing}
        title={t("deleteTitle")}
        body={t("deleteBody")}
        confirm={t("delete")}
        onCancel={() => setRemoving(false)}
        onConfirm={async () => {
          await deleteHabit(store(), habit.id);
          habitsChanged();
          goBack();
        }}
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View className="min-w-0 flex-1 items-center gap-1 rounded-xl px-2 py-2.5" style={{ backgroundColor: c.secondary }}>
      <Text className={LABEL}>{label}</Text>
      <Text className="font-numeric text-[17px] font-semibold leading-6">{value}</Text>
    </View>
  );
}

/** Whole weeks of days from `first` up to the week holding `last`. Outside the component: the React Compiler skips one with this loop in it. */
function weeksFrom(first: string, last: string): string[][] {
  const weeks: string[][] = [];
  for (let start = first; start <= last; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

/** The last 20 weeks, Monday to Sunday, oldest first: a filled square for a done day, faint for none, a dash for skip. */
function HistoryGrid({ habit, days, today, onDay }: { habit: Habit; days: { day: string; state: DayState }[]; today: string; onDay: (day: string, state: DayState) => void }) {
  const { c } = useTheme();
  const color = habitColor(c, habit.color);
  const byDay = new Map<string, DayState>(days.map((d) => [d.day, d.state]));
  const first = (() => {
    const day = days[0]?.day ?? today;
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    return addDays(day, -((dow + 6) % 7));
  })();
  const weeks = weeksFrom(first, today);
  const shown = weeks.slice(-20);
  return (
    <View className="gap-2">
      <View className="flex-row gap-[3px]">
        {shown.map((week) => (
          <View key={week[0]} className="flex-1 gap-[3px]">
            {week.map((day) => {
              const state: DayState = byDay.get(day) ?? { state: "empty", value: null };
              const future = day > today;
              const off = state.state === "off";
              const disabled = future || off;
              const done = state.state === "done";
              return (
                <Press
                  key={day}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={day}
                  accessibilityState={{ disabled }}
                  onPress={() => onDay(day, state)}
                  className="w-full items-center justify-center"
                  style={{ height: 13, borderRadius: 3, backgroundColor: disabled ? "transparent" : done ? color : state.state === "skip" ? c.secondary : state.state === "no" ? c.muted : c.secondary, borderWidth: day === today ? 1.5 : 0, borderColor: color }}
                >
                  {state.state === "skip" && <View className="h-px w-1.5" style={{ backgroundColor: c["muted-foreground"] }} />}
                </Press>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
