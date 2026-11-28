// Settings › App: the theme and whether the Journal shows, device preferences kept in AsyncStorage as halo keeps its own.
// The notification toggles moved to Settings › Notifications & background (src/background/settings.ts, which migrates the
// old keys). No imports from src/state: the background (src/background/startup.ts) reads the Journal flag too.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const THEME_KEY = "pulse.theme";
/** "1" while the Journal is hidden (Settings › App). Hiding deletes nothing: the journal's rows stay in the Store. */
export const JOURNAL_HIDDEN_KEY = "pulse.journal.hidden";

export type Theme = "system" | "light" | "dark";
export type AppPrefs = { theme: Theme };

export async function loadPrefs(): Promise<AppPrefs> {
  const theme = await AsyncStorage.getItem(THEME_KEY).catch(() => null);
  return { theme: theme === "light" || theme === "dark" ? theme : "system" };
}

export async function saveTheme(theme: Theme): Promise<void> {
  await AsyncStorage.setItem(THEME_KEY, theme);
}

/** True while the person has hidden the Journal; shown when nothing is saved or storage fails. */
export async function journalHidden(): Promise<boolean> {
  return (await AsyncStorage.getItem(JOURNAL_HIDDEN_KEY).catch(() => null)) === "1";
}

export async function saveJournalHidden(hidden: boolean): Promise<void> {
  if (hidden) await AsyncStorage.setItem(JOURNAL_HIDDEN_KEY, "1");
  else await AsyncStorage.removeItem(JOURNAL_HIDDEN_KEY);
}
