import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams, usePathname } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { pillLabel, rangeLabel } from "@/lib/format";
import { parseDay, stepDay, weekOf } from "@/lib/url";
import { cn } from "../cn";
import { haptic } from "../haptics";
import { Icon } from "../Icon";
import { calendarContext, type CalendarContext } from "@/lib/calendar";
import { Text } from "../Text";
import { CalendarPanel } from "./CalendarPanel";
import { useShellCalendar } from "./ShellStatus";

export type DateSwitcherProps = {
  mode: "day" | "week";
  /** The calendar's colouring; default from the route (/strain and /activity Strain, /sleep Sleep, else Recovery). */
  calendar?: CalendarContext;
  /**
   * `header`: the date is the detail header's title between two small chevrons (Recovery, Strain, Sleep, spec §4.4).
   * `body` (default): the pill, in a header or under it.
   */
  placement?: "header" | "body";
  /** Home's top row: the pill tightens (24 px chevrons, snug label) so the row fits at 320 px. */
  narrow?: boolean;
  /** false: the label alone, no chevrons (the score screens' "TODAY", spec §11 R33). The label still opens the calendar. */
  steppers?: boolean;
};

// 32 px visual, 44 px hit area (spec §4.3.1); the next chevron greys out on today.
const LABEL = "text-[11px] font-bold uppercase leading-4 tracking-[0.1em]";

/** The selected day: the route's `d` search param (parseDay: missing or bad means today), and a setter that replaces it. */
export function useSelectedDay() {
  const { today } = useShellCalendar();
  const { d: raw } = useLocalSearchParams<{ d?: string }>();
  const { d } = parseDay(raw, today);
  // replace, not push: Back leaves the screen instead of stepping through days (spec §8). Today is written as "", which parseDay reads as today.
  const setDay = (day: string) => {
    haptic.select();
    router.setParams({ d: day === today ? "" : day });
  };
  return [d, setDay] as const;
}

/** The reference app's date pill (spec §4.3). Reads `?d=` (useSelectedDay); changes it by replacing the param. */
export function DateSwitcher({ mode, calendar, placement = "body", narrow = false, steppers = true }: DateSwitcherProps) {
  const { today, firstDay } = useShellCalendar();
  const pathname = usePathname();
  const [d, setDay] = useSelectedDay();
  const [open, setOpen] = useState(false);

  const week = mode === "week";
  const [weekStart, weekEnd] = weekOf(d);
  const atEnd = week ? weekStart >= weekOf(today)[0] : d >= today;
  const atStart = !!firstDay && (week ? weekStart <= firstDay : d <= firstDay);
  const unit = week ? "week" : "day";
  const step = week ? 7 : 1;
  const by = (n: number) => setDay(stepDay(d, n, today, firstDay));

  const label = week ? rangeLabel(weekStart, weekEnd) : pillLabel(d, today);
  const bare = placement === "header";
  const stepClass = bare ? "size-9" : narrow ? "size-6" : "size-7";

  const stepper = (dir: -1 | 1, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${dir < 0 ? "Previous" : "Next"} ${unit}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => by(dir * step)}
      hitSlop={bare ? { top: 4, bottom: 4, left: 2, right: 2 } : 8}
      className={cn("items-center justify-center rounded-full active:scale-[0.96]", stepClass, disabled ? (bare ? "opacity-25" : "opacity-35") : bare ? "opacity-70" : "opacity-75")}
    >
      <Icon icon={dir < 0 ? ChevronLeft : ChevronRight} size={bare ? 16 : 18} tone="foreground" strokeWidth={2.25} />
    </Pressable>
  );

  return (
    <View className={cn("flex-row items-center self-center", bare ? "gap-1" : "h-[30px] rounded-full bg-foreground/[0.04] p-px")}>
      {steppers && stepper(-1, atStart)}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. Open calendar`}
        onPress={() => setOpen(true)}
        hitSlop={{ top: bare ? 4 : 8, bottom: bare ? 4 : 8 }}
        className={cn("items-center justify-center rounded-full active:scale-[0.96]", bare ? "h-9 min-w-28 px-2" : cn("h-7 bg-foreground/[0.08] px-4", narrow ? "min-w-0 px-2.5" : "min-w-24"))}
      >
        <Text className={cn(bare ? "text-xs font-bold uppercase leading-4 tracking-[0.1em]" : LABEL, "tabular-nums")}>{label}</Text>
      </Pressable>
      {steppers && stepper(1, atEnd)}
      <CalendarPanel open={open} onClose={() => setOpen(false)} selected={d} context={calendar ?? calendarContext(pathname)} onSelect={(day) => (setDay(day), setOpen(false))} />
    </View>
  );
}
