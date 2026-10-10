// A second scored database for the tests that change data (a trimmed seed, a pinned roll-up, a wiped night), so the
// shared `seededCtx()` stays read-only for F6. Same recipe as `seededCtx()` in testing.ts: the F2 seed, the profile, a
// full recompute. `tweak` edits F2's input tables first; `now` moves the clock (the morning before the night syncs).
import { testDb } from "../data/testing";
import { recompute } from "../pipeline";
import { loadSeed } from "../pipeline/testing/memoryStore";
import { saveProfile } from "../profile";
import { loadF2, loadF6, type Tables } from "../testing/fixtures";
import type { QueryCtx } from "./common";

/**
 * F2's `daily_values` (distance, floors, active minutes, water…): the shown-only roll-ups Home's My Dashboard reads.
 * pipeline/testing `loadSeed` does not write that table (the scores never read it), so a query test that compares
 * with F6 writes them here. Call once on a fresh context.
 */
export async function withDailyValues<T extends QueryCtx>(ctx: T, tables: Tables = loadF2().tables): Promise<T> {
  await ctx.store.daily.upsertDailyValues((tables.daily_values ?? []).map((r) => ({ day: r.day as string, key: r.key as string, value: r.value as number })));
  return ctx;
}

export async function scratchCtx({ tweak, now }: { tweak?: (t: Tables) => Tables; now?: number } = {}): Promise<QueryCtx> {
  const f2 = loadF2();
  const { ctx } = loadF6();
  const { store } = testDb();
  await loadSeed(store, { tables: tweak ? tweak(f2.tables) : f2.tables });
  const { birthDate, sex, maxHr, maxHrSource, heightCm, timeZone } = ctx.profile;
  await saveProfile(store, { birthDate, sex, maxHr: maxHrSource === "set" ? maxHr : null, heightCm, timeZone });
  await recompute(store, { timeZone, profile: ctx.profile });
  return withDailyValues({ store, timeZone, profile: ctx.profile, now: now ?? ctx.now }, tweak ? tweak(f2.tables) : f2.tables);
}

/** Friday 05:00 in Kolkata: before the night of 2026-10-02 has synced. */
export const BEFORE_WAKE = Date.parse("2026-10-02T05:00:00+05:30") / 1000;

/**
 * F2 as it was at BEFORE_WAKE as far as the night goes: the sleeps that end later and today's nightly readings are not
 * there yet. (Pulse seeded a second database at that time; heart rate and steps are left whole here.)
 */
export const morning = (t: Tables): Tables => {
  const late = new Set(t.sleep_sessions.filter((s) => (s.end_ts as number) > BEFORE_WAKE).map((s) => s.id));
  return {
    ...t,
    sleep_sessions: t.sleep_sessions.filter((s) => !late.has(s.id)),
    sleep_segments: t.sleep_segments.filter((g) => !late.has(g.session_id)),
    daily_metrics: t.daily_metrics.filter((m) => m.day !== "2026-10-02"),
  };
};
