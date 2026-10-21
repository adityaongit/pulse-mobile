import "../global.css";

import { useEffect, useMemo } from "react";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { colorScheme } from "nativewind";
import { Platform, Text, View } from "react-native";
import { enableFreeze } from "react-native-screens";
import { Barlow_500Medium } from "@expo-google-fonts/barlow/500Medium";
import { Barlow_600SemiBold } from "@expo-google-fonts/barlow/600SemiBold";
import { Barlow_700Bold } from "@expo-google-fonts/barlow/700Bold";
import { Figtree_400Regular } from "@expo-google-fonts/figtree/400Regular";
import { Figtree_500Medium } from "@expo-google-fonts/figtree/500Medium";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";
import { Figtree_700Bold } from "@expo-google-fonts/figtree/700Bold";

import { i18n } from "@/i18n/config";
import { useLanguage } from "@/i18n/useLanguage";
import { useNotificationDeepLinks, useTabLinks } from "@/background/links";
import { Opening } from "@/screens/Opening";
import { ScreenError } from "@/screens/ScreenError";
import { ShellData } from "@/screens/ShellData";
import { boot, useApp } from "@/state/app";
import { AppProviders } from "@/ui/providers";
import { useTheme } from "@/ui/theme";

// Screens out of view (under a pushed screen, or an inactive tab) stop rendering until they are shown again.
enableFreeze(true);

// Keep the splash screen up until the fonts and the database are ready, so no screen paints in the wrong font. It then
// goes without a fade: the opening (src/screens/Opening.tsx) is the same picture underneath and does the motion.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 0, fade: false });

// A cold start through a deep link (the launcher shortcuts, plugins/withAppShortcuts.js) puts the tabs under the linked
// screen, so back goes Home. Before onboarding the tabs are guarded off and the stack falls back to onboarding.
// A screen that throws while it draws shows ScreenError in its place, here and in every nested layout, instead of
// closing the app.
export const unstable_settings = { anchor: "(tabs)", screenErrorBoundary: ScreenError };

export default function RootLayout() {
  // Fonts: Figtree for text, Barlow for numerals, as the web (pulse src/app/layout.tsx). Each weight is its own file
  // and its own family name; src/ui/Text.tsx picks the name from the web's font classes.
  const [fonts, fontError] = useFonts({ Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold });
  // Boot opens the database and reads the profile, the source and the saved theme (src/state/app.ts); the stored theme is
  // applied before the first frame, so a dark-mode person never sees a light flash.
  useEffect(() => void boot((theme) => colorScheme.set(theme as "light" | "dark" | "system")), []);
  const status = useApp((s) => s.status);
  const opened = useApp((s) => s.store !== null);
  // Onboarded: a profile, a source and a first completed run (pulse's (app) layout sends anyone else to onboarding).
  const onboarded = useApp((s) => s.onboarded);
  const bootError = useApp((s) => (s.store ? null : s.error));
  // A font that fails to load must not strand the app on the splash screen: the text falls back to the system font.
  const fontsDone = fonts || !!fontError;
  const ready = fontsDone && (status !== "booting" || !!bootError);

  return (
    <>
      {bootError && !opened ? (
        <View className="flex-1 items-center justify-center bg-background p-6">
          <Text className="text-destructive">{i18n.t("ui:app.bootDatabase", { error: bootError })}</Text>
        </View>
      ) : (
        ready && (
          <AppProviders>
            {/* The calendar's today, first day, zone and month loader, read once for every date switcher. */}
            <ShellData>
              <Screens onboarded={onboarded} />
            </ShellData>
          </AppProviders>
        )
      )}
      {/* Over everything from the first render; it hides the native splash once the app below can paint. */}
      <Opening ready={ready} />
    </>
  );
}

function Screens({ onboarded }: { onboarded: boolean }) {
  const { c, scheme } = useTheme();
  const language = useLanguage();
  // A tapped notification opens its screen once the navigator exists, a cold start included (src/background/links.ts).
  useNotificationDeepLinks();
  useTabLinks();
  // Without a theme React Navigation paints its own white card and light grey ground while a screen slides in or out, and the
  // window itself is the system's default: a white flash on every push, back and sheet. Both are the app's ground instead.
  const theme = useMemo(() => {
    const base = scheme === "dark" ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, primary: c.primary, background: c.background, card: c.background, text: c.foreground, border: c.border } };
  }, [scheme, c]);
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.background).catch(() => {});
  }, [c.background]);
  return (
    <ThemeProvider value={theme}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack key={language} screenOptions={{ headerShown: false, animation: Platform.OS === "android" ? "ios_from_right" : "default", contentStyle: { backgroundColor: c.background } }}>
        {/* First run: without a profile the person lands on onboarding and the tabs are out of reach; saving the profile
            flips the guards, and the navigator moves to the tabs (Stack.Protected). Declared first so each is the first screen. */}
        <Stack.Protected guard={!onboarded}>
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        {/* Every other route needs a profile, so a deep link cannot open a screen before onboarding. A route is guarded only
            when it is declared here: a new route file is added to this list. */}
        <Stack.Protected guard={onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="activities" />
          <Stack.Screen name="activity/[id]" />
          <Stack.Screen name="breathe" />
          <Stack.Screen name="coach" />
          <Stack.Screen name="coach/chats" />
          <Stack.Screen name="coach/settings" />
          <Stack.Screen name="chart" />
          <Stack.Screen name="connect" options={{ gestureEnabled: false }} />
          <Stack.Screen name="health/fitness" />
          <Stack.Screen name="health/healthspan" />
          <Stack.Screen name="health/heart-rate" />
          <Stack.Screen name="health/monitor" />
          <Stack.Screen name="health/stress" />
          <Stack.Screen name="journal/insights" />
          <Stack.Screen name="metric/[key]" />
          <Stack.Screen name="more/behaviours" />
          <Stack.Screen name="more/data" />
          <Stack.Screen name="more/how-it-works" />
          <Stack.Screen name="more/how-it-works/[score]" />
          <Stack.Screen name="recovery" />
          <Stack.Screen name="reports" />
          <Stack.Screen name="reports/[period]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="sleep" />
          <Stack.Screen name="sleep/nap/[id]" />
          <Stack.Screen name="strain" />
          <Stack.Screen name="trend/[key]" />
          <Stack.Screen name="trends" />
          <Stack.Screen name="workout-live" />
          <Stack.Screen name="dev/kit" />
          <Stack.Screen name="dev/kit/charts" />
          <Stack.Screen name="dev/kit/detail" />
          <Stack.Screen name="dev/kit/home" />
          <Stack.Screen name="dev/kit/metrics" />
          {/* Task pages (the web's drawers) are ordinary pages: a route in app/ rendering <TaskPage>, opened with push(). */}
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="plus" />
          <Stack.Screen name="trends-metric" />
          <Stack.Screen name="ecg" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="checkin" />
          <Stack.Screen name="log" />
          <Stack.Screen name="food" />
          <Stack.Screen name="goals" />
          <Stack.Screen name="weekly-plan" />
          <Stack.Screen name="chart-metric" />
          <Stack.Screen name="journal/impact" />
          <Stack.Screen name="dev/task" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
