// Widgets consume the same Store-backed Home view as the app. Native rendering never opens SQLite/Health Connect.
import { clearSnapshot, publishSnapshot, hasWidgets, widgetsAvailable, widgetEpoch } from "../../modules/pulse-widgets";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryCtx } from "@/queries/ctx";
import { storedRecentHeartRate } from "@/health/live";
import { getHome } from "@/queries/home";
import { buildWidgetSnapshot } from "./model";

let generation = 0;
let queue: Promise<void> = Promise.resolve();
/** Latest projection wins, including across reset/source changes. Failures must never break sync or onboarding. */
export function refreshWidgets(ctx: QueryCtx, source: "health_connect" | "demo", opts: { force?: boolean; epoch?: number } = {}): Promise<void> {
  try {
    if (!widgetsAvailable() || (!opts.force && !hasWidgets())) return Promise.resolve();
  } catch { return Promise.resolve(); }
  const mine = ++generation;
  queue = queue.catch(() => {}).then(async () => {
    if (mine !== generation) return;
    const epoch = opts.epoch ?? await widgetEpoch();
    // A headless run may finish after the user reset Pulse or changed source in another runtime.
    if ((await AsyncStorage.getItem("pulse.source")) !== source || !(await ctx.store.getProfile())) return;
    const [home, reading] = await Promise.all([getHome(ctx.today, ctx), storedRecentHeartRate(ctx.store).catch(() => undefined)]);
    if (mine !== generation) return;
    const snapshot = buildWidgetSnapshot(home, { timeZone: ctx.timeZone, generatedAt: ctx.now, lastSyncTs: ctx.sync.lastSyncTs, source }, reading);
    if ((await AsyncStorage.getItem("pulse.source")) !== source) return;
    await publishSnapshot(JSON.stringify(snapshot), epoch);
  }).catch(() => { /* Best effort; keep the last snapshot's original sync timestamp, never log health payloads. */ });
  return queue;
}

export function clearWidgets(): Promise<void> {
  ++generation;
  queue = queue.catch(() => {}).then(() => clearSnapshot()).catch(() => {});
  return queue;
}
