import { Easing } from "react-native";
import { useTranslation } from "react-i18next";
import { Tabs } from "expo-router";
import { TabBar } from "@/ui/shells/TabBar";
import { useTheme } from "@/ui/theme";

// The bottom tabs: Home, Health, Journal, More, in the web app's order. The bar is Pulse's own floating glass bar with
// the round check-in action (src/ui/shells/TabBar.tsx), the same on iOS and Android; Expo Router's <Tabs> supplies the
// navigation state and keeps each tab's screen alive.
export default function TabsLayout() {
  const { c } = useTheme();
  const { t } = useTranslation("ui");
  // `sceneStyle`: the ground behind a tab while it switches, not the navigation theme's default. `shift`: the tabs
  // cross-fade and move 50 px toward the tapped side (native driver), over the spec's base duration and standard ease.
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.background },
        animation: "shift",
        transitionSpec: { animation: "timing", config: { duration: 200, easing: Easing.bezier(0.2, 0, 0, 1) } },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.home") }} />
      <Tabs.Screen name="health" options={{ title: t("tabs.health") }} />
      <Tabs.Screen name="journal" options={{ title: t("tabs.journal") }} />
      <Tabs.Screen name="more" options={{ title: t("tabs.more") }} />
    </Tabs>
  );
}
