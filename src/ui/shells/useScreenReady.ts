import { useIsFocused, useNavigation, useRoute, type NativeStackNavigationProp } from "expo-router";
import { startTransition, useEffect, useLayoutEffect, useState } from "react";
import { Platform } from "react-native";

type StackNavigation = NativeStackNavigationProp<Record<string, object | undefined>>;

export function useScreenReady() {
  const own = useNavigation();
  // A tab's screen moves with the tab navigator's screen in the stack around it: its transitions are that screen's (Home
  // is settled once the slide back from a detail screen ends).
  const navigation = (own.getState()?.type === "tab" ? (own.getParent() ?? own) : own) as StackNavigation;
  const route = useRoute();
  const focused = useIsFocused();
  const state = navigation.getState();
  const defer = Platform.OS === "android" && state.type === "stack";
  const [settled, setSettled] = useState(() => !defer || state.index === 0);

  useLayoutEffect(() => {
    if (!defer) return;
    let frame: number | undefined;
    let started: number | undefined;
    let previous = 0;
    let gaps = 0;
    let maxGap = 0;
    const stop = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    };
    const probe = (now: number) => {
      const gap = now - previous;
      if (gap > 32) gaps += 1;
      maxGap = Math.max(maxGap, gap);
      previous = now;
      frame = requestAnimationFrame(probe);
    };
    // A screen a deep link opens gets no transition events at all: settle it when none has started by then.
    let transitioned = false;
    const fallback = setTimeout(() => !transitioned && setSettled(true), 500);
    const start = navigation.addListener("transitionStart", ({ data }) => {
      transitioned = true;
      setSettled(false);
      if (__DEV__) {
        stop();
        started = performance.now();
        previous = started;
        gaps = 0;
        maxGap = 0;
        frame = requestAnimationFrame(probe);
        console.info(`[screen] ${route.name} transition-start closing=${data.closing}`);
      }
    });
    const end = navigation.addListener("transitionEnd", ({ data }) => {
      stop();
      if (__DEV__ && started !== undefined) {
        const now = performance.now();
        const gap = now - previous;
        if (gap > 32) gaps += 1;
        maxGap = Math.max(maxGap, gap);
        console.info(`[screen] ${route.name} transition-end closing=${data.closing} ms=${Math.round(now - started)} js-gaps=${gaps} js-max-gap-ms=${Math.round(maxGap)}`);
        started = undefined;
      }
      if (!data.closing) setSettled(true);
    });
    const cancel = navigation.addListener("gestureCancel", () => {
      stop();
      setSettled(true);
    });
    const blur = navigation.addListener("blur", () => {
      stop();
      setSettled(false);
    });
    return () => {
      clearTimeout(fallback);
      stop();
      start();
      end();
      cancel();
      blur();
    };
  }, [defer, navigation, route.name]);

  return focused && (!defer || settled);
}

/**
 * Whether a shell renders its page body. A screen that mounts in view renders it at once. One that mounts out of view
 * (a preloaded route or tab) renders its header first and the body in a transition: React renders it in slices and
 * lets a tap or a scroll in between, where a plain render would hold the JS thread for the whole page.
 */
export function useBodyShown() {
  const focused = useIsFocused();
  const [shown, setShown] = useState(focused);
  if (focused && !shown) setShown(true);
  useEffect(() => {
    if (!shown) startTransition(() => setShown(true));
  }, [shown]);
  return shown;
}
