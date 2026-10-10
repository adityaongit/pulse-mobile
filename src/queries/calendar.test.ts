import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "../time";
import { getCalendarMonth } from "./calendar";
import type { QueryCtx } from "./common";
import { getHome } from "./home";
import { seededCtx } from "./testing";

const dayAt = (i: number) => addDays("2026-04-06", i);

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
}, 120_000);

describe("getCalendarMonth", () => {
  it("returns every day of the month with the Home dials' values", async () => {
    const vm = await getCalendarMonth(ctx, "2026-09");
    expect(vm.month).toBe("2026-09");
    expect(vm.days).toHaveLength(30);
    expect(vm.days[0].day).toBe("2026-09-01");
    expect(vm.days.at(-1)!.day).toBe("2026-09-30");
    const day = dayAt(170);
    const { dials } = await getHome(ctx, day);
    const row = vm.days.find((x) => x.day === day)!;
    expect(row.recovery).toBe(dials.recovery.value);
    expect(row.strain).toBe(dials.strain.value);
    expect(row.sleep).toBe(dials.sleep.value);
    expect(vm.days.filter((x) => x.recovery !== null).length).toBeGreaterThan(20);
    const strains = vm.days.flatMap((x) => (x.strain === null ? [] : [x.strain]));
    expect(Math.min(...strains)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...strains)).toBeLessThanOrEqual(21);
  });
  it("has nulls before the first stored day and after today", async () => {
    expect((await getCalendarMonth(ctx, "2026-03")).days.every((x) => x.recovery === null && x.strain === null && x.sleep === null)).toBe(true);
    const oct = (await getCalendarMonth(ctx, "2026-10")).days;
    expect(oct).toHaveLength(31);
    expect(oct.slice(2).every((x) => x.recovery === null && x.strain === null)).toBe(true);
  });
  it("rejects a malformed month", async () => {
    await expect(getCalendarMonth(ctx, "2026-13")).rejects.toThrow();
    await expect(getCalendarMonth(ctx, "2026-9")).rejects.toThrow();
  });
});
