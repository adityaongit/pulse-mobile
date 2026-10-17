// The web's <input type="datetime-local"> and <input type="date"> (Log.tsx): a field like the other inputs that shows the
// value as text and opens the system's picker. iOS: the picker's wheels in a centred card over a dim, as the app's
// dialogs (InfoDialog), with Done. Android: the system date dialog, then the time dialog. Both come from @expo/ui's
// drop-in for @react-native-community/datetimepicker (in Expo Go). Values are the app's wall strings:
// `YYYY-MM-DDTHH:mm`, or `YYYY-MM-DD` for mode "date".
import { useState } from "react";
import { Modal, Platform, Pressable } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { DAY, formatDay, timeOfDay } from "@/lib/format";
import { displayPrefs } from "@/lib/units";
import { Button } from "@/ui/Button";
import { haptic } from "@/ui/haptics";
import { Panel } from "@/ui/Panel";
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
  const date = mode === "date";
  const clamp = (w: string) => (max && w > max ? max : min && w < min ? min : w);
  const maximumDate = max ? wallToDate(max) : undefined;
  const minimumDate = min ? wallToDate(min) : undefined;
  const shown = value ? (date ? formatDay(value, DAY.full) : `${formatDay(value.slice(0, 10), DAY.full)}, ${timeOfDay(Number(value.slice(11, 13)), Number(value.slice(14, 16)))}`) : date ? "Choose a day" : "Choose a time";
  const current = wallToDate(value || (date ? dateToDay(new Date()) : dateToWall(new Date())));

  const field = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${shown}`}
      accessibilityState={{ expanded: step !== null }}
      onPress={() => {
        haptic.tap();
        setStep("date");
      }}
      className={FRAME}
      // The web input's focus ring (`border-ring`) while its picker is open.
      style={{ backgroundColor: c["input-fill"], borderColor: step ? c.ring : c.input }}
    >
      <Text numberOfLines={1} className={value ? "text-base tabular-nums" : "text-base text-muted-foreground"}>
        {shown}
      </Text>
    </Pressable>
  );

  if (Platform.OS === "ios")
    return (
      <>
        {field}
        <Modal visible={step !== null} transparent animationType="fade" onRequestClose={() => setStep(null)}>
          <Pressable accessibilityLabel="Close" onPress={() => setStep(null)} className="flex-1 items-center justify-center bg-dim-strong px-4">
            {/* The card swallows taps, so only the dim closes it. */}
            <Panel ring={null} shadow={null} onStartShouldSetResponder={() => true} className="w-full max-w-[360px] items-center gap-4 rounded-3xl p-4">
              <DateTimePicker
                value={current}
                mode={mode}
                display="spinner"
                // The native view takes the card's width: centred and unsized, it drew its wheels but took no touches.
                style={{ alignSelf: "stretch" }}
                maximumDate={maximumDate}
                minimumDate={minimumDate}
                themeVariant={scheme}
                onValueChange={(_e, d) => {
                  haptic.select();
                  onChange(clamp(date ? dateToDay(d) : dateToWall(d)));
                }}
              />
              <Button onPress={() => setStep(null)}>
                Done
              </Button>
            </Panel>
          </Pressable>
        </Modal>
      </>
    );

  return (
    <>
      {field}
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
      {step === "time" && <DateTimePicker value={wallToDate(value)} mode="time" is24Hour={displayPrefs().hours === 24} onDismiss={() => setStep(null)} onValueChange={(_e, d) => (setStep(null), onChange(clamp(`${value.slice(0, 10)}T${dateToWall(d).slice(11)}`)))} />}
    </>
  );
}
