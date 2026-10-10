// The web's Sonner toasts (pulse components/ui/sonner.tsx, `toast.success` / `toast.error` from "sonner"), once for the
// whole app. `toast.success(text)` works from anywhere (a sheet that has just closed); <ToastHost /> is mounted once in
// AppProviders. As Sonner with the web's config: popover fill and text, a 1 px border, a 16 px icon in the text colour
// (success and error alike: no rich colours), 13 px / 500 text, 16 px padding, the full width of a phone less its 16 px
// offset, at the foot, for 4 s. Sonner stacks several; one is shown at a time here and a new one replaces it.
import { useEffect, useSyncExternalStore } from "react";
import { View } from "react-native";
import Animated, { FadeInUp, FadeOutDown } from "react-native-reanimated";
import { CircleCheck, OctagonX } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "./haptics";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { useTheme } from "./theme";

type Kind = "success" | "error";
type Current = { id: number; kind: Kind; text: string } | null;

const SHOWN_MS = 4000;
let current: Current = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const show = (kind: Kind, text: string) => {
  current = { id: ++seq, kind, text };
  emit();
};

/** Sonner's `toast`: the success haptic or the error haptic goes with it. */
export const toast = {
  success: (text: string) => {
    haptic.success();
    show("success", text);
  },
  error: (text: string) => {
    haptic.error();
    show("error", text);
  },
};

export function ToastHost() {
  const t = useSyncExternalStore(subscribe, () => current);
  const { c } = useTheme();
  const bottom = useSafeAreaInsets().bottom + 16;
  // One message at a time: each replaces the last, and clears itself after 4 s.
  useEffect(() => {
    if (!t) return;
    const id = t.id;
    const timer = setTimeout(() => {
      if (current?.id === id) {
        current = null;
        emit();
      }
    }, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  return (
    <View pointerEvents="none" className="absolute inset-x-0 px-4" style={{ bottom }}>
      <Animated.View
        key={t.id}
        entering={FadeInUp.duration(300)}
        exiting={FadeOutDown.duration(150)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className="w-full flex-row items-center gap-1.5 self-center rounded-lg border border-border bg-popover p-4"
        style={{ backgroundColor: c.popover, boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)" }}
      >
        <Icon icon={t.kind === "success" ? CircleCheck : OctagonX} size={16} tone="popover-foreground" strokeWidth={2} />
        <Text className="shrink text-[13px] font-medium leading-[19.5px] text-popover-foreground">{t.text}</Text>
      </Animated.View>
    </View>
  );
}
