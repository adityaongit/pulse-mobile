// Pulse has no test for src/server/queries/reports.ts; this one checks the port on the scored F2 database.
import { beforeAll, describe, expect, it } from "vitest";
import type { QueryCtx } from "./common";
import { latestReport } from "./home";
import { getReport, getReportArchive } from "./reports";
import { seededCtx } from "./testing";

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
}, 120_000);

describe("reports", () => {
  it("the archive lists weeks and months with data, newest first", async () => {
    const a = await getReportArchive(ctx);
    expect(a.weeks.length).toBeGreaterThan(10);
    expect(a.months.length).toBeGreaterThan(3);
    expect(a.weeks.map((w) => w.period)).toEqual([...a.weeks.map((w) => w.period)].sort().reverse());
    for (const w of a.weeks) expect(w.period).toMatch(/^\d{4}-W\d{2}$/);
    for (const m of a.months) expect(m.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it("a week's report has the three dials, the seven averages, and neighbours that point back to it", async () => {
    const { weeks } = await getReportArchive(ctx);
    const mid = weeks[Math.floor(weeks.length / 2)].period;
    const r = (await getReport(mid, ctx))!;
    expect(r.kind).toBe("week");
    expect(r.dials.map((d) => d.key)).toEqual(["sleep", "recovery", "strain"]);
    expect(r.averages.map((s) => s.key)).toEqual(["recovery", "strain", "sleepPerf", "sleepHours", "consistency", "hrv", "rhr"]);
    expect((await getReport(r.prev!, ctx))!.next).toBe(mid);
    expect((await getReport(r.next!, ctx))!.prev).toBe(mid);
  });

  it("a period without data is null, and the latest finished report is not partial", async () => {
    expect(await getReport("1999-W01", ctx)).toBeNull();
    const w = (await latestReport(ctx, "week"))!;
    const a = await getReportArchive(ctx);
    expect(a.weeks.find((x) => x.period === w.period)!.partial).toBe(false);
  });
});
