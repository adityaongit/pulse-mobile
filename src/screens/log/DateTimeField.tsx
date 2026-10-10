// The web's <input type="datetime-local"> and <input type="date"> (Log.tsx): the system's own picker, as the browser
// shows its own. iOS: the compact SwiftUI DatePicker sits in the field. Android: the field shows the value and opens
// the system date dialog, then the time dialog. Both come from @expo/ui's drop-in for @react-native-community/datetimepicker
// (in Expo Go). Values are the app's wall strings: `YYYY-MM-DDTHH:mm`, or `YYYY-MM-DD` for mode "date".
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { DAY, formatDay } from "@/lib/format";
import { alpha } from "@/ui/color";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { dateToDay, dateToWall, wallToDate } from "./form";

export type DateTimeFieldProps = {
  value: string;
  onChange: (wall: string) => void;
  mode: "datetime" | "date";
  /** The latest and earliest choice, in the same shape as `value`. */
  max?: string;
  min?: string;
  label: string;
};

const FRAME = "h-11 justify-center rounded-lg border border-input px-2.5";

export function DateTimeField({ value, onChange, mode, max, min, label }: DateTimeFieldProps) {
  const { c, scheme } = useTheme();
  const [step, setStep] = useState<"date" | "time" | null>(null);
  const fill = scheme === "dark" ? alpha(c.input, 0.3) : "transparent";
  const date = mode === "date";
  const out = (d: Date) => (date ? dateToDay(d) : dateToWall(d));
  const clamp = (w: string) => (max && w > max ? max : min && w < min ? min : w);
  const maximumDate = max ? wallToDate(max) : undefined;
  const minimumDate = min ? wallToDate(min) : undefined;

  if (Platform.OS === "ios") {
    return (
      <View accessibilityLabel={label} className={FRAME} style={{ backgroundColor: fill }}>
        <DateTimePicker value={wallToDate(value || (date ? dateToDay(new Date()) : dateToWall(new Date())))} mode={mode} display="compact" maximumDate={maximumDate} minimumDate={minimumDate} themeVariant={scheme} onValueChange={(_e, d) => onChange(clamp(out(d)))} />
      </View>
    );
  }

  const shown = value ? (date ? formatDay(value, DAY.full) : `${formatDay(value.slice(0, 10), DAY.full)}, ${value.slice(11, 16)}`) : date ? "Choose a day" : "Choose a time";
  const current = wallToDate(value || dateToWall(new Date()));
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${shown}`} onPress={() => setStep("date")} className={FRAME} style={{ backgroundColor: fill }}>
        <Text className={value ? "text-base tabular-nums" : "text-base text-muted-foreground"}>{shown}</Text>
      </Pressable>
      {step === "date" && (
        <DateTimePicker
          value={current}
          mode="date"
          maximumDate={maximumDate}
          minimumDate={minimumDate}
          onDismiss={() => setStep(null)}
          onValueChange={(_e, d) => {
            // The day alone changes; a datetime goes on to its time, keeping the time it had.
            const next = dateToWall(new Date(d.getFullYear(), d.getMonth(), d.getDate(), current.getHours(), current.getMinutes()));
            if (date) {
              setStep(null);
              onChange(clamp(next.slice(0, 10)));
            } else {
              onChange(clamp(next));
              setStep("time");
            }
          }}
        />
      )}
      {step === "time" && <DateTimePicker value={wallToDate(value)} mode="time" is24Hour onDismiss={() => setStep(null)} onValueChange={(_e, d) => (setStep(null), onChange(clamp(`${value.slice(0, 10)}T${dateToWall(d).slice(11)}`)))} />}
    </>
  );
}
