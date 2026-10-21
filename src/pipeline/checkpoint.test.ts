/// <reference types="node" />
// Incremental stage 2 (checkpoint.ts) writes exactly what a full replay writes, over the 180-day demo seed.
import { expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { SeriesKind } from "@/data/store";
import type { Profile } from "@/data/types";
import { addDays } from "@/lib/time";
import { lastRun, runPipeline } from "@/pipeline";
import { dropCheckpoint } from "./checkpoint";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
const SERIES: SeriesKind[] = ["hr", "still_hr", "stress", "energy_bank"];

const run = (store: MemoryStore) => runPipeline(store, PROFILE, { today: TODAY });

/** The last few days change as a sync brings them again: nightly values, steps, a journal tag. */
async function change(store: MemoryStore, days: string[]) {
  const metrics = (await store.allMetrics()).filter((m) => days.includes(m.day));
  await store.upsertMetrics(metrics.map((m) => ({ ...m, hrvMs: (m.hrvMs ?? 50) + 7, rhrBpm: (m.rhrBpm ?? 60) - 2, steps: (m.steps ?? 0) + 1500 })));
  await store.setJournal({ day: days[0], tag: "alcohol", value: 1 });
  await store.markIntradayDirty(days);
}

async function everything(store: MemoryStore) {
  const rows = await store.scoresIn({ from: "0000-00-00", to: "9999-99-99" });
  const series = [];
  for (const r of rows) for (const k of SERIES) series.push([r.day, k, await store.getSeries(r.day, k)]);
  return JSON.stringify([rows, series, await store.getReports(), await store.getActivityCost()]);
}

it("an incremental run writes what a full replay writes", async () => {
  const [inc, full] = [new MemoryStore(), new MemoryStore()];
  for (const s of [inc, full]) {
    await seedDemo(s, { today: TODAY, timeZone: TZ, now: NOW });
    await run(s);
  }
  const first = lastRun.stage2From;
  const recent = [addDays(TODAY, -3), addDays(TODAY, -2), addDays(TODAY, -1)];

  await change(inc, recent);
  await run(inc);
  expect(lastRun.stage2From > first).toBe(true);
  expect(lastRun.stage2From <= recent[0]).toBe(true);

  await dropCheckpoint(full);
  await change(full, recent);
  await run(full);
  expect(lastRun.stage2From).toBe(first);

  expect(await everything(inc)).toBe(await everything(full));

  // A change before the kept day replays every day.
  await change(inc, [addDays(TODAY, -60)]);
  await run(inc);
  expect(lastRun.stage2From).toBe(first);
}, 60_000);

it("replays every day when the stored checkpoint is unreadable or from another build's fold", async () => {
  const store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  await run(store);
  const first = lastRun.stage2From;
  const recent = [addDays(TODAY, -2)];

  const cp = JSON.parse((await store.getCheckpoint())!) as { fold: Record<string, unknown> };
  delete cp.fold.hrvB;
  await store.putCheckpoint(JSON.stringify(cp));
  await change(store, recent);
  await run(store);
  expect(lastRun.stage2From).toBe(first);

  await store.putCheckpoint("{not json");
  await change(store, recent);
  await run(store);
  expect(lastRun.stage2From).toBe(first);

  // And resumes again from the checkpoint that full run kept.
  await change(store, recent);
  await run(store);
  expect(lastRun.stage2From > first).toBe(true);
}, 60_000);
