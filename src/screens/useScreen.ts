import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { i18n } from "@/i18n/config";
import type { QueryCtx } from "@/queries/ctx";
import { dataChanged, dataVersion, queryCtx, useDataVersion } from "@/state/app";
import { useScreenReady } from "../ui/shells/useScreenReady";
import { keepEqual } from "./keepEqual";

export { dataChanged, useDataVersion };

/** The query context, read as a load starts: the app state's Store, profile and sync state, and the clock. */
const ctxOf = async (): Promise<QueryCtx> => queryCtx();

/**
 * Screen results kept in memory, keyed by the screen's key (`[id, ...params]`). A screen opened again renders its last
 * result in the first frame, with no skeleton, and refreshes it in the background when the data changed (`dataChanged`)
 * or the result is older than FRESH_MS (clock-relative values like "today" and "11m ago").
 */
type Entry = { data: unknown; version: number; at: number; /** The language its text was written in: a result in another language is never shown. */ lng: string };
const cache = new Map<string, Entry>();
const loading = new Map<string, { p: Promise<void>; version: number }>();
const cacheListeners = new Set<() => void>();
const FRESH_MS = 60_000;
// ponytail: a plain size cap, oldest first; a byte budget if results ever grow large.
const MAX_ENTRIES = 100;

const subscribeCache = (l: () => void) => {
  cacheListeners.add(l);
  return () => cacheListeners.delete(l);
};

const sameLanguage = (e: Entry | undefined): e is Entry => !!e && e.lng === i18n.language;
const fresh = (e: Entry | undefined): e is Entry => sameLanguage(e) && e.version === dataVersion() && Date.now() - e.at < FRESH_MS;

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
export function useScreen<T>(query: (ctx: QueryCtx) => Promise<T>, key: ScreenKey, opts?: { eager?: boolean }): ScreenState<T> {
  const k = cacheKey(key);
  const ready = useScreenReady();
  const v = useDataVersion(ready);
  const entry = useSyncExternalStore(subscribeCache, () => cache.get(k));
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

  useEffect(() => {
    if (fresh(cache.get(k))) return;
    let live = true;
    load(k, query).catch((e: unknown) => live && setError({ k, error: e instanceof Error ? e : new Error(String(e)) }));
    return () => {
      live = false;
    };
    // Inline queries change identity each render; their dependencies are in the key. `ready` re-checks on focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, v, ready, tick]);

  const shown = sameLanguage(entry) && settled ? (entry.data as T) : undefined;
  return { data: shown, error: error?.k === k ? error.error : undefined, loading: !fresh(entry), reload };
}
