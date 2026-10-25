// A read-through memo over a Store for the screens' queries. halo's loadDays reads every metric and logged entry on
// each call, and one screen calls it several times (its own range, the trend views, the extras), so the same whole-table
// reads would run again and again. Within one data version (src/state/app.ts dataChanged) each of these reads runs
// once; the next version starts empty. Writes pass straight through: a query that writes (the default journal tags)
// uses methods that are not memoised.
import type { Store } from "./store";

/** The reads worth keeping: whole tables or day ranges, the same for every query of one version. */
const MEMO = new Set<keyof Store>(["allMetrics", "allSessions", "allExercises", "loggedEntries", "scoresIn", "dailyValues", "getBloodPressureReadings"]);

/** `store` with the MEMO reads cached per `version`. Arrays come back as shallow copies, so a caller's sort stays its own. */
export function memoStore(store: Store, version: () => number): Store {
  let at = -1;
  const cache = new Map<string, Promise<unknown>>();
  return new Proxy(store, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function") return v;
      if (!MEMO.has(prop as keyof Store)) return v.bind(target);
      return (...args: unknown[]) => {
        if (at !== version()) {
          at = version();
          cache.clear();
        }
        const key = `${String(prop)}:${JSON.stringify(args)}`;
        let hit = cache.get(key);
        if (!hit) {
          hit = (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          hit.catch(() => cache.delete(key));
          cache.set(key, hit);
        }
        return hit.then((r) => (Array.isArray(r) ? [...r] : r));
      };
    },
  });
}
