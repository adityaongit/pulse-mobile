import { useSyncExternalStore, type RefObject } from "react";
import type { View } from "react-native";

// Android blurs only what is inside a `BlurTargetView` (expo-blur). The tab bar floats outside every screen, so the
// screen in view (ScreenScroll, on focus) hands its target here and the bar's glass blurs that. iOS needs no target.
let current: RefObject<View | null> | null = null;
const listeners = new Set<() => void>();

export function setFocusedBlurTarget(target: RefObject<View | null> | null) {
  current = target;
  for (const l of listeners) l();
}

export function useFocusedBlurTarget() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
