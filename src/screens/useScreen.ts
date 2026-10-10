// How a screen loads its view model: the query runs with a fresh context (so `now` is current), and runs again when
// stored data changes (`dataChanged()` after a sync, a recompute or a write) or when the screen comes back into view
// after a change. This replaces the web's Server Components and revalidatePath.
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { store } from "../data/store";
import { ctxOf, type QueryCtx } from "../queries/common";

let version = 0;
const listeners = new Set<() => void>();

/** Call after anything writes data a screen shows: every mounted screen reloads its query. */
export function dataChanged() {
  version++;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Changes whenever `dataChanged()` runs: for a loader that sits outside any screen (src/screens/ShellData.tsx). */
export const useDataVersion = () => useSyncExternalStore(subscribe, () => version);

export type ScreenState<T> = { data?: T; error?: Error; loading: boolean; reload: () => void };

/**
 * Runs `query` for the screen. `key` lists what the query depends on (the day, a metric key, a range): a change
 * reloads. While a reload runs, the previous data stays on screen, so a refresh never flashes a skeleton.
 */
export function useScreen<T>(query: (ctx: QueryCtx) => Promise<T>, key: unknown[]): ScreenState<T> {
  const v = useDataVersion();
  const [tick, setTick] = useState(0);
  // One string per request: loading is "the last finished request is not this one".
  const sig = `${JSON.stringify(key)}|${v}|${tick}`;
  const [state, setState] = useState<{ sig?: string; data?: T; error?: Error }>({});

  useEffect(() => {
    let live = true;
    ctxOf(store)
      .then((ctx) => query(ctx))
      .then(
        (data) => live && setState({ sig, data }),
        (e: unknown) => live && setState((s) => ({ ...s, sig, error: e instanceof Error ? e : new Error(String(e)) })),
      );
    return () => {
      live = false;
    };
    // `key` is the query's dependency list, folded into `sig`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // A stack screen stays mounted under the next one; reload when it is shown again, if data changed meanwhile.
  const seen = useRef(v);
  useFocusEffect(
    useCallback(() => {
      if (seen.current !== version) setTick((t) => t + 1);
      return () => {
        seen.current = version;
      };
    }, []),
  );

  return { data: state.data, error: state.error, loading: state.sig !== sig, reload: () => setTick((t) => t + 1) };
}
