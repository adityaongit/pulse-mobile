import { i18n } from "@/i18n/config";
// Home's My Dashboard: which metrics it shows, in which order. Kept on the phone as halo keeps it
// (src/screens/home/dashboard.ts there): AsyncStorage "pulse.dashboard", read once, the default list stored as nothing.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isDashboardKey, type DashboardKey } from "@/lib/dashboard";
import type { ActionResult } from "./journal";

export const DASHBOARD_KEY = "pulse.dashboard";

/** undefined until read; null when nothing is chosen (Home shows the default list). */
let saved: DashboardKey[] | null | undefined;

const parse = (raw: string | null): DashboardKey[] | null => {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(v)) return null;
    const keys = v.filter((k): k is DashboardKey => typeof k === "string" && isDashboardKey(k));
    return keys.length ? keys : null;
  } catch {
    return null;
  }
};

/** The chosen keys, or null for the default list. */
export async function dashboardChoice(): Promise<DashboardKey[] | null> {
  if (saved === undefined) saved = parse(await AsyncStorage.getItem(DASHBOARD_KEY).catch(() => null));
  return saved;
}

/**
 * Saves the chosen metrics in order. The default list is stored as nothing (the web stores no rows), so a later change
 * of default (a band synced for the first time) still reaches it.
 */
export async function saveDashboard(input: { keys: string[] }, defaults: DashboardKey[]): Promise<ActionResult> {
  const { keys } = input;
  if (!keys.every(isDashboardKey)) return { ok: false, error: i18n.t("errors:dashboard.unknownMetric") };
  if (keys.length < 1) return { ok: false, error: i18n.t("errors:dashboard.chooseOne") };
  if (new Set(keys).size !== keys.length) return { ok: false, error: i18n.t("errors:dashboard.listedTwice") };
  const isDefault = keys.length === defaults.length && keys.every((k, i) => k === defaults[i]);
  if (isDefault) await AsyncStorage.removeItem(DASHBOARD_KEY);
  else await AsyncStorage.setItem(DASHBOARD_KEY, JSON.stringify(keys));
  saved = isDefault ? null : [...keys];
  return { ok: true, data: undefined };
}
