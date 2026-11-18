// Timeline upkeep (docs/timeline.md): days old enough are frozen into stored stays and movement, and raw fixes older
// than RAW_FIX_DAYS are dropped once every day they feed is frozen. Runs after each sync's maintenance and from the
// fix task at most once an hour; idempotent.
import { FREEZE_AFTER_DAYS, RAW_FIX_DAYS, type FrozenStay } from "@/core/places/types";
import type { Store } from "@/data/store";
import { addDays, localDay, localMidnight } from "@/lib/time";
import { slice } from "@/lib/yield";
import { detectDay } from "@/queries/timeline";

const DAY_S = 86_400;

/** Freezes every unfrozen day up to FREEZE_AFTER_DAYS ago, then prunes old fixes. Returns how many days it froze. */
export async function maintainTimeline(store: Store, timeZone: string, now: number): Promise<number> {
  const state = await store.getTimelineState();
  const today = localDay(now, timeZone);
  const last = addDays(today, -FREEZE_AFTER_DAYS);
  let start = state.frozenThrough ? addDays(state.frozenThrough, 1) : null;
  if (!start) {
    // The first run: from the oldest event (an office's history can be months old) or the oldest kept fix.
    const [events, fixes] = await Promise.all([store.placeEvents(0, now), store.locationFixes(now - (RAW_FIX_DAYS + 1) * DAY_S, now)]);
    const first = Math.min(events[0]?.ts ?? Infinity, fixes[0]?.ts ?? Infinity);
    start = Number.isFinite(first) ? localDay(first, timeZone) : last;
  }
  const places = await store.places();
  let frozen = 0;
  for (let day = start; day <= last; day = addDays(day, 1)) {
    const { stays, buckets } = await detectDay(store, places, day, timeZone, now);
    const from = localMidnight(day, timeZone);
    const end = localMidnight(addDays(day, 1), timeZone);
    const rows = stays.map((s): FrozenStay => ({ day, start: s.start, end: s.end, placeId: s.placeId, latitude: s.latitude, longitude: s.longitude, capped: s.capped }));
    await store.freezeDay(day, rows, from, end, buckets);
    await store.setTimelineState({ frozenThrough: day });
    frozen++;
    await slice();
  }
  // Fixes feed a day and the one before it as context: keep them until both are frozen, and RAW_FIX_DAYS at least.
  const horizon = (await store.getTimelineState()).frozenThrough;
  if (horizon) await store.pruneLocationFixes(Math.min(now - RAW_FIX_DAYS * DAY_S, localMidnight(horizon, timeZone) - DAY_S));
  return frozen;
}

/**
 * After a place is saved or removed, the days that still have their fixes are detected again with the new places
 * (an unknown stop saved as "Friend's" takes the name in the last month too). Older frozen days keep what they had.
 */
export async function unfreezeRecent(store: Store, timeZone: string, now: number): Promise<void> {
  const { frozenThrough } = await store.getTimelineState();
  const floor = addDays(localDay(now, timeZone), -(RAW_FIX_DAYS - 1));
  if (frozenThrough && frozenThrough > floor) await store.setTimelineState({ frozenThrough: floor });
}
