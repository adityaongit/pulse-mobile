// The /activities journal: day groups newest first, today always present, and "Show older".
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "../time";
import type { QueryCtx } from "./common";
import { getActivities } from "./activities";
import { seededCtx } from "./testing";

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
}, 120_000);

describe("getActivities", () => {
  it("groups the window's workouts by day, newest first, with today leading", async () => {
    const vm = await getActivities(ctx, 30);
    const days = vm.groups.map((g) => g.day);
    expect(days[0]).toBe(vm.today);
    expect([...days].sort().reverse()).toEqual(days);
    const n = (await ctx.store.sessions.exercisesBetween(addDays(vm.today, -29), vm.today)).length;
    expect(vm.groups.reduce((a, g) => a + g.items.length, 0)).toBe(n);
    for (const g of vm.groups) for (const a of g.items) expect(a.day).toBe(g.day);
    expect(vm.older).toBe(true);
  });

  it("has nothing older once the window covers every workout", async () => {
    expect((await getActivities(ctx, 3650)).older).toBe(false);
  });
});
