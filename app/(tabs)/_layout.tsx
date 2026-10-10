import { DynamicColorIOS, Platform } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { alpha } from "@/ui/color";
import { PALETTES } from "@/ui/palette";
import { useTheme } from "@/ui/theme";

// iOS 26 draws the tab bar as Liquid Glass and tints it for whatever is behind it, so its colours must resolve against
// the system's light/dark (DynamicColorIOS), not our JavaScript theme. Android's Material bar takes plain colours.
function tone(token: "foreground" | "muted-foreground", scheme: "light" | "dark") {
  const light = PALETTES.light[token];
  const dark = PALETTES.dark[token];
  return Platform.OS === "ios" ? DynamicColorIOS({ light, dark }) : scheme === "dark" ? dark : light;
}

/**
 * The tab bar: Home, Health, Journal, More, in the web app's order, drawn by the platform (Expo Router's native tabs:
 * UITabBarController with Liquid Glass on iOS 26, a Material 3 navigation bar on Android). The route files are
 * app/(tabs)/<name>.tsx; a tab missing from here is not in the bar. The icons are the nearest system ones to the web's
 * (SF Symbols on iOS, Material Symbols on Android); each screen sets its own ground behind the bar.
 */
export default function TabsLayout() {
  const { c, scheme } = useTheme();
  const active = tone("foreground", scheme);
  const inactive = tone("muted-foreground", scheme);
  const content = { backgroundColor: c.background };
  const label = { fontFamily: "Figtree_600SemiBold", fontSize: 11 };
  return (
    <NativeTabs
      tintColor={active}
      iconColor={{ default: inactive, selected: active }}
      labelStyle={{ default: { ...label, color: inactive }, selected: { ...label, color: active } }}
      // The next four reach iOS 18 and earlier and Android; iOS 26 derives its glass from the content behind it.
      backgroundColor={Platform.OS === "android" ? c.card : undefined}
      blurEffect="systemChromeMaterial"
      indicatorColor={alpha(c.foreground, 0.12)}
      rippleColor={alpha(c.foreground, 0.12)}
    >
      <NativeTabs.Trigger name="index" contentStyle={content}>
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="health" contentStyle={content}>
        <NativeTabs.Trigger.Label>Health</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="waveform.path.ecg" md="monitor_heart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="journal" contentStyle={content}>
        <NativeTabs.Trigger.Label>Journal</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "book", selected: "book.fill" }} md="edit_note" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more" contentStyle={content}>
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="line.3.horizontal" md="menu" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
