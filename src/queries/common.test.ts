// The shared loaders on the scored F2 database. Pulse's own common.test.ts checks stress and strain charts; those come
// with the health and strain queries.
import { beforeAll, describe, expect, it } from "vitest";
import { canon } from "../testing/canonical";
import { loadF3 } from "../testing/fixtures";
import { ctxOf, firstDay, loadDays, loadSeries, type QueryCtx, recoveryMetric, todayOf } from "./common";
import { seededCtx } from "./testing";

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
}, 120_000);

describe("query loaders", () => {
  it("loadDays returns every day in the range with the stored scores and metrics", async () => {
    const f3 = loadF3();
    const days = f3.daily_scores.map((r) => r.day as string);
    const [first, last] = [days[0], days[days.length - 1]];
    expect(await firstDay(ctx)).toBe(first);
    const rows = await loadDays(ctx, first, last);
    expect(rows.size).toBe(days.length);
    const mid = days[90];
    const row = rows.get(mid)!;
    expect(row.recovery).not.toBeNull();
    expect(row.metrics?.day).toBe(mid);
    // F3 is canonical (10 significant digits), so compare canonically.
    expect(canon(recoveryMetric(row, false).value)).toBe((f3.daily_scores[90].recovery as { value: number }).value);
  });

  it("days without rows come back empty, and series read back per kind", async () => {
    const rows = await loadDays(ctx, "2000-01-01", "2000-01-02");
    expect([...rows.values()].map((r) => [r.day, r.recovery, r.metrics, r.activities])).toEqual([
      ["2000-01-01", null, null, []],
      ["2000-01-02", null, null, []],
    ]);
    const day = (await firstDay(ctx))!;
    expect((await loadSeries(ctx, day, "hr"))?.length).toBe(1440);
    expect(await loadSeries(ctx, "2000-01-01", "hr")).toBeNull();
  });

  it("ctxOf reads the saved profile; todayOf is the local day of now", async () => {
    const c = await ctxOf(ctx.store, ctx.now);
    expect(c.profile).toEqual(ctx.profile);
    expect(todayOf(c)).toBe(new Date((ctx.now + 5.5 * 3600) * 1000).toISOString().slice(0, 10));
  });
});
