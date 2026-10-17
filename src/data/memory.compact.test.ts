// Heart-rate compaction on the in-memory store (Store.compactHr), the rules the SQLite store follows too.
import { describe, expect, it } from "vitest";
import { openMemoryStore } from "./memory";

const DAY = 86_400;
/** A sample every 5 s through `day` (a UTC day index), the bpm cycling 60, 61, … 71. */
const day = (d: number) => Array.from({ length: DAY / 5 }, (_, i) => ({ ts: d * DAY + i * 5, bpm: 60 + (i % 12) }));

describe("compactHr", () => {
  it("leaves one rounded mean per minute on each day that ended before the cut, oldest first, and recent days raw", async () => {
    const store = await openMemoryStore();
    await store.putHr([...day(0), ...day(1), ...day(2)]);
    expect(await store.compactHr(2 * DAY)).toBe(2);
    const old = await store.readHr(0, 2 * DAY);
    expect(old).toHaveLength(2 * 1440);
    // Each minute's twelve samples are 60 … 71: a mean of 65.5, rounded.
    expect(old.slice(0, 2)).toEqual([{ ts: 0, bpm: 66 }, { ts: 60, bpm: 66 }]);
    expect(await store.readHr(2 * DAY, 3 * DAY)).toEqual(day(2));
    // A compacted day is left alone.
    expect(await store.compactHr(2 * DAY)).toBe(0);
  });

  it("makes a day raw again when its samples are written again, and compacts it on the next call", async () => {
    const store = await openMemoryStore();
    await store.putHr(day(0));
    await store.compactHr(DAY);
    await store.clearImported({ from: "1970-01-01", to: "1970-01-01" }, 0, DAY);
    await store.putHr(day(0));
    expect(await store.readHr(0, DAY)).toHaveLength(DAY / 5);
    expect(await store.compactHr(DAY)).toBe(1);
    expect(await store.readHr(0, DAY)).toHaveLength(1440);
  });
});
