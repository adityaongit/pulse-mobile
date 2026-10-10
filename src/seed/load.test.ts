import { beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../data/testing";
import { addDays, localDay } from "../time";
import { loadDemoData, NOT_EMPTY, type SeedProgress, type SeedResult } from "./load";
import { SEED_DAYS } from "./scenario";

const h = vi.hoisted(() => ({ changed: vi.fn() }));
vi.mock("../screens/useScreen", () => ({ dataChanged: h.changed }));

const TZ = "Asia/Kolkata";
/** Friday 14:00, after wake. */
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const TODAY = "2026-10-02";
const FIRST = addDays(TODAY, 1 - SEED_DAYS);

const t = testDb();
const progress: SeedProgress[] = [];
let result: SeedResult;
let changedAtEnd = 0;

beforeAll(async () => {
  result = await loadDemoData(t.store, { now: NOW, timeZone: TZ, onProgress: (p) => progress.push(p) });
  changedAtEnd = h.changed.mock.calls.length;
}, 120_000);

describe("loadDemoData", () => {
  it("saves the demo profile in the given zone and the default journal tags", async () => {
    expect(await t.store.profile.getProfileRow()).toMatchObject({ birthDate: "1990-01-01", sex: "male", timeZone: TZ });
    expect((await t.store.journal.tags()).map((x) => x.tag)).toHaveLength(9);
  });

  it("fills 180 days ending at now, with nothing after it", async () => {
    const days = (await t.store.daily.readMetrics()).map((m) => m.day);
    expect(days).toHaveLength(SEED_DAYS);
    expect([days[0], days.at(-1)]).toEqual([FIRST, TODAY]);
    const hr = await t.store.samples.readSamples("hr", 0, 4_000_000_000);
    expect(hr.at(-1)!.ts).toBeLessThan(NOW);
    const steps = await t.store.samples.readSamples("steps", 0, 4_000_000_000);
    expect(steps.at(-1)!.ts + 60).toBeLessThanOrEqual(NOW);
    for (const r of t.sqlite.prepare("select end_ts e, start_ts s from sleep_sessions union all select end_ts, start_ts from exercises").all() as { e: number; s: number }[]) expect(r.e).toBeLessThanOrEqual(NOW);
    expect((t.sqlite.prepare("select max(ts) m from health_records").get() as { m: number }).m).toBeLessThanOrEqual(NOW);
    expect(localDay(NOW, TZ)).toBe(TODAY);
  });

  it("scores the days: a daily_scores row for every day with data", async () => {
    const scored = new Set((await t.store.scores.readDays("0000-01-01", "9999-12-31")).map((r) => r.day));
    const withData = (await t.store.daily.readMetrics()).map((m) => m.day);
    expect(withData.filter((d) => !scored.has(d))).toEqual([]);
    expect(await t.store.scores.dirtyDays()).toEqual([]);
  });

  it("reports progress in order: generate, then write, then score, each ending at its total", () => {
    const order = progress.map((p) => p.phase);
    expect([...new Set(order)]).toEqual(["generate", "write", "score"]);
    expect([...order].sort((a, b) => ["generate", "write", "score"].indexOf(a) - ["generate", "write", "score"].indexOf(b))).toEqual(order);
    for (const phase of ["generate", "write", "score"] as const) {
      const ps = progress.filter((p) => p.phase === phase);
      expect(ps.map((p) => p.done)).toEqual([...ps.map((p) => p.done)].sort((a, b) => a - b));
      expect(ps.at(-1)).toMatchObject({ done: ps[0].total, total: ps[0].total });
    }
    expect(progress.filter((p) => p.phase === "generate").at(-1)!.total).toBe(SEED_DAYS);
  });

  it("returns the days, rows written and the time each phase took, and tells the screens", () => {
    expect(result.days).toBe(SEED_DAYS);
    expect(result.rows).toBeGreaterThan(0);
    for (const ms of Object.values(result.ms)) expect(ms).toBeGreaterThan(0);
    expect(changedAtEnd).toBe(1);
    console.info(`[seed] 180 days: generate ${result.ms.generate} ms, write ${result.ms.write} ms, score ${result.ms.score} ms`);
  });

  it("refuses a second load, and leaves the data as it was", async () => {
    const before = (await t.store.daily.readMetrics()).length;
    await expect(loadDemoData(t.store, { now: NOW, timeZone: TZ })).rejects.toThrow(NOT_EMPTY);
    expect((await t.store.daily.readMetrics()).length).toBe(before);
  });

  it("a failed write rolls back, so the retry is not refused", async () => {
    const f = testDb();
    const boom = vi.spyOn(f.store.daily, "upsertDailyMetrics").mockRejectedValueOnce(new Error("disk full"));
    await expect(loadDemoData(f.store, { now: NOW, timeZone: TZ })).rejects.toThrow("disk full");
    boom.mockRestore();
    expect(await f.store.samples.hasHr()).toBe(false);
  }, 120_000);
});
