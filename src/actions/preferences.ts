// Settings › App: the theme, a device preference kept in AsyncStorage as halo keeps its own. The notification
// toggles moved to Settings › Notifications & background (src/background/settings.ts, which migrates the old keys).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEME_KEY } from "@/state/app";

export type Theme = "system" | "light" | "dark";
export type AppPrefs = { theme: Theme };

export async function loadPrefs(): Promise<AppPrefs> {
  const theme = await AsyncStorage.getItem(THEME_KEY).catch(() => null);
  return { theme: theme === "light" || theme === "dark" ? theme : "system" };
}

export async function saveTheme(theme: Theme): Promise<void> {
  await AsyncStorage.setItem(THEME_KEY, theme);
}
