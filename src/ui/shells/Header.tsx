import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient as NativeGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, type DerivedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "../cn";
import { alpha } from "../color";
import { Ground, groundColorAt } from "../Ground";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { DateSwitcher, type DateSwitcherProps } from "./DateSwitcher";

// The pieces every header shares (spec §4.3, §4.4): the ground fill, the 24 px fade, the three-slot row.

/** Detail header title, date pill label and tab-root title roles (spec §3.4): 12 px caps. */
export const HEADER_TITLE = "text-xs font-bold uppercase leading-5 tracking-[0.1em]";
/** A header row is 44 px tall. */
export const HEADER_ROW = 44;
/** The lower 24 px fade content scrolls into. */
export const HEADER_FADE = 24;

/** The height of the header's solid part: the status-bar inset plus `rows` px of rows. */
export function useHeaderHeight(rows = HEADER_ROW) {
  return useSafeAreaInsets().top + rows;
}

/**
 * The header frame: ground fill, safe area, a 24 px fade at the bottom (no blur: the reference app fades, it does not
 * frost). It is laid over the top of a screen (absolute); the web's is sticky and its 24 px fade is part of its height in
 * layout, so the screen's scroll content starts below `useHeaderHeight(rows) + HEADER_FADE` (<ScreenScroll> adds the fade). The web masks the fill with a CSS mask; here the fill is the ground painted at
 * the same screen position, and the fade a strip going from the ground's colour to transparent. `expanded` (a shared
 * value, px, 0 to `extra`) reveals the collapsing header's second row: a band of the ground `extra` px tall under the
 * row, faded in, with the 24 px fade moved down below it.
 *
 * Nothing here animates a layout property: the fill and the band have fixed heights, and only the band's opacity and
 * the fade's translateY change, on the UI thread. (Animating the fill's height left the grown part unpainted on the
 * phone: the content showed through the collapsed row, 2026-10-11.) The band and fade are native gradients.
 */
export function HeaderFrame({ children, rows = HEADER_ROW, expanded, extra = 0, onHeight }: { children: ReactNode; rows?: number; expanded?: DerivedValue<number>; /** The second row's height: how far `expanded` goes. */ extra?: number; /** Told the header's resting height (safe area plus its rows), so a screen can pad its content below it. */ onHeight?: (height: number) => void }) {
  const { c } = useTheme();
  const top = useSafeAreaInsets().top;
  const solid = top + rows;
  const edge = groundColorAt(c, solid);
  const low = groundColorAt(c, solid + extra);
  const band = useAnimatedStyle(() => ({ opacity: extra ? Math.min(1, (expanded?.value ?? 0) / extra) : 0 }));
  const fade = useAnimatedStyle(() => ({ transform: [{ translateY: expanded?.value ?? 0 }] }));
  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 top-0 z-20">
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: solid, overflow: "hidden" }}>
        <Ground />
      </View>
      {extra > 0 && (
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: solid, left: 0, right: 0, height: extra }, band]}>
          <NativeGradient colors={[edge, low]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      )}
      <Animated.View pointerEvents="none" style={[{ position: "absolute", top: solid, left: 0, right: 0, height: HEADER_FADE }, fade]}>
        <NativeGradient colors={[low, alpha(low, 0)]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View pointerEvents="box-none" style={{ paddingTop: top }} onLayout={onHeight && ((e) => onHeight(e.nativeEvent.layout.height))}>
        {children}
      </View>
    </View>
  );
}

/** A three-slot header row: left, centred title, right. */
export function HeaderRow({ left, center, right, className, tall }: { left?: ReactNode; center: ReactNode; right?: ReactNode; className?: string; tall?: boolean }) {
  return (
    <View className={cn("flex-row items-center gap-2 px-2", tall ? "min-h-11 items-start pb-1" : "h-11", className)}>
      <View className="min-w-0 flex-1 flex-row items-center justify-start">{left}</View>
      <View className="min-w-0 shrink items-center">{center}</View>
      <View className="min-w-0 flex-1 flex-row items-center justify-end">{right}</View>
    </View>
  );
}

/** Health, Journal and More (spec §4.3 "Other tab roots"): centred title, optional right slot (sync status), optional date pill under it. */
export function TitleHeader({ title, dateSwitcher, right }: { title: string; dateSwitcher?: DateSwitcherProps; right?: ReactNode }) {
  return (
    <HeaderFrame rows={HEADER_ROW + (dateSwitcher ? 40 : 0)}>
      <HeaderRow center={<Text accessibilityRole="header" className={cn(HEADER_TITLE, "px-2")} numberOfLines={1}>{title}</Text>} right={right} className="px-4" />
      {dateSwitcher && (
        <View className="items-center pt-1">
          <DateSwitcher {...dateSwitcher} />
        </View>
      )}
    </HeaderFrame>
  );
}
