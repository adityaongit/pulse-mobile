// The habit screens' shared pieces: the score ring's colour, the period line under a habit, the day marks of a week and
// the amount dialog a numeric habit opens. Pulse's tokens, in the habit tracker's own layout.
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Check, Minus, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { Habit, HabitColor } from "@/core/habits/types";
import type { DayState } from "@/core/habits/logic";
import type { ActivityKind } from "@/queries/habits";
import { DAY, formatDay } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Gradient } from "@/ui/Gradient";
import { Icon } from "@/ui/Icon";
import { usePanelStyle } from "@/ui/Panel";
import { Text } from "@/ui/Text";
import { cn } from "@/ui/cn";
import { useTheme } from "@/ui/theme";
import type { Palette } from "@/ui/palette";
import { Input } from "@/screens/log/fields";
import { ACTIVITY_LOOK } from "./activity";

/** The theme colour a habit was given, in the scheme in force. */
export const habitColor = (c: Palette, color: HabitColor) => c[color];

const round = (v: number) => (Math.round(v * 10) / 10).toString();

/** A day in the card's week row: a filled check, a cross, a dash, an empty circle, or a faint dot off-schedule. */
export function DayMark({ habit, state, color, size = 26, today }: { habit: Habit; state: DayState; color: string; size?: number; today?: boolean }) {
  const value = state.value;
  const numeric = habit.kind === "numeric";
  const filled = state.state === "done";
  const off = state.state === "off";
  return (
    <View
      className={cn("items-center justify-center rounded-full border", today && "border-2")}
      style={{ width: size, height: size, borderColor: filled ? color : off ? "rgba(128,128,128,0.2)" : today ? color : "rgba(128,128,128,0.45)", backgroundColor: filled ? color : "transparent" }}
    >
      {filled ? (
        numeric ? (
          <Text className="font-numeric text-[10px] font-bold leading-3 text-white" numberOfLines={1}>
            {value != null ? (value >= 1000 ? "999" : round(value)) : ""}
          </Text>
        ) : (
          <Icon icon={Check} size={14} tone="background" strokeWidth={3} />
        )
      ) : off ? (
        <View className="size-1 rounded-full bg-muted-foreground/40" />
      ) : state.state === "no" ? (
        <Icon icon={X} size={12} tone="muted-foreground" strokeWidth={2.5} />
      ) : state.state === "skip" ? (
        <Icon icon={Minus} size={12} tone="muted-foreground" strokeWidth={2.5} />
      ) : null}
    </View>
  );
}

/** Where each bubble of a day's cluster sits in its 36 px box: [left, top, size]. */
const CLUSTER: [number, number, number][][] = [
  [],
  [[5, 5, 26]],
  [[1, 1, 22], [13, 13, 22]],
  [[0, 1, 19], [17, 1, 19], [8.5, 16, 19]],
];

/**
 * A day of the Activity row: a bubble per kind of workout, in its colour. One fills the cell, two overlap, three make a
 * triangle, and a fourth or more shows as "+N". A day with none is a bare ring, today's in the accent.
 */
export function ActivityCluster({ kinds, today }: { kinds: ActivityKind[]; today: boolean }) {
  const { c } = useTheme();
  if (!kinds.length) {
    return <View className={cn("size-6 rounded-full border", today && "border-2")} style={{ borderColor: today ? c.strain : "rgba(128,128,128,0.45)" }} />;
  }
  const shown = kinds.slice(0, 3);
  const extra = kinds.length - shown.length;
  return (
    <View style={{ width: 36, height: 36 }}>
      {shown.map((kind, i) => {
        const [left, top, size] = CLUSTER[shown.length][i];
        const look = ACTIVITY_LOOK[kind];
        return (
          <View
            key={kind}
            className="absolute items-center justify-center rounded-full"
            style={{ left, top, width: size, height: size, backgroundColor: c[look.color], borderWidth: shown.length > 1 ? 1.5 : 0, borderColor: c.card }}
          >
            <Icon icon={look.icon} size={Math.round(size * 0.52)} tone="background" strokeWidth={2.4} />
          </View>
        );
      })}
      {extra > 0 && (
        <View className="absolute -bottom-0.5 -right-0.5 size-4 items-center justify-center rounded-full bg-foreground" style={{ borderWidth: 1.5, borderColor: c.card }}>
          <Text className="font-numeric text-[9px] font-bold leading-3 text-background">{`+${extra}`}</Text>
        </View>
      )}
    </View>
  );
}

/** A grid's date header: the weekday over the day of the month, today in the foreground. */
export function DayHeading({ day, today }: { day: string; today: string }) {
  const now = day === today;
  return (
    <View className="h-9 w-10 items-center justify-center gap-0.5">
      <Text className={cn("text-[9px] font-bold uppercase leading-3 tracking-[0.06em]", now ? "text-foreground" : "text-muted-foreground")}>{formatDay(day, { weekday: "short" })}</Text>
      <Text className={cn("font-numeric text-[10px] font-semibold leading-3", now ? "text-foreground" : "text-muted-foreground")}>{formatDay(day, { day: "numeric" })}</Text>
    </View>
  );
}

/** A numeric day's amount: type it, clear the entry, or skip the day. */
export function HabitValueDialog({
  habit,
  day,
  initial,
  onClose,
  onSave,
  onClear,
  onSkip,
}: {
  habit: Habit;
  day: string;
  initial: number | null;
  onClose: () => void;
  onSave: (value: number) => void;
  onClear: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation("habits");
  const { c } = useTheme();
  const panel = usePanelStyle({ ring: "border" });
  const [text, setText] = useState(initial != null ? String(initial) : "");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const value = parseFloat(text.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) return setError(t("value.invalid"));
    onSave(Math.round(value * 100) / 100);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityLabel={habit.name} onPress={onClose} className="flex-1 items-center justify-center bg-dim-strong px-4">
        <Pressable accessible={false} onPress={() => {}} className="w-full max-w-[384px] gap-5 overflow-hidden rounded-3xl p-6" style={panel}>
          <Gradient from={c["popover-top"]} to={c.popover} angle="y" />
          <View className="gap-1">
            <Text accessibilityRole="header" className="text-[17px] font-semibold leading-6">
              {habit.name}
            </Text>
            <Text className="text-[13px] leading-5 text-foreground-secondary">{formatDay(day, DAY.monthDay)}</Text>
          </View>
          <View className="gap-2">
            <Text className="text-[15px] font-medium leading-[22px]">
              {t("value.amount")}
              {habit.unit ? <Text className="font-normal text-muted-foreground"> ({habit.unit})</Text> : null}
            </Text>
            <Input autoFocus selectTextOnFocus keyboardType="decimal-pad" value={text} onChangeText={(v) => (setText(v), setError(null))} placeholder={t("value.placeholder")} accessibilityLabel={t("value.amount")} className="text-base tabular-nums" />
            {!!error && <Text className="text-[13px] font-medium leading-[18px] text-recovery-red-text">{error}</Text>}
          </View>
          <View className="gap-2">
            <Button onPress={save}>{t("value.save")}</Button>
            {initial !== null && (
              <Button variant="secondary" onPress={onClear}>
                {t("value.clear")}
              </Button>
            )}
            <Button variant="outline" onPress={onSkip}>
              {t("value.skip")}
            </Button>
            <Button variant="ghost" onPress={onClose}>
              {t("cancel")}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
