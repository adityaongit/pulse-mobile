import { Tabs } from "expo-router";
import { TabBar } from "@/ui/shells/TabBar";
import { useTheme } from "@/ui/theme";

// The bottom tabs: Home, Health, Journal, More, in the web app's order. The bar is Pulse's own floating glass bar with
// the round check-in action (src/ui/shells/TabBar.tsx), the same on iOS and Android; Expo Router's <Tabs> supplies the
// navigation state and keeps each tab's screen alive.
export default function TabsLayout() {
  const { c } = useTheme();
  // `sceneStyle`: the ground behind a tab while it switches, not the navigation theme's default.
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.background } }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="health" options={{ title: "Health" }} />
      <Tabs.Screen name="journal" options={{ title: "Journal" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
