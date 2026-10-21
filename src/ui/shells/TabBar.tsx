import { useTranslation } from "react-i18next";
import { useEffect, useState, type ComponentProps } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { Tabs } from "expo-router";
import { HeartPulse, Menu, NotebookPen, type LucideIcon } from "lucide-react-native";
import { alpha } from "../color";
import { Glass } from "../Glass";
import { haptic } from "../haptics";
import { Gradient } from "../Gradient";
import { HomeChart } from "../icons";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { CheckInAction } from "./CheckInAction";
import { TAB_BAR_HEIGHT, useTabBarBottom } from "./layout";
import { Press } from "../Press";
import { DURATION } from "../motion";
import { GLASS_RADIUS } from "../radius";

/** The lens and each tab sit 4 px inside the bar (rounded-[18px] on the tabs, which a class must spell out). */
const LENS_RADIUS = GLASS_RADIUS - 4;

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

// The web app's tabs, in its order (src/lib/url.ts TAB_ROOT): Home, Health, Journal, More. The route file of each is
// app/(tabs)/<route>.tsx.
export const TABS: { route: string; labelKey: "tabs.home" | "tabs.health" | "tabs.journal" | "tabs.more"; icon: LucideIcon }[] = [
  { route: "index", labelKey: "tabs.home", icon: HomeChart },
  { route: "health", labelKey: "tabs.health", icon: HeartPulse },
  { route: "journal", labelKey: "tabs.journal", icon: NotebookPen },
  { route: "more", labelKey: "tabs.more", icon: Menu },
];

/**
 * The active item's lens: one element that slides between items (150 ms), a soft pool of light that is brightest at the
 * item's lower edge, as sampled under the reference app's active tab.
 */
function Lens({ index, itemWidth }: { index: number; itemWidth: number }) {
  const { c } = useTheme();
  const x = useSharedValue(index * itemWidth);
  useEffect(() => {
    x.value = withTiming(index * itemWidth, { duration: DURATION.fast });
  }, [index, itemWidth, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], opacity: index < 0 ? 0 : 1 }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 4, top: 4, bottom: 4, width: itemWidth, borderRadius: LENS_RADIUS, overflow: "hidden" }, style]}>
      <Gradient from={alpha(c.foreground, 0.02)} to={alpha(c.foreground, 0.16)} angle="y" />
    </Animated.View>
  );
}

/** Phone tab bar: a 62 px glass squircle with four destinations (spec §4.2, G1), for expo-router's <Tabs tabBar>. */
function Bar({ state, navigation, current: shown }: TabBarProps & { current: number }) {
  const { t } = useTranslation("ui");
  const [width, setWidth] = useState(0);
  // The tapped tab lights up (lens, icon, label) in its own small render; the tab's screen renders a frame later. One
  // render for both would hold the feedback until the whole screen had rendered.
  const [tapped, setTapped] = useState<number | null>(null);
  if (tapped !== null && tapped === shown) setTapped(null);
  const current = tapped ?? shown;
  const itemWidth = Math.max(0, (width - 8) / TABS.length);
  return (
    <Glass radius={GLASS_RADIUS} accessibilityRole="tablist" accessibilityLabel={t("tabs.primary")} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: TAB_BAR_HEIGHT, flex: 1, minWidth: 0, padding: 4 }}>
      {width > 0 && <Lens index={current} itemWidth={itemWidth} />}
      <View className="h-full flex-row">
        {TABS.map(({ route, labelKey, icon }, i) => {
          const label = t(labelKey);
          const route_ = state.routes.find((r) => r.name === route);
          const on = i === current;
          return (
            <Press
              activeScale={0.96}
              key={route}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              onPress={() => {
                if (!route_) return;
                const event = navigation.emit({ type: "tabPress", target: route_.key, canPreventDefault: true });
                if (!on && !event.defaultPrevented) {
                  haptic.select();
                  setTapped(i);
                  requestAnimationFrame(() => navigation.navigate(route_.name));
                }
              }}
              className="h-full min-w-0 flex-1 items-center justify-center gap-0.5 rounded-[18px]"
            >
              <Icon icon={icon} size={26} tone={on ? "foreground" : "muted-foreground"} strokeWidth={1.6} />
              <Text className={on ? "text-[11px] font-semibold leading-[13px] text-foreground" : "text-[11px] font-semibold leading-[13px] text-muted-foreground"}>{label}</Text>
            </Press>
          );
        })}
      </View>
    </Glass>
  );
}

/**
 * The tab bar and the round action, floating over the content at the bottom of the screen (tab roots), exactly as the
 * web's (spec §4.2). Their glass blurs the screen in view on iOS; Android draws the glass fill opaque (Glass).
 */
export function TabBar(props: TabBarProps) {
  const bottom = useTabBarBottom();
  const route = props.state.routes[props.state.index];
  const current = TABS.findIndex((t) => t.route === route?.name);
  return (
    <View pointerEvents="box-none" className="absolute inset-x-3 flex-row justify-end gap-2" style={{ bottom }}>
      <Bar {...props} current={current} />
      <CheckInAction />
    </View>
  );
}
