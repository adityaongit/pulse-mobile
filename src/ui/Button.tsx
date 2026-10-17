import type { ReactNode } from "react";
import { View } from "react-native";
import { cn } from "./cn";
import { haptic } from "./haptics";
import { Text } from "./Text";
import { ring } from "./shadow";
import { useTheme } from "./theme";
import { Press } from "./Press";

// shadcn's Button in Pulse's touch sizes (web: components/ui/button.tsx). Only the variants the kit uses.
type Variant = "default" | "outline" | "secondary" | "ghost" | "outline-pill";
type Size = "touch" | "icon-touch";

// Every web button is `border border-transparent bg-clip-padding`: a 1 px border in the box, the fill inside it. React
// Native paints a background under the border, so the fill is its own view, which an absolute child places inside
// the border (the padding box), with the radius 1 px smaller, as the browser clips it.
const VARIANT: Record<Variant, { box?: string; fill?: string; text: string }> = {
  default: { fill: "bg-primary", text: "text-primary-foreground" },
  // The web's `outline`: border-border bg-background; dark: border-input bg-input/30 (what the Disconnect and Delete confirms use).
  outline: { box: "border-border dark:border-input", fill: "bg-background dark:bg-input/30", text: "text-foreground" },
  secondary: { fill: "bg-secondary", text: "text-secondary-foreground" },
  ghost: { text: "text-foreground" },
  // The second action ("Delete", "Open trend view"): ring-1 ring-foreground/70, outside the box (a shadow below); the
  // size gives the radius.
  "outline-pill": { text: "text-foreground" },
};
const SIZE: Record<Size, { box: string; fill: string; text: string }> = {
  touch: { box: "h-11 gap-2 rounded-xl px-4", fill: "rounded-[11px]", text: "text-[13px] font-bold uppercase tracking-[0.1em]" },
  "icon-touch": { box: "size-11 rounded-full", fill: "rounded-full", text: "" },
};

export type ButtonProps = {
  variant?: Variant;
  size?: Size;
  onPress?: () => void;
  disabled?: boolean;
  /** A string becomes the label in the variant's text style; anything else (an icon) is drawn as is. */
  children: ReactNode;
  className?: string;
  /** The web colours a button's label with a `text-*` class on the button; a phone's text does not inherit, so it goes here ("text-recovery-red-text"). */
  textClassName?: string;
  accessibilityLabel?: string;
  /** The tap haptic. On by default for actions (the primary variant); pass false for a button that only navigates. */
  haptic?: boolean;
};

export function Button({ variant = "default", size = "touch", onPress, disabled, children, className, textClassName, accessibilityLabel, haptic: feel = variant === "default" }: ButtonProps) {
  const { c } = useTheme();
  const v = VARIANT[variant];
  const s = SIZE[size];
  return (
    <Press
      activeScale={0.96}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        if (feel) haptic.tap();
        onPress?.();
      }}
      className={cn("flex-row items-center justify-center border border-transparent", s.box, v.box, disabled && "opacity-disabled", className)}
      style={variant === "outline-pill" ? { boxShadow: ring(c["focus-ring"], { inset: false }) } : undefined}
    >
      {!!v.fill && <View pointerEvents="none" className={cn("absolute inset-0", s.fill, v.fill)} />}
      {typeof children === "string" ? <Text className={cn(s.text, v.text, textClassName)}>{children}</Text> : children}
    </Press>
  );
}
