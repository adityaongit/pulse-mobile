// The form controls the log sheets and the check-in share, as the web draws them (components/ui/{input,label,
// toggle-group,alert}.tsx and the Chips / Field / Alert pieces of (app)/journal/Log.tsx): React Native has no
// <input>, and the kit has none yet, so they are built here from its tokens.
import type { ComponentProps, ReactNode, Ref } from "react";
import { Pressable, TextInput, View } from "react-native";
import { alpha } from "@/ui/color";
import { cn } from "@/ui/cn";
import { FACES } from "@/ui/fontClasses";
import { haptic } from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

/** A text field: 44 px, 10 px corners, a 1 px input border, transparent (a faint fill in dark), 16 px text. */
export function Input({ className, style, ...props }: ComponentProps<typeof TextInput> & { ref?: Ref<TextInput> }) {
  const { c, scheme } = useTheme();
  return (
    <TextInput
      autoComplete="off"
      autoCorrect={false}
      placeholderTextColor={c["muted-foreground"]}
      selectionColor={c.foreground}
      // A multiline field (the notes) brings its own height, corners, border colour and padding: classes are written once, never overridden.
      className={cn("min-w-0 border text-base text-foreground", !props.multiline && "h-11 rounded-lg border-input px-2.5 py-1", className)}
      style={[{ fontFamily: FACES.sans.regular, backgroundColor: scheme === "dark" ? alpha(c.input, 0.3) : "transparent" }, style]}
      {...props}
    />
  );
}

/** A label over its control: 15 px medium, the hint beside it regular and muted. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <View className={cn("min-w-0 gap-2", className)}>
      <Text className="text-[15px] font-medium leading-[22px]">
        {label}
        {hint && <Text className="font-normal text-muted-foreground"> {hint}</Text>}
      </Text>
      {children}
    </View>
  );
}

/** Selectable chips as the check-in's Yes/No toggles: white when on, tapping the chosen one clears it. 44 px for touch. */
export function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [string, string, ...unknown[]])[];
  value: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  const multi = Array.isArray(value);
  const on = (v: string) => (multi ? value.includes(v) : value === v);
  const press = (v: string) => {
    haptic.select();
    onChange(multi ? (value.includes(v) ? value.filter((x) => x !== v) : [...value, v]) : value === v ? "" : v);
  };
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} className="w-full flex-row flex-wrap gap-2">
      {options.map(([v, l]) => (
        <Pressable
          key={v}
          accessibilityRole={multi ? "checkbox" : "radio"}
          accessibilityState={multi ? { checked: on(v) } : { selected: on(v) }}
          onPress={() => press(v)}
          className={cn("h-11 items-center justify-center rounded-full border px-4 active:scale-[0.96]", on(v) ? "border-foreground bg-foreground" : "border-border")}
        >
          <Text className={cn("text-[15px] font-medium leading-[22px]", on(v) ? "text-background" : "text-foreground")}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The red inline message of a form or a sheet's footer (the web's Alert). */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <View accessibilityRole="alert" className="rounded-lg bg-recovery-red/15 px-3 py-2">
      {typeof children === "string" ? <Text className="text-sm leading-5 text-recovery-red-text">{children}</Text> : children}
    </View>
  );
}
