// Storage upkeep after a run: heart rate older than RAW_HR_DAYS goes to minutes, and space is reclaimed only then.
import { describe, expect, it, vi } from "vitest";
import { openMemoryStore } from "@/data/memory";
import { maintainStorage, RAW_HR_DAYS } from "./maintenance";

const DAY = 86_400;
const NOW = 100 * DAY + 12 * 3600;
const raw = (d: number) => Array.from({ length: 720 }, (_, i) => ({ ts: d * DAY + i * 5, bpm: 70 }));

describe("maintainStorage", () => {
  it("compacts the days older than RAW_HR_DAYS, keeps the newer ones raw, and reclaims space when it compacted", async () => {
    const store = await openMemoryStore();
    const reclaim = vi.spyOn(store, "reclaimSpace");
    const aged = 100 - RAW_HR_DAYS - 1;
    const kept = 100 - RAW_HR_DAYS;
    await store.putHr([...raw(aged), ...raw(kept)]);
    await maintainStorage(store, NOW);
    expect(await store.readHr(aged * DAY, (aged + 1) * DAY)).toHaveLength(60);
    expect(await store.readHr(kept * DAY, (kept + 1) * DAY)).toHaveLength(720);
    expect(reclaim).toHaveBeenCalledTimes(1);
    await maintainStorage(store, NOW);
    expect(reclaim).toHaveBeenCalledTimes(1);
  });
});
