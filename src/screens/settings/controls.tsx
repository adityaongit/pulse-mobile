// The form and settings pieces Settings, onboarding and Behaviours share. The web draws them with its shadcn components
// (Input, Switch, Dialog, outline Button, Progress) and a few class strings; the kit has none of these, so they are
// built here from the same classes and tokens, never from a platform control.
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Modal, Pressable, TextInput, View, type TextInputProps } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, withTiming } from "react-native-reanimated";
import { Check, ChevronDown, type LucideIcon } from "lucide-react-native";
import { FACES } from "@/ui/fontClasses";
import { alpha } from "@/ui/color";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { usePanelStyle } from "@/ui/Panel";
import { ring as ringLayer } from "@/ui/shadow";
import { useTheme } from "@/ui/theme";
import { Press } from "@/ui/Press";
import { MenuPanel, useMenu } from "@/ui/Menu";
import type { Box } from "@/ui/menuPlace";
import { DURATION } from "@/ui/motion";
import { BAR_CORNERS } from "@/ui/radius";

/** Body copy under a heading (web: max-w-[65ch] text-[15px] leading-[22px] text-foreground-secondary). */
export const BODY = "text-[15px] leading-[22px] text-foreground-secondary";
/** One settings row: label left, value right, 52 px tall (web ROW, ROW_LABEL, ROW_VALUE). */
export const ROW = "min-h-13 flex-row items-center justify-between gap-3 py-2";
export const ROW_LABEL = "text-[15px] leading-[22px]";
export const ROW_VALUE = "shrink text-right text-[15px] leading-[22px] text-foreground-secondary tabular-nums";
export const HINT = "text-[13px] leading-[18px] text-muted-foreground";
const LABEL = "text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary";
const ERROR = "text-[13px] font-medium leading-[18px] text-recovery-red-text";

/** A hairline between rows (the web's `divide-y divide-border`) for rows of automatic height, where the border adds its 1 px. */
export const Divider = ({ className }: { className?: string }) => <View className={cn("h-px bg-border", className)} />;
/** The same rule as the top border of a row with a minimum height (ROW): the web's min-h includes the border, so the row stays 52 px. */
export const ROW_RULE = "border-t border-border";

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
export const ringStyle = (color: string | null) => (color ? { boxShadow: ringLayer(color, { width: 2 }) } : undefined);

/** A profile field's box (the web's FIELD: h-13 rounded-xl bg-field), for a text field or a button that opens a picker. */
export const FIELD_BOX = "h-13 rounded-xl bg-field";
/** The same box in the Edit profile sheet: 44 px. */
export const FIELD_BOX_COMPACT = "h-11 rounded-xl bg-field";

const FIELDS = {
  /** Profile fields (web FIELD): h-13 rounded-xl bg-field px-4 text-[17px]. */
  field: { box: FIELD_BOX, input: "px-4 text-[17px]" },
  /** The behaviour search (web: h-12 rounded-xl bg-foreground/[0.06] pl-11 text-base). */
  search: { box: "h-12 rounded-xl border border-input bg-fill-faint", input: "px-4 text-base" },
  /** The web's plain Input (shadcn: h-11 rounded-lg border border-input, dark:bg-input/30 px-2.5 text-base). */
  input: { box: "h-11 rounded-lg border border-input dark:bg-input/30", input: "px-2.5 text-base" },
  /** A number at the end of a settings row (Goals): the plain Input at 36 px, its digits right-aligned. */
  number: { box: "h-9 rounded-lg border border-input dark:bg-input/30", input: "px-2 text-right text-[15px] tabular-nums" },
  /** Profile fields in the Edit profile sheet: 44 px and 15 px type, nearer the web's sheet forms than onboarding's. */
  compact: { box: FIELD_BOX_COMPACT, input: "px-3.5 text-[15px]" },
} as const;
const BORDERED: readonly (keyof typeof FIELDS)[] = ["input", "number"];
/** A multiline field (Coach's About you): the variant's box, grown from four lines to fit, the text from the top left. The
 * input carries the padding, so its frame is the whole box: the keyboard brings the focused input into view
 * (useRevealFocused), and a tap anywhere in the box focuses it. */
const MULTILINE = { box: "h-auto min-h-28 items-stretch", input: "h-auto py-3" } as const;

/** A text field; the ring shows on focus (web: focus-visible:ring-2 ring-foreground/70) and when `invalid`. */
export function TextField({ invalid, left, right, variant = "field", ...props }: TextInputProps & { ref?: Ref<TextInput>; invalid?: boolean; left?: ReactNode; right?: ReactNode; variant?: keyof typeof FIELDS }) {
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  const v = FIELDS[variant];
  const ring = invalid ? c["recovery-red-text"] : focus ? c["focus-ring"] : null;
  // The caller's ref and our own, so a tap anywhere in the box (its padding, a unit beside the number) focuses the input,
  // as a web label does.
  const input = useRef<TextInput>(null);
  const { ref, ...rest } = props;
  useImperativeHandle(ref, () => input.current!, []);
  return (
    <Pressable accessible={false} onPress={() => input.current?.focus()} className={cn("w-full min-w-0 flex-row items-center", v.box, props.multiline && MULTILINE.box)} style={BORDERED.includes(variant) ? (ring ? { borderColor: ring, boxShadow: ringLayer(alpha(ring, 0.35), { width: 2, inset: false }) } : undefined) : ringStyle(ring)}>
      {left}
      <TextInput
        {...rest}
        ref={input}
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
        className={cn("h-full min-w-0 flex-1 text-foreground", v.input, props.multiline && MULTILINE.input)}
        style={[{ fontFamily: FACES.sans.regular, fontVariant: ["tabular-nums"], textAlignVertical: props.multiline ? "top" : "center" }, props.multiline ? null : { paddingVertical: 0 }, left ? { paddingLeft: 0 } : null, right ? { paddingRight: 0 } : null, props.style]}
      />
      {right}
    </Pressable>
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
          <Press
            activeScale={0.96}
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => {
              if (on) return;
              if (feedback === "toggle") haptic.toggle(true);
              else haptic.select();
              onChange(v);
            }}
            className={cn("h-11 flex-1 flex-row items-center justify-center gap-2 rounded-lg", on && "bg-foreground")}
          >
            {icon && <Icon icon={icon} size={16} tone={on ? "background" : "foreground-secondary"} strokeWidth={2} />}
            <Text className={cn("text-[15px] font-semibold", on ? "text-background" : "text-foreground-secondary")}>{text}</Text>
          </Press>
        );
      })}
    </View>
  );
}

export type SelectOption<T extends string> = { value: T; label: string; /** A second line in the dropdown ("lb, mi, ft, °F"). */ detail?: string; icon?: LucideIcon };

/** The choices of a dropdown, the chosen one ticked: open it under its trigger with `useMenu` (SelectRow, the goals). */
export function ChoiceMenu<T extends string>({ anchor, close, value, options, onChange }: { anchor: Box | null; close: () => void; value: T; options: readonly SelectOption<T>[]; onChange: (v: T) => void }) {
  return (
    <MenuPanel anchor={anchor} onClose={close} align="end" className="min-w-56">
      {options.map((o) => (
        <Press
          key={o.value}
          activeBg="bg-fill-pressed"
          accessibilityRole="menuitem"
          accessibilityState={{ selected: o.value === value }}
          onPress={() => {
            close();
            if (o.value === value) return;
            haptic.select();
            onChange(o.value);
          }}
          className="min-h-12 flex-row items-center gap-3 rounded-xl px-3 py-2"
        >
          {o.icon && <Icon icon={o.icon} size={18} tone="foreground-secondary" strokeWidth={1.75} />}
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-medium leading-5">{o.label}</Text>
            {!!o.detail && <Text className={HINT}>{o.detail}</Text>}
          </View>
          {o.value === value && <Icon icon={Check} size={16} tone="foreground" strokeWidth={2.25} />}
        </Press>
      ))}
    </MenuPanel>
  );
}

/**
 * A setting with a few choices, as a settings row: the label, the chosen value and a chevron. A tap opens the choices in
 * a dropdown under it (the kit's MenuPanel, as the Trend View's metric switch), the chosen one ticked.
 */
export function SelectRow<T extends string>({ label, value, options, onChange, rule }: { label: string; value: T; options: readonly SelectOption<T>[]; onChange: (v: T) => void; rule?: boolean }) {
  const { ref, anchor, open, close } = useMenu();
  const on = options.find((o) => o.value === value) ?? options[0];
  return (
    <View ref={ref} collapsable={false} className={cn(rule && ROW_RULE)}>
      <Press activeBg="bg-fill-pressed" accessibilityRole="button" accessibilityLabel={`${label}, ${on.label}`} accessibilityState={{ expanded: !!anchor }} onPress={() => (haptic.tap(), open())} className={cn(ROW, "-mx-2 rounded-lg px-2")}>
        <Text className={ROW_LABEL}>{label}</Text>
        <View className="shrink flex-row items-center gap-1.5">
          <Text className={ROW_VALUE}>{on.label}</Text>
          <Icon icon={ChevronDown} size={18} tone="muted-foreground" strokeWidth={2} />
        </View>
      </Press>
      <ChoiceMenu anchor={anchor} close={close} value={on.value} options={options} onChange={onChange} />
    </View>
  );
}

/** A small text button on the ground ("Edit", "Change", "Done"): the web's ghost / sm sizes, which the kit's Button lacks. */
export function SmallButton({ label, accessibilityLabel, onPress, icon, solid, className }: { label: string; accessibilityLabel?: string; onPress: () => void; icon?: LucideIcon; solid?: boolean; className?: string }) {
  return (
    <Press
      activeScale={0.96}
      activeBg={solid ? undefined : "bg-fill-faint"}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      hitSlop={{ top: 4, bottom: 4 }}
      className={cn("h-9 flex-row items-center justify-center gap-1.5 rounded-full px-3", solid && "bg-primary px-5", className)}
    >
      {icon && <Icon icon={icon} size={14} tone={solid ? "primary-foreground" : "foreground-secondary"} strokeWidth={2} />}
      <Text className={cn("text-[13px] font-semibold", solid ? "text-primary-foreground" : "text-foreground-secondary")}>{label}</Text>
    </Press>
  );
}

/**
 * A native-style switch (42 × 26 track, 22 px white thumb with a soft shadow), as WHOOP draws theirs, a size down from the platform's:
 * the web's 32 × 18 shadcn switch read as a toy on a phone (owner's call). On, the track is the optimal green.
 */
export function Switch({ value, onValueChange, disabled, label }: { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  const { c } = useTheme();
  const on = useDerivedValue(() => withTiming(value ? 1 : 0, { duration: DURATION.fast }), [value]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.value, [0, 1], [c.input, c.optimal]) }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: on.value * 16 }] }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={() => {
        haptic.toggle(!value);
        onValueChange(!value);
      }}
      className={cn(disabled && "opacity-disabled")}
    >
      <Animated.View style={[{ width: 42, height: 26, borderRadius: 13, padding: 2, justifyContent: "center" }, track]}>
        <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#ffffff", boxShadow: "0 1px 3px rgba(0, 0, 0, 0.25)" }, thumb]} />
      </Animated.View>
    </Pressable>
  );
}

/** The web's Progress (h-1.5 on bg-muted, the fill bg-primary). */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }} className={cn("h-1.5 w-full overflow-hidden bg-muted", BAR_CORNERS)}>
      <View className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
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
  const panel = usePanelStyle({ ring: "border", shadow: null });
  useEffect(() => {
    if (open && confirmVariant === "outline") haptic.warning();
  }, [open, confirmVariant]);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => !pending && onCancel()} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityLabel="Close" accessible={false} onPress={() => !pending && onCancel()} className="flex-1 items-center justify-center bg-dim-strong px-4">
        <Pressable accessible={false} onPress={() => {}} className="w-full max-w-sm overflow-hidden rounded-xl bg-popover" style={panel}>
          <View className="gap-4 p-4">
            <View className="gap-2">
              <Text accessibilityRole="header" className="text-base font-medium leading-[16px]">
                {title}
              </Text>
              <Text className="text-sm leading-5 text-muted-foreground">{description}</Text>
            </View>
            {!!error && (
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
