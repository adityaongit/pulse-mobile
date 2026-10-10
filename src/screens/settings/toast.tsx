// The web shows one-line results in a sonner toast ("Profile saved. Scores are being recomputed.", "Behaviours saved").
// The kit has none, so this is the same card: a popover pill with an icon over the foot of the screen, gone after 4 s.
// `toast.success(...)` works from anywhere (a sheet that has just closed); a screen that shows toasts renders <ToastHost />.
import { useEffect, useSyncExternalStore } from "react";
import { View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { CircleCheck, OctagonX } from "lucide-react-native";
import { Icon } from "@/ui/Icon";
import { haptic } from "@/ui/haptics";
import { TAB_BAR_HEIGHT, useTabBarBottom } from "@/ui/shells/layout";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

type Toast = { id: number; kind: "success" | "error"; text: string };

const SHOWN_MS = 4000;
let current: Toast | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const show = (kind: Toast["kind"], text: string) => {
  current = { id: ++seq, kind, text };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

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
  const { c, scheme } = useTheme();
  // One message at a time: each replaces the last and clears itself.
  useEffect(() => {
    if (!t) return;
    const id = t.id;
    const timer = setTimeout(() => {
      if (current?.id === id) {
        current = null;
        for (const l of listeners) l();
      }
    }, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [t]);
  const bottom = TAB_BAR_HEIGHT + useTabBarBottom() + 12;
  if (!t) return null;
  return (
    <View pointerEvents="none" className="absolute inset-x-0 items-center px-4" style={{ bottom }}>
      <Animated.View
        key={t.id}
        entering={FadeInDown.duration(200)}
        exiting={FadeOut.duration(150)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className="max-w-[420px] flex-row items-center gap-2 rounded-xl bg-popover px-4 py-3"
        style={{ boxShadow: `inset 0 0 0 1px ${c.border}, ${scheme === "dark" ? "0 8px 24px rgba(0, 0, 0, 0.45)" : "0 8px 24px rgba(16, 21, 24, 0.14)"}`, backgroundColor: c.popover }}
      >
        <Icon icon={t.kind === "success" ? CircleCheck : OctagonX} size={16} tone={t.kind === "success" ? "popover-foreground" : "recovery-red-text"} />
        <Text className="shrink text-[13px] font-medium leading-[18px] text-popover-foreground">{t.text}</Text>
      </Animated.View>
    </View>
  );
}
