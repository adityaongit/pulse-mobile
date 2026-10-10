import { Pressable, View } from "react-native";
import { cn } from "./cn";
import { haptic } from "./haptics";
import { Text } from "./Text";

/**
 * The W / M / 6M segmented control (web: SEGMENT_TRACK and SEGMENT_ITEM in primitives.tsx, a ToggleGroup): a muted
 * track, the chosen segment raised. `fill` stretches the segments to share the width (four ranges, or the stages tabs).
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  fill,
  label,
  textClassName = "font-numeric text-[13px] font-bold",
}: {
  value: T;
  options: readonly { value: T; label: string; accessibilityLabel?: string }[];
  onChange: (v: T) => void;
  fill?: boolean;
  /** Spoken name of the control ("Range"). */
  label: string;
  textClassName?: string;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} className={cn("flex-row gap-0.5 rounded-lg bg-muted p-0.5", fill ? "w-full" : "shrink-0")}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.accessibilityLabel ?? o.label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return;
              haptic.select();
              onChange(o.value);
            }}
            className={cn("h-10 items-center justify-center rounded-md px-3", fill ? "flex-1" : "min-w-11", on && "bg-secondary")}
          >
            <Text className={cn(textClassName, on ? "text-foreground" : "text-muted-foreground")}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
