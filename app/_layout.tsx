import "../global.css";

import { useEffect } from "react";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
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
      <Screens hasProfile={hasProfile} />
    </AppProviders>
  );
}

function Screens({ hasProfile }: { hasProfile: boolean }) {
  const { c, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {/* The native stack: detail screens push with the platform's transition, iOS swipe-back from the left edge and the
          Android back gesture work on every route that is not a root. The headers are the shells' own, so the native one is off. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
        {/* First run: without a profile the person lands on onboarding and the tabs are out of reach; saving the profile
            flips the guards, and the navigator moves to the tabs (Stack.Protected). Declared first so each is the first screen. */}
        <Stack.Protected guard={!hasProfile}>
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={hasProfile}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
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
      </Stack>
    </>
  );
}
