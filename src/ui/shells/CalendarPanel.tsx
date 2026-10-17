import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInUp, SlideOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { DATA_COLORS } from "@/lib/bands";
import { DAY, formatDay, formatValue } from "@/lib/format";
import { cn } from "../cn";
import { Icon } from "../Icon";
import {
  addMonths,
  type CalendarContext,
  dayDisabled,
  dayTone,
  monthGrid,
  monthLabel,
  monthNav,
  monthOf,
  NO_SCORE,
  SLEEP_DOT,
  STRAIN_DOT,
  WEEK_STARTS_ON,
  weekdayLabels,
} from "@/lib/calendar";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { type CalendarDay, useShellCalendar } from "./ShellStatus";
import { Press } from "../Press";
import { DURATION } from "../motion";

export type CalendarPanelProps = {
  open: boolean;
  onClose: () => void;
  /** The selected day (`?d=`, default today); it carries the circle (CAL5). */
  selected: string;
  context: CalendarContext;
  onSelect: (day: string) => void;
  weekStartsOn?: 0 | 1;
};

type Months = Record<string, Map<string, CalendarDay>>;

/**
 * The reference app's month calendar (spec §4.3): a flat panel that drops from the top over a dim scrim. It is a
 * native <Modal>, so the back gesture closes it. Months are fetched through the shell's `loadMonth` the first time
 * they are shown and kept while the switcher lives. (The web adds arrow-key navigation, which a phone has no use for.)
 */
export function CalendarPanel(props: CalendarPanelProps) {
  const { loadMonth } = useShellCalendar();
  const [months, setMonths] = useState<Months>({});
  const requested = useRef(new Set<string>());
  const load = (month: string) => {
    if (!loadMonth || requested.current.has(month)) return;
    requested.current.add(month);
    loadMonth(month)
      .then((days) => setMonths((m) => ({ ...m, [month]: new Map(days.map((x) => [x.day, x])) })))
      // Days stay grey and selectable; the next open retries.
      .catch(() => requested.current.delete(month));
  };
  return (
    <Modal visible={props.open} transparent animationType="none" onRequestClose={props.onClose} statusBarTranslucent>
      {/* Reanimated's Animated.View takes no className, so the animated views carry layout in `style` and the classes go on plain Views inside. */}
      <Animated.View entering={FadeIn.duration(DURATION.base)} exiting={FadeOut.duration(DURATION.base)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
        <View className="flex-1 bg-dim">
          <Pressable accessibilityRole="button" accessibilityLabel="Close calendar" onPress={props.onClose} className="flex-1" />
        </View>
      </Animated.View>
      <Animated.View entering={SlideInUp.duration(DURATION.base)} exiting={SlideOutUp.duration(DURATION.base)} pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        {props.open && <MonthPanel {...props} months={months} load={load} />}
      </Animated.View>
    </Modal>
  );
}

function MonthPanel({ selected, context, onSelect, weekStartsOn = WEEK_STARTS_ON, months, load }: CalendarPanelProps & { months: Months; load: (month: string) => void }) {
  const { today, firstDay } = useShellCalendar();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const first = firstDay ?? undefined;
  // Null until the user moves: the panel opens on the selected day's month. This unmounts on close, so each open starts fresh.
  const [viewed, setViewed] = useState<string | null>(null);
  const month = viewed ?? monthOf(selected);
  const data = months[month];
  const nav = monthNav(month, today, first);
  const weekdays = weekdayLabels(weekStartsOn);
  useEffect(() => load(month));

  return (
    <View className="border-b-[1.5px] border-background-top bg-background-mid px-0.5 pb-4" style={{ paddingTop: insets.top + 12 }}>
      <View className="h-14 flex-row items-center">
        <ChevronButton dir="prev" disabled={!nav.prev} onPress={() => setViewed(addMonths(month, -1))} />
        {/* 12 px like every bar title (spec §11 F19). */}
        <Text accessibilityRole="header" className="flex-1 text-center text-xs font-bold uppercase leading-4 tracking-[0.1em]">
          {monthLabel(month, today)}
        </Text>
        <ChevronButton dir="next" disabled={!nav.next} onPress={() => setViewed(addMonths(month, 1))} />
      </View>

      <View className="mt-1 flex-row">
        {weekdays.map((w) => (
          <Text key={w.short} accessibilityLabel={w.long} className="flex-1 text-center text-xs font-semibold uppercase leading-4 tracking-[0.04em] text-muted-foreground">
            {w.short}
          </Text>
        ))}
      </View>
      <View className="mt-1">
        {monthGrid(month, weekStartsOn).map((week) => (
          <View key={week.find(Boolean)} className="h-12 flex-row">
            {week.map((day, i) =>
              day ? (
                <Day key={day} day={day} context={context} value={data?.get(day)?.[context] ?? null} selected={day === selected} today={day === today} disabled={dayDisabled(day, today, first)} onSelect={onSelect} />
              ) : (
                <View key={i} className="flex-1" />
              ),
            )}
          </View>
        ))}
      </View>

      <View className="mt-2 min-h-11 flex-row items-center gap-3 px-3">
        {/* Back to today from a past day or another month (spec §11 UX1). */}
        {(selected !== today || month !== monthOf(today)) && (
          <Press activeScale={0.96} accessibilityRole="button" accessibilityLabel="Back to today" onPress={() => onSelect(today)} hitSlop={6} className="h-8 justify-center rounded-full bg-fill-hover px-3.5">
            <Text className="text-[11px] font-bold uppercase leading-4 tracking-[0.1em]">Today</Text>
          </Press>
        )}
        <Legend context={context} />
      </View>
      <View className="absolute inset-x-0 bottom-0 h-px" style={{ backgroundColor: c["background-top"] }} />
    </View>
  );
}

function ChevronButton({ dir, disabled, onPress }: { dir: "prev" | "next"; disabled: boolean; onPress: () => void }) {
  return (
    <Press
      activeScale={0.96}
      accessibilityRole="button"
      accessibilityLabel={dir === "prev" ? "Previous month" : "Next month"}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn("size-11 items-center justify-center rounded-full", disabled && "opacity-disabled")}
    >
      <Icon icon={dir === "prev" ? ChevronLeft : ChevronRight} size={32} tone="foreground" strokeWidth={1.5} />
    </Press>
  );
}

const VALUE_TEXT: Record<CalendarContext, (v: number) => string> = {
  recovery: (v) => `Recovery ${Math.round(v)}%`,
  strain: (v) => `Strain ${formatValue("pct", v)}`,
  sleep: (v) => `Sleep ${Math.round(v)}%`,
};

function Day({ day, context, value, selected, today, disabled, onSelect }: { day: string; context: CalendarContext; value: number | null; selected: boolean; today: boolean; disabled: boolean; onSelect: (day: string) => void }) {
  const tone = disabled ? { text: NO_SCORE, dot: null } : dayTone(context, value);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${today ? "Today, " : ""}${formatDay(day, DAY.long)}${value !== null && !disabled ? `, ${VALUE_TEXT[context](value)}` : ""}`}
      disabled={disabled}
      onPress={() => onSelect(day)}
      className="h-12 flex-1 items-center justify-center"
    >
      {/* Today off the selected day gets a dashed ring, so a past day's month still shows where today is (spec §11 UX1). */}
      <View className={cn("size-8 items-center justify-center rounded-full", selected ? "border-2 border-background-mid bg-dial-track" : today && "border border-dashed border-foreground/45")}>
        <Text className={cn("font-numeric text-[17px] font-bold leading-none tabular-nums", tone.text)}>{Number(day.slice(8))}</Text>
        {!!tone.dot && <View className={cn("absolute -bottom-1 size-1 rounded-full", tone.dot)} />}
      </View>
    </Pressable>
  );
}

const LEGEND: Record<CalendarContext, { label: string; color: keyof typeof DATA_COLORS }[]> = {
  recovery: [
    { label: "<34%", color: "recovery-red" },
    { label: "34% - 66%", color: "recovery-yellow" },
    { label: ">66%", color: "recovery-green" },
  ],
  strain: [{ label: `Day Strain ${STRAIN_DOT}+`, color: "strain" }],
  sleep: [{ label: `Sleep ${SLEEP_DOT}%+`, color: "sleep" }],
};

function Legend({ context }: { context: CalendarContext }) {
  return (
    <View className="ml-auto flex-row gap-3">
      {LEGEND[context].map(({ label, color }) => (
        <View key={label} className="flex-row items-center gap-1.5">
          <View className={cn("size-1 rounded-full", DATA_COLORS[color].bg)} />
          <Text className={cn("text-xs font-semibold leading-4 tabular-nums", DATA_COLORS[color].text)}>{label}</Text>
        </View>
      ))}
    </View>
  );
}
