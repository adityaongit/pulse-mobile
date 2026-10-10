// Demo heart-rhythm records: a few ECG readings and one irregular rhythm notification on fixed days from the seed's
// anchor, so Health Monitor's Heart rhythm section has something to show. Shaped like mapRecords' output.
import type { Repos } from "../data/repos";
import { addDays, localDay, localMidnight } from "../time";
import { SEED_DAYS } from "./scenario";

/** Day index from the anchor, local clock hours, and the data. The notification comes before a follow-up ECG. */
const RECORDS = [
  { i: SEED_DAYS - 64, h: 9.2, kind: "ecg", data: { result: "NORMAL_SINUS_RHYTHM", avgBpm: 61 } },
  { i: SEED_DAYS - 22, h: 3.6, kind: "irn", data: { alertWindows: 2 } },
  { i: SEED_DAYS - 22, h: 8.4, kind: "ecg", data: { result: "INCONCLUSIVE_HIGH_HEART_RATE", avgBpm: 118 } },
  { i: SEED_DAYS - 21, h: 7.9, kind: "ecg", data: { result: "NORMAL_SINUS_RHYTHM", avgBpm: 66 } },
] as const;

/** Inserts the records that have happened by `now` (unix seconds); returns the rows written. */
export async function seedHeartRhythm(store: Repos, anchor: string, timeZone: string, now: number): Promise<number> {
  const rows = RECORDS.flatMap((r) => {
    const ts = localMidnight(addDays(anchor, r.i), timeZone) + Math.round(r.h * 60) * 60;
    if (ts > now) return [];
    // A notification covers the windows it analysed: about two hours here.
    const data = r.kind === "irn" ? { ...r.data, endTs: ts + 2 * 3600 } : r.data;
    return [{ id: `seed-${r.kind}-${ts}`, kind: r.kind, ts, day: localDay(ts, timeZone), data }];
  });
  if (!rows.length) return 0;
  return store.daily.upsertHealthRecords(rows);
}
