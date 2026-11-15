import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { i18n } from "@/i18n/config";
import type { QueryCtx } from "@/queries/ctx";
import { dataChanged, dataVersion, queryCtx, useDataVersion } from "@/state/app";
import { useScreenReady } from "../ui/shells/useScreenReady";
import { keepEqual } from "./keepEqual";
import { cache, loading, cacheListeners, MAX_ENTRIES, subscribeCache, type Entry } from "./screenCache";

export { dataChanged, useDataVersion };

/** The query context, read as a load starts: the app state's Store, profile and sync state, and the clock. */
const ctxOf = async (): Promise<QueryCtx> => queryCtx();

/**
 * Screen results kept in memory, keyed by the screen's key (`[id, ...params]`). A screen opened again renders its last
 * result in the first frame, with no skeleton, and refreshes it in the background when the data changed (`dataChanged`)
 * or the result is older than FRESH_MS (clock-relative values like "today" and "11m ago"). The map lives in
 * screenCache.ts so a source switch can drop it without importing this hook.
 *
 * A result this old is reloaded when its screen is next focused. Most of what a screen shows is day-granular, so a
 * minute was too eager: every return to a tab after a minute re-ran the whole query. Clock-relative copy has its own
 * subscriptions (the live heart rate, the sync status); a screen that really needs a beat can pass `freshMs`.
 */
const FRESH_MS = 5 * 60_000;

const sameLanguage = (e: Entry | undefined): e is Entry => !!e && e.lng === i18n.language;
const fresh = (e: Entry | undefined, ms = FRESH_MS): e is Entry => sameLanguage(e) && e.version === dataVersion() && Date.now() - e.at < ms;

/**
 * Runs `query` for `k` and caches its result. A load already running for this data version is joined; one started
 * before a `dataChanged` is not (it may have read the old rows), and if it lands after the newer one it is dropped.
 * The new result keeps every part equal to the last one's (keepEqual): a page re-renders only the parts that changed.
 */
function load(k: string, query: (ctx: QueryCtx) => Promise<unknown>): Promise<void> {
  const started = dataVersion();
  const lng = i18n.language;
  const running = loading.get(k);
  if (running?.version === started) return running.p;
  const at = performance.now();
  const p: Promise<void> = ctxOf()
    .then(query)
    .then((data) => {
      if (__DEV__) console.info(`[screen] ${k} loaded ms=${Math.round(performance.now() - at)}`);
      // A write (or a source switch) landed while this read ran: its rows may be from the old version/store.
      if (dataVersion() !== started) return;
      const prev = cache.get(k);
      if (prev && prev.version > started && prev.lng === lng) return;
      cache.delete(k);
      cache.set(k, { data: keepEqual(prev?.data, data), version: started, at: Date.now(), lng });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      for (const l of cacheListeners) l();
    })
    .finally(() => loading.get(k)?.p === p && loading.delete(k));
  loading.set(k, { p, version: started });
  return p;
}

const cacheKey = (key: readonly unknown[]) => JSON.stringify(key);

/** Loads a screen's result ahead of its navigation, so the screen opens with content. A fresh result is kept. */
export function prefetch<T>(query: (ctx: QueryCtx) => Promise<T>, key: ScreenKey): Promise<void> {
  const k = cacheKey(key);
  return fresh(cache.get(k)) ? Promise.resolve() : load(k, query);
}

/** A screen one tap away: its query and key. */
export type Preload = { query: (ctx: QueryCtx) => Promise<unknown>; key: ScreenKey };

/** Loads each item's data, one item per idle moment of the JS thread, so a tap or a scroll never waits on them. Returns a cancel. */
export function preloadWhenIdle(items: Preload[]): () => void {
  let cancelled = false;
  let idle: number | undefined;
  const next = (i: number) => {
    if (cancelled || i >= items.length) return;
    idle = requestIdleCallback(() => {
      const { query, key } = items[i];
      prefetch(query, key)
        .catch(() => {})
        .finally(() => next(i + 1));
    });
  };
  next(0);
  return () => {
    cancelled = true;
    if (idle !== undefined) cancelIdleCallback(idle);
  };
}

/** A screen's id, then the parameters its query depends on. The id keeps two screens with the same parameters apart. */
export type ScreenKey = readonly [string, ...unknown[]];

export type ScreenState<T> = { data?: T; error?: Error; loading: boolean; reload: () => void };

/** `eager`: show the result as soon as it is read, without waiting for the opening transition to end (a small read on a light page). */
export function useScreen<T>(query: (ctx: QueryCtx) => Promise<T>, key: ScreenKey, opts?: { eager?: boolean; freshMs?: number }): ScreenState<T> {
  const k = cacheKey(key);
  const ready = useScreenReady();
  const v = useDataVersion(ready);
  const entry = useSyncExternalStore(subscribeCache, () => cache.get(k));
  const ms = opts?.freshMs ?? FRESH_MS;
  // A result in memory when the screen mounted shows at once; a cold one waits for the opening transition to end, so
  // the first render of the page does not land mid-slide. Once shown, results keep showing (a blurred screen too).
  const [settled, setSettled] = useState(() => !!opts?.eager || cache.has(k));
  if (!settled && ready && entry) setSettled(true);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<{ k: string; error: Error }>();
  const reload = useCallback(() => {
    const e = cache.get(k);
    if (e) e.at = 0;
    setTick((t) => t + 1);
  }, [k]);

  // Inline queries change identity each render; their dependencies are in the key, so the effect reads the latest one.
  const read = useEffectEvent((key: string) => load(key, query));
  useEffect(() => {
    if (fresh(cache.get(k), ms)) return;
    let live = true;
    read(k).catch((e: unknown) => live && setError({ k, error: e instanceof Error ? e : new Error(String(e)) }));
    return () => {
      live = false;
    };
    // `v` (the data version), `ready` (a re-check on focus) and `tick` (reload) re-run it.
  }, [k, v, ready, tick, ms]);

  const shown = sameLanguage(entry) && settled ? (entry.data as T) : undefined;
  return { data: shown, error: error?.k === k ? error.error : undefined, loading: !fresh(entry, ms), reload };
}
