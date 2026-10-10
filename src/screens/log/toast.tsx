// The web's Sonner toasts ("Water saved to Google Health", "Deleted"): the app's Toaster (components/ui/sonner.tsx)
// has no counterpart in the kit, so this is one small one. `toast.success(text)` from anywhere; every mounted
// <ToastHost /> draws it (the Journal and the log sheets mount one, since a sheet covers the screen under it).
// Popover fill, 1 px border, 10 px corners, a 16 px icon and 13 px text, at the foot, for 4 s as Sonner's default.
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { CircleCheck, OctagonX } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

type ToastState = { id: number; kind: "success" | "error"; text: string } | null;

const DURATION_MS = 4000;
let current: ToastState = null;
let nextId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function show(kind: "success" | "error", text: string) {
  current = { id: ++nextId, kind, text };
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    for (const l of listeners) l();
  }, DURATION_MS);
  for (const l of listeners) l();
}

export const toast = { success: (text: string) => show("success", text), error: (text: string) => show("error", text) };

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Draws the current toast at the foot of its parent (position it with `bottom`; default clears the home indicator). */
export function ToastHost({ bottom }: { bottom?: number }) {
  const t = useSyncExternalStore(subscribe, () => current);
  const { c, scheme } = useTheme();
  const inset = useSafeAreaInsets().bottom;
  if (!t) return null;
  return (
    <View pointerEvents="none" className="absolute inset-x-0 px-4" style={{ bottom: bottom ?? inset + 16 }}>
      <Animated.View
        key={t.id}
        entering={FadeInDown.duration(200)}
        exiting={FadeOutDown.duration(150)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className="flex-row items-center gap-1.5 self-center rounded-lg border border-border bg-popover p-4"
        style={{ backgroundColor: c.popover, boxShadow: scheme === "dark" ? "0 4px 12px rgba(0, 0, 0, 0.35)" : "0 4px 12px rgba(0, 0, 0, 0.1)" }}
      >
        <Icon icon={t.kind === "success" ? CircleCheck : OctagonX} size={16} tone="popover-foreground" strokeWidth={2} />
        <Text className="shrink text-[13px] leading-5 text-popover-foreground">{t.text}</Text>
      </Animated.View>
    </View>
  );
}
