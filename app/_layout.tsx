import "../global.css";

import { useEffect, useMemo } from "react";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { Barlow_500Medium } from "@expo-google-fonts/barlow/500Medium";
import { Barlow_600SemiBold } from "@expo-google-fonts/barlow/600SemiBold";
import { Barlow_700Bold } from "@expo-google-fonts/barlow/700Bold";
import { Figtree_400Regular } from "@expo-google-fonts/figtree/400Regular";
import { Figtree_500Medium } from "@expo-google-fonts/figtree/500Medium";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";
import { Figtree_700Bold } from "@expo-google-fonts/figtree/700Bold";

import { db } from "@/data/db";
import migrations from "@/data/migrations/migrations";
import { ShellData } from "@/screens/ShellData";
import { useProfileGate } from "@/screens/onboarding/gate";
import { AppProviders } from "@/ui/providers";
import { sheetOptions, type SheetSize } from "@/ui/shells/sheets";
import { useTheme } from "@/ui/theme";

// Keep the splash screen up until the fonts and the database are ready, so no screen paints in the wrong font.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // Fonts: Figtree for text, Barlow for numerals, as the web (pulse src/app/layout.tsx). Each weight is its own file
  // and its own family name; src/ui/Text.tsx picks the name from the web's font classes.
  const [fonts, fontError] = useFonts({ Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold });
  // Migrations run at app start, as they run at boot on the web app.
  const { success, error } = useMigrations(db, migrations);
  // Whether the person has a profile yet (pulse's (app) layout sends a person without one to onboarding).
  const hasProfile = useProfileGate(success);
  // A font that fails to load must not strand the app on the splash screen: the text falls back to the system font.
  const fontsDone = fonts || !!fontError;
  const ready = (success || !!error) && fontsDone && (!success || hasProfile !== null);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-white p-6 dark:bg-black">
        <Text className="text-red-600">Database migration failed: {error.message}</Text>
      </View>
    );
  }
  if (!success || !fontsDone || hasProfile === null) return null;
  return (
    <AppProviders>
      {/* The calendar's today, first day, zone and month loader, read once for every date switcher. */}
      <ShellData>
        <Screens hasProfile={hasProfile} />
      </ShellData>
    </AppProviders>
  );
}

function Screens({ hasProfile }: { hasProfile: boolean }) {
  const { c, scheme } = useTheme();
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
      {/* The native stack: detail screens push with the platform's transition, iOS swipe-back from the left edge and the
          Android back gesture work on every route that is not a root. The headers are the shells' own, so the native one is off. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
        {/* First run: without a profile the person lands on onboarding and the tabs are out of reach; saving the profile
            flips the guards, and the navigator moves to the tabs (Stack.Protected). Declared first so each is the first screen. */}
        <Stack.Protected guard={!hasProfile}>
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        {/* Every other route needs a profile, so a deep link cannot open a screen before onboarding. A route is guarded only
            when it is declared here: a new route file is added to this list. */}
        <Stack.Protected guard={hasProfile}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="activities" />
          <Stack.Screen name="activity/[id]" />
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
          <Stack.Screen name="dev/kit" />
          <Stack.Screen name="dev/kit/charts" />
          <Stack.Screen name="dev/kit/detail" />
          <Stack.Screen name="dev/kit/home" />
          <Stack.Screen name="dev/kit/metrics" />
          <Stack.Screen name="dev/parity" />
          <Stack.Screen name="dev/time" />
          {/* Sheets are routes presented by the platform (src/ui/shells/sheets.ts says how to add one). */}
          <Stack.Screen name="(sheets)/dashboard" options={sheetOptions("screen", c)} />
          <Stack.Screen name="(sheets)/plus" options={sheetOptions("default", c)} />
          <Stack.Screen name="(sheets)/trends-metric" options={sheetOptions("default", c)} />
          <Stack.Screen name="(sheets)/ecg" options={sheetOptions("default", c)} />
          <Stack.Screen name="(sheets)/profile" options={sheetOptions("tall", c)} />
          <Stack.Screen name="(sheets)/checkin" options={sheetOptions("screen", c)} />
          <Stack.Screen name="(sheets)/log" options={({ route }) => sheetOptions(["food", "mood", "symptoms"].includes((route.params as { kind?: string } | undefined)?.kind ?? "") ? "tall" : "default", c)} />
          <Stack.Screen name="(sheets)/log-entry" options={sheetOptions("default", c)} />
          <Stack.Screen name="journal/impact" options={sheetOptions("default", c)} />
          <Stack.Screen name="dev/sheet" options={({ route }) => sheetOptions((route.params as { size?: SheetSize } | undefined)?.size ?? "default", c)} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
