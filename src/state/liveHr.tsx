// The live heart rate: halo's foreground ticker (src/state/app.tsx `refreshLiveHr` and its effect). Every minute while
// the app is active and ready, one short Health Connect read (src/health/live.ts refreshRecentHeartRate: the last 20
// minutes, written to the Store) and the newest reading with its 30 minutes. No scoring run. Its own small store, so a
// tick re-renders only its readers (Home's heart-rate card), and `liveVersion`, bumped when samples moved, lets the
// Heart rate screen alone re-read the day.
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { HrSample } from "@/data/types";
import { refreshRecentHeartRate, storedRecentHeartRate } from "@/health/live";
import { widgetEpoch } from "../../modules/pulse-widgets";
import { refreshWidgets } from "@/widgets/publish";
import { localDay } from "@/lib/time";
import { appState, isSyncing, useApp } from "./app";

export type LiveHr = {
  /** The newest sample the Store holds (unix seconds), whichever read brought it. */
  latest: { ts: number; bpm: number } | null;
  /** The 30 minutes of samples ending at `latest`, ascending. */
  recent: HrSample[];
  /** Epoch ms of the last read; null before the first. "x min ago" is measured from it, so render stays pure. */
  updatedAt: number | null;
  /** Why Health Connect was not read on the last tick; the Store's own answer is still in `latest`. */
  error: string | null;
};
export type LiveValue = { liveHr: LiveHr; liveVersion: number };

/** The ticker's cadence while the app is in the foreground. */
const LIVE_EVERY_MS = 60_000;

let value: LiveValue = { liveHr: { latest: null, recent: [], updatedAt: null, error: null }, liveVersion: 0 };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => value;

/** The live heart rate; only its readers re-render on a tick. */
export const useLiveHr = (): LiveValue => useSyncExternalStore(subscribe, snapshot);

let busy = false;

/**
 * One live read. Skipped while a full run is importing (it reads the same days) or while a previous read is still in
 * flight. Never throws.
 */
export async function refreshLiveHr(): Promise<void> {
  const { store, source, profile } = appState();
  if (!store || !source || isSyncing() || busy) return;
  busy = true;
  try {
    const epoch = await Promise.resolve().then(widgetEpoch).catch(() => null);
    const r = await refreshRecentHeartRate(store, { source, timeZone: profile?.timeZone });
    const prev = value.liveHr.latest;
    const moved = r.added > 0 || r.latest?.ts !== prev?.ts || r.latest?.bpm !== prev?.bpm;
    value = { liveHr: { latest: r.latest, recent: r.samples, updatedAt: Date.now(), error: r.error ?? null }, liveVersion: moved ? value.liveVersion + 1 : value.liveVersion };
    if (moved && profile && epoch !== null) {
      const now = Math.floor(Date.now() / 1000);
      void refreshWidgets({ store, profile, timeZone: profile.timeZone, today: localDay(now, profile.timeZone), now, sync: appState().sync }, source, { epoch });
    }
  } catch (e) {
    value = { ...value, liveHr: { ...value.liveHr, updatedAt: Date.now(), error: e instanceof Error ? e.message : String(e) } };
  } finally {
    busy = false;
  }
  for (const l of listeners) l();
}

/** The newest stored reading, before any live read has landed. Reads SQLite only; never throws. */
async function primeFromStore(): Promise<void> {
  const { store } = appState();
  if (!store || value.liveHr.updatedAt !== null) return;
  const r = await storedRecentHeartRate(store).catch(() => null);
  if (!r?.latest || value.liveHr.updatedAt !== null) return;
  value = { ...value, liveHr: { latest: r.latest, recent: r.samples, updatedAt: Date.now(), error: null } };
  for (const l of listeners) l();
}

/**
 * The foreground ticker, mounted once (src/ui/providers.tsx): a read at once, then every minute, while the app is active
 * and ready. A run sets status "syncing", which stops it; its "ready" starts it again, so every run is followed by a live
 * read. Backgrounded, the interval is cleared and nothing is read.
 */
export function LiveHrTicker() {
  const ready = useApp((s) => s.status === "ready" && s.store !== null && s.source !== null);
  // A launch sync holds the ticker back for its whole run: until then, show the newest reading already on the phone.
  const opened = useApp((s) => s.store !== null);
  useEffect(() => {
    if (opened) void primeFromStore();
  }, [opened]);
  useEffect(() => {
    if (!ready) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (id !== null) clearInterval(id);
      id = null;
    };
    const start = () => {
      stop();
      void refreshLiveHr();
      id = setInterval(() => void refreshLiveHr(), LIVE_EVERY_MS);
    };
    // currentState can still be unknown right after launch; only a known background state holds the ticker back.
    if (AppState.currentState !== "background" && AppState.currentState !== "inactive") start();
    const sub = AppState.addEventListener("change", (next) => (next === "active" ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [ready]);
  return null;
}
