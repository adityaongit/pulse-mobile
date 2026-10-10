// "Load demo data": the phone's version of pulse's DATA_SOURCE=demo first cycle (worker.ts's demoUser + seedSource.pull) and
// scripts/seed-demo-user.mts. Saves the demo profile, makes the default journal tags, generates SEED_DAYS days ending at
// `now` (today a partial day), writes them and runs the pipeline. A phone has one JavaScript thread, so every step is cut
// into chunks with a turn of the event loop between them: the progress bar and animations keep running.
import { DEFAULT_JOURNAL_TAGS } from "../journalTags";
import type { Repos, Store } from "../data/repos";
import { recompute } from "../pipeline";
import { getProfile, saveProfile } from "../profile";
import { dataChanged } from "../screens/useScreen";
import { addDays, localDay } from "../time";
import { type Day, DEMO_PROFILE, generateDay, writeDays } from "./generate";
import { seedHeartRhythm } from "./heartRhythm";
import { SEED_DAYS } from "./scenario";

export type SeedPhase = "generate" | "write" | "score";
export type SeedProgress = { phase: SeedPhase; done: number; total: number };
export type SeedResult = { days: number; rows: number; ms: Record<SeedPhase, number> };
export type SeedOptions = {
  /** Unix seconds; the data ends here. Default: now. */
  now?: number;
  onProgress?: (p: SeedProgress) => void;
  /** IANA zone of the demo person's days. Default: the phone's own (DEMO_PROFILE). */
  timeZone?: string;
};

/** Days generated, and days written, between two turns of the event loop. A day takes tens of ms on a phone: keep it to one. */
const GENERATE_CHUNK = 1;
const WRITE_CHUNK = 3;

/** One turn of the event loop, so React can render and animations can advance. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The longest a stretch of work may run before it hands the thread back: under a frame (16 ms), with room to draw. */
const SLICE_MS = 8;

/**
 * The same store, but every repository call first gives the event loop a turn when the work has run for SLICE_MS since the
 * last one. The pipeline (src/pipeline, not ours to change) awaits the repositories between its batches of days, so this is
 * where it can be cut up: `recompute` is otherwise one block of JavaScript that holds the thread for the whole scoring pass.
 */
function timeSliced(store: Store): Store {
  let since = performance.now();
  const turn = async () => {
    if (performance.now() - since < SLICE_MS) return;
    await yieldToUi();
    since = performance.now();
  };
  const wrap = (repos: Repos): Repos =>
    Object.fromEntries(
      Object.entries(repos).map(([name, repo]) => [
        name,
        Object.fromEntries(Object.entries(repo as object).map(([m, fn]) => [m, async (...args: unknown[]) => (await turn(), (fn as (...a: unknown[]) => unknown)(...args))])),
      ]),
    ) as unknown as Repos;
  return { ...wrap(store), transaction: (fn) => store.transaction((tx) => fn(wrap(tx))) };
}

export const NOT_EMPTY = "This app already holds data. Delete everything in Settings first, then load the demo data again.";

export async function loadDemoData(store: Store, { now = Math.floor(Date.now() / 1000), onProgress = () => {}, timeZone = DEMO_PROFILE.timeZone }: SeedOptions = {}): Promise<SeedResult> {
  if ((await store.daily.readMetrics()).length > 0 || (await store.samples.hasHr())) throw new Error(NOT_EMPTY);

  await saveProfile(store, { ...DEMO_PROFILE, timeZone }, now);
  await store.journal.ensureDefaultTags([...DEFAULT_JOURNAL_TAGS]);
  const today = localDay(now, timeZone);
  // Max HR is the profile's resolved one (estimated from the age on `today`), as pulse's seedSource reads it.
  const profile = (await getProfile(store, today))!;
  const ctx = { anchor: addDays(today, 1 - SEED_DAYS), timeZone: profile.timeZone, maxHr: profile.maxHr };

  const ms = { generate: 0, write: 0, score: 0 };
  const phase = async <T>(name: SeedPhase, fn: () => Promise<T>) => {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      ms[name] = Math.round(performance.now() - t0);
    }
  };

  const days: Day[] = [];
  await phase("generate", async () => {
    onProgress({ phase: "generate", done: 0, total: SEED_DAYS });
    for (let i = 0; i < SEED_DAYS; i += GENERATE_CHUNK) {
      for (let k = i; k < Math.min(SEED_DAYS, i + GENERATE_CHUNK); k++) days.push(generateDay(ctx, k));
      onProgress({ phase: "generate", done: days.length, total: SEED_DAYS });
      await yieldToUi();
    }
  });

  // One transaction: a failure (or the app being killed) leaves the database empty, so a retry is not refused.
  let rows = 0;
  await phase("write", () =>
    store.transaction(async (tx) => {
      onProgress({ phase: "write", done: 0, total: days.length });
      for (let i = 0; i < days.length; i += WRITE_CHUNK) {
        rows += await writeDays(tx, days.slice(i, i + WRITE_CHUNK), now);
        onProgress({ phase: "write", done: Math.min(days.length, i + WRITE_CHUNK), total: days.length });
        await yieldToUi();
      }
      rows += await seedHeartRhythm(tx, ctx.anchor, ctx.timeZone, now);
    }),
  );

  await phase("score", async () => {
    onProgress({ phase: "score", done: 0, total: 1 });
    await yieldToUi();
    await recompute(timeSliced(store), { timeZone: profile.timeZone, profile });
    onProgress({ phase: "score", done: 1, total: 1 });
  });
  dataChanged();
  return { days: days.length, rows, ms };
}
