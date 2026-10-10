import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { cn } from "./cn";
import { haptic } from "./haptics";
import { Text } from "./Text";

// shadcn's Button in Pulse's touch sizes (web: components/ui/button.tsx). Only the variants the kit uses.
type Variant = "default" | "secondary" | "ghost" | "outline-pill";
type Size = "touch" | "icon-touch" | "sheet";

const VARIANT: Record<Variant, { box: string; text: string }> = {
  default: { box: "bg-primary", text: "text-primary-foreground" },
  secondary: { box: "bg-secondary", text: "text-secondary-foreground" },
  ghost: { box: "bg-transparent", text: "text-foreground" },
  // The second action in sheets and the info card ("Delete", "Open trend view"): an outline, ring-1 ring-foreground/70.
  "outline-pill": { box: "rounded-full border border-foreground/70 bg-transparent", text: "text-foreground" },
};
const SIZE: Record<Size, { box: string; text: string }> = {
  touch: { box: "h-11 gap-2 rounded-xl px-4", text: "text-[13px] font-bold uppercase tracking-[0.1em]" },
  "icon-touch": { box: "size-11 rounded-full", text: "" },
  sheet: { box: "h-14 w-full gap-2 rounded-full px-6", text: "text-[15px] font-bold uppercase tracking-[0.1em]" },
};

export type ButtonProps = {
  variant?: Variant;
  size?: Size;
  onPress?: () => void;
  disabled?: boolean;
  /** A string becomes the label in the variant's text style; anything else (an icon) is drawn as is. */
  children: ReactNode;
  className?: string;
  accessibilityLabel?: string;
  /** The tap haptic. On by default for actions (the primary variant and sheet buttons); pass false for a button that only navigates. */
  haptic?: boolean;
};

export function Button({ variant = "default", size = "touch", onPress, disabled, children, className, accessibilityLabel, haptic: feel = variant === "default" || size === "sheet" }: ButtonProps) {
  const v = VARIANT[variant];
  const s = SIZE[size];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        if (feel) haptic.tap();
        onPress?.();
      }}
      className={cn("flex-row items-center justify-center active:scale-[0.96]", s.box, v.box, disabled && "opacity-50", className)}
    >
      {typeof children === "string" ? <Text className={cn(s.text, v.text)}>{children}</Text> : children}
    </Pressable>
  );
}
