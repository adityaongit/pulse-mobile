// The screen queries' test database, the counterpart of pulse's `seeded()` and `ctxFor()` (src/server/testing.ts):
// the F2 seed on the SQLite repositories, scored by the pipeline, with the context F6's view models were recorded at.
// Each test file builds it once (a full recompute of 180 days takes a few seconds).
import { expect } from "vitest";
import { testDb } from "../data/testing";
import { recompute } from "../pipeline";
import { loadSeed } from "../pipeline/testing/memoryStore";
import { saveProfile } from "../profile";
import { canon } from "../testing/canonical";
import { loadF2, loadF6 } from "../testing/fixtures";
import type { QueryCtx } from "./common";

let seeded: Promise<QueryCtx> | undefined;

/** The F2 database, recomputed, and F6's context (time zone, profile, `now`). Shared by every test in a file. */
export function seededCtx(): Promise<QueryCtx> {
  seeded ??= (async () => {
    const f2 = loadF2();
    const { ctx } = loadF6();
    const { store } = testDb();
    await loadSeed(store, f2);
    // loadSeed fills what the pipeline reads; the screens also read these (F6 was recorded with them in place).
    const t = f2.tables;
    await store.daily.upsertDailyValues(t.daily_values.map((r) => ({ day: r.day as string, key: r.key as string, value: r.value as number })));
    await store.daily.upsertHealthRecords(t.health_records.map((r) => ({ id: r.id as string, kind: r.kind as "ecg" | "irn", ts: r.ts as number, day: r.day as string, data: r.data })));
    // All nine are visible defaults (position 0); seq order is the order they were created in.
    const tags = [...t.journal_tags].sort((a, b) => (a.seq as number) - (b.seq as number));
    await store.journal.ensureDefaultTags(tags.map((r) => ({ tag: r.tag as string, label: r.label as string })));
    for (const r of t.sync_state)
      await store.settings.setSyncState(r.type as string, { syncedThrough: r.synced_through as number | null, backfillDaysDone: r.backfill_days_done as number | null, backfillDaysTotal: r.backfill_days_total as number | null, lastAttemptAt: r.last_attempt_at as number | null, lastSuccessAt: r.last_success_at as number | null, lastError: r.last_error as string | null });
    const { birthDate, sex, maxHr, maxHrSource, heightCm, timeZone } = ctx.profile;
    await saveProfile(store, { birthDate, sex, maxHr: maxHrSource === "set" ? maxHr : null, heightCm, timeZone });
    await recompute(store, { timeZone, profile: ctx.profile });
    return { store, timeZone, profile: ctx.profile, now: ctx.now };
  })();
  return seeded;
}

/** The F6 view model a query must reproduce, compared after canonical encoding (sorted keys, 10 significant digits). */
export function expectF6(query: string, day: string, got: unknown, key?: string) {
  const c = loadF6().cases.find((x) => x.query === query && x.day === day && x.key === key);
  if (!c) throw new Error(`no F6 case for ${query} ${key ?? ""} on ${day}`);
  expect(canon(JSON.parse(JSON.stringify(got)))).toEqual(c.value);
}

/** The days F6 recorded view models for. */
export const f6Days = () => loadF6().days;
