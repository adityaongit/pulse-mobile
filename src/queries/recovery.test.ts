// Recovery's rows, insight and behaviour chips (spec §11 R34), and F6's getRecovery on every day it recorded.
import { beforeAll, describe, expect, it } from "vitest";
import { BEHAVIOR_LABEL } from "@/core/algorithms/behaviorChips";
import type { QueryCtx } from "./common";
import { getRecovery, screenInsight } from "./recovery";
import { expectF6, f6Days, seededCtx } from "./testing";

const ANCHOR = "2026-04-06";
const dayAt = (i: number) => new Date(Date.parse(ANCHOR) + i * 86_400_000).toISOString().slice(0, 10);

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
}, 120_000);

describe("getRecovery", () => {
  it("shows the reference app's four rows against the last 30 days, each opening its Trend View", async () => {
    const vm = await getRecovery(ctx, dayAt(150));
    expect(vm.summary.map((s) => s.key)).toEqual(["hrv", "rhr", "resp", "sleep"]);
    expect(vm.summary.map((s) => s.href)).toEqual(["/trend/hrv", "/trend/rhr", "/trend/resp", "/trend/sleep"]);
    expect(vm.summary.map((s) => s.unit ?? null)).toEqual([null, null, null, "%"]);
    expect(vm.summary.find((s) => s.key === "resp")!.direction).toBe("down");
    for (const s of vm.summary) expect(s.average).not.toBeNull();
    expect(vm.contributors.map((c) => c.key)).toContain("skinTemp");
  });

  it("words the insight around one input and the band", async () => {
    const vm = await getRecovery(ctx, dayAt(150));
    expect(vm.insight).toMatch(/^Your .+ \(.+\) is (within|above|below) its typical range of .+ to .+, which contributed to a (green|yellow|red) Recovery\. /);
  });

  it("lists yesterday's behaviours as chips with a known label and tone", async () => {
    const vm = await getRecovery(ctx, dayAt(150));
    for (const c of vm.behaviors) {
      expect(BEHAVIOR_LABEL[c.key]).toBe(c.label);
      expect(["up", "down", "neutral"]).toContain(c.effect);
    }
  });

  it("reproduces F6 on every day", async () => {
    for (const day of f6Days()) expectF6("getRecovery", day, await getRecovery(ctx, day));
  });
});

describe("screenInsight", () => {
  it("falls back to the band when no input has a baseline", () => {
    expect(screenInsight([], 80)).toBe("Your Recovery is green. Your body is primed to take on strain today.");
  });
});
