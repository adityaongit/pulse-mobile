// The form and settings pieces Settings, onboarding and Behaviours share. The web draws them with its shadcn components
// (Input, Switch, Dialog, outline Button, Progress) and a few class strings; the kit has none of these, so they are
// built here from the same classes and tokens, never from a platform control.
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { Modal, Pressable, TextInput, View, type TextInputProps } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import type { LucideIcon } from "lucide-react-native";
import { FACES } from "@/ui/fontClasses";
import { alpha } from "@/ui/color";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

/** Body copy under a heading (web: max-w-[65ch] text-[15px] leading-[22px] text-foreground-secondary). */
export const BODY = "text-[15px] leading-[22px] text-foreground-secondary";
/** One settings row: label left, value right, 52 px tall (web ROW, ROW_LABEL, ROW_VALUE). */
export const ROW = "min-h-13 flex-row items-center justify-between gap-3 py-2";
export const ROW_LABEL = "text-[15px] leading-[22px]";
export const ROW_VALUE = "shrink text-right text-[15px] leading-[22px] text-foreground-secondary tabular-nums";
export const HINT = "text-[13px] leading-[18px] text-muted-foreground";
const LABEL = "text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary";
const ERROR = "text-[13px] font-medium leading-[18px] text-recovery-red-text";

/** A hairline between rows (the web's `divide-y divide-border`). */
export const Divider = ({ className }: { className?: string }) => <View className={cn("h-px bg-border", className)} />;

/** A form field: caps label (with "Optional"), the control, then its error or its hint (web ProfileForm `Field`). */
export function Field({ label, hint, error, optional, children }: { label: string; hint: string; error?: string; optional?: boolean; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className={LABEL}>
        {label}
        {optional && <Text className="ml-2 text-[15px] font-medium normal-case tracking-normal text-muted-foreground">{"  "}Optional</Text>}
      </Text>
      {children}
      {error ? (
        <Text accessibilityLiveRegion="polite" className={ERROR}>
          {error}
        </Text>
      ) : (
        <Text className={HINT}>{hint}</Text>
      )}
    </View>
  );
}

/** The inset ring the web draws with `ring-2` on focus or on an invalid field. */
export const ringStyle = (color: string | null) => (color ? { boxShadow: `inset 0 0 0 2px ${color}` } : undefined);

const FIELDS = {
  /** Profile fields (web FIELD): h-13 rounded-xl bg-field px-4 text-[17px]. */
  field: { box: "h-13 rounded-xl bg-field", input: "px-4 text-[17px]" },
  /** The behaviour search (web: h-12 rounded-xl bg-foreground/[0.06] pl-11 text-base). */
  search: { box: "h-12 rounded-xl bg-foreground/[0.06]", input: "px-4 text-base" },
  /** The web's plain Input (shadcn: h-11 rounded-lg border border-input, dark:bg-input/30 px-2.5 text-base). */
  input: { box: "h-11 rounded-lg border border-input dark:bg-input/30", input: "px-2.5 text-base" },
} as const;

/** A text field; the ring shows on focus (web: focus-visible:ring-2 ring-foreground/70) and when `invalid`. */
export function TextField({ invalid, left, right, variant = "field", ...props }: TextInputProps & { ref?: Ref<TextInput>; invalid?: boolean; left?: ReactNode; right?: ReactNode; variant?: keyof typeof FIELDS }) {
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  const v = FIELDS[variant];
  const ring = invalid ? c["recovery-red-text"] : focus ? alpha(c.foreground, 0.7) : null;
  return (
    <View className={cn("w-full min-w-0 flex-row items-center", v.box)} style={variant === "input" ? (ring ? { borderColor: ring, boxShadow: `0 0 0 2px ${alpha(ring, 0.35)}` } : undefined) : ringStyle(ring)}>
      {left}
      <TextInput
        {...props}
        onFocus={(e) => {
          setFocus(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          props.onBlur?.(e);
        }}
        placeholderTextColor={c["muted-foreground"]}
        selectionColor={c.foreground}
        autoCorrect={false}
        className={cn("h-full min-w-0 flex-1 text-foreground", v.input)}
        style={[{ fontFamily: FACES.sans.regular, fontVariant: ["tabular-nums"], paddingVertical: 0, textAlignVertical: "center" }, left ? { paddingLeft: 0 } : null, right ? { paddingRight: 0 } : null, props.style]}
      />
      {right}
    </View>
  );
}

/**
 * Choices as a segmented control (web: a radio group, `grid gap-1 rounded-[14px] bg-field p-1`): the chosen one is the
 * foreground colour with background text. Used for sex (two) and the theme (three, with icons).
 */
export function RadioSegments<T extends string>({ value, options, onChange, label, feedback = "select" }: { value: T | null; options: readonly { value: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void; label: string; /** The theme choice is a "toggle" tick, other choices a "select" tick. */ feedback?: "select" | "toggle" }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} className="flex-row gap-1 rounded-[14px] bg-field p-1">
      {options.map(({ value: v, label: text, icon }) => {
        const on = v === value;
        return (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => {
              if (on) return;
              if (feedback === "toggle") haptic.toggle(true);
              else haptic.select();
              onChange(v);
            }}
            className={cn("h-11 flex-1 flex-row items-center justify-center gap-2 rounded-[10px] active:scale-[0.96]", on && "bg-foreground")}
          >
            {icon && <Icon icon={icon} size={16} tone={on ? "background" : "foreground-secondary"} strokeWidth={2} />}
            <Text className={cn("text-[15px] font-semibold", on ? "text-background" : "text-foreground-secondary")}>{text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small text button on the ground ("Edit", "Change", "Done"): the web's ghost / sm sizes, which the kit's Button lacks. */
export function SmallButton({ label, accessibilityLabel, onPress, icon, solid, className }: { label: string; accessibilityLabel?: string; onPress: () => void; icon?: LucideIcon; solid?: boolean; className?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      hitSlop={{ top: 4, bottom: 4 }}
      className={cn("h-9 flex-row items-center justify-center gap-1.5 rounded-full px-3 active:scale-[0.96]", solid ? "bg-primary px-5" : "active:bg-foreground/[0.06]", className)}
    >
      {icon && <Icon icon={icon} size={14} tone={solid ? "primary-foreground" : "foreground-secondary"} strokeWidth={2} />}
      <Text className={cn("text-[13px] font-semibold", solid ? "text-primary-foreground" : "text-foreground-secondary")}>{label}</Text>
    </Pressable>
  );
}

/** The web's Switch (default size: 32 × 18.4 track, 16 px thumb), with a larger touch area. */
export function Switch({ value, onValueChange, disabled, label }: { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: withTiming(value ? 14 : 0, { duration: 150 }) }] }), [value]);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      onPress={() => {
        haptic.toggle(!value);
        onValueChange(!value);
      }}
      className={cn("h-[18.4px] w-8 justify-center rounded-full border border-transparent px-px", value ? "bg-primary" : "bg-input dark:bg-input/80", disabled && "opacity-50")}
    >
      <Animated.View className={cn("size-4 rounded-full", value ? "bg-background dark:bg-primary-foreground" : "bg-background dark:bg-foreground")} style={thumb} />
    </Pressable>
  );
}

/** The web's Progress (h-1.5 on bg-muted, the fill bg-primary). */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <View className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </View>
  );
}

/**
 * The web's Dialog as a confirmation: a centred popover card over the strong dim, a body, then the two actions in a
 * muted footer (the main action on top, Cancel under it, as the web stacks them on a phone). A native <Modal> with a
 * fade, so the OS back gesture cancels it.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  error,
  confirmLabel,
  pendingLabel,
  pending,
  onCancel,
  onConfirm,
  confirmVariant = "outline",
}: {
  open: boolean;
  title: string;
  description: string;
  error?: string | null;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** "outline" (red text, the web's Disconnect and Delete) or "primary" (Choose account). */
  confirmVariant?: "outline" | "primary";
}) {
  const { c } = useTheme();
  useEffect(() => {
    if (open && confirmVariant === "outline") haptic.warning();
  }, [open, confirmVariant]);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => !pending && onCancel()} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityLabel="Close" accessible={false} onPress={() => !pending && onCancel()} className="flex-1 items-center justify-center bg-dim-strong px-4">
        <Pressable accessible={false} onPress={() => {}} className="w-full max-w-sm overflow-hidden rounded-xl bg-popover" style={{ boxShadow: `inset 0 0 0 1px ${c.border}`, backgroundColor: c.popover }}>
          <View className="gap-4 p-4">
            <View className="gap-2">
              <Text accessibilityRole="header" className="text-base font-medium leading-[16px]">
                {title}
              </Text>
              <Text className="text-sm leading-5 text-muted-foreground">{description}</Text>
            </View>
            {error && (
              <Text accessibilityRole="alert" className="text-xs font-medium leading-4 text-recovery-red-text">
                {error}
              </Text>
            )}
          </View>
          <View className="flex-col-reverse gap-2 border-t border-border bg-muted/50 p-4">
            <Button variant="secondary" onPress={onCancel} disabled={pending}>
              Cancel
            </Button>
            {confirmVariant === "primary" ? (
              <Button onPress={onConfirm} disabled={pending}>
                {pending ? pendingLabel : confirmLabel}
              </Button>
            ) : (
              <Button variant="outline" haptic textClassName="text-recovery-red-text" onPress={onConfirm} disabled={pending}>
                {pending ? pendingLabel : confirmLabel}
              </Button>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
