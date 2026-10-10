// Settings › App: the theme and the notification toggles. They are device preferences, stored in the `settings` table
// (`theme`, `notify.recovery`, `notify.syncProblem`); the web kept the theme in localStorage and the toggles as a push
// subscription. Scheduling the notifications is the background stream's.
import type { Store } from "../data/repos";
import type { SettingValues } from "../data/repos/settings";
import { dataChanged } from "../screens/useScreen";

export type Theme = SettingValues["theme"];
export type NotifyKey = "notify.recovery" | "notify.syncProblem";

export async function saveTheme(store: Store, theme: Theme): Promise<void> {
  await store.settings.set("theme", theme);
  dataChanged();
}

export async function saveNotify(store: Store, key: NotifyKey, on: boolean): Promise<void> {
  await store.settings.set(key, on);
  dataChanged();
}
