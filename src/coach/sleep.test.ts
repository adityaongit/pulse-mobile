import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { Profile } from "@/data/types";
import { runPipeline } from "@/pipeline";
import type { QueryCtx } from "@/queries/ctx";

import { createSleepGlance } from "./sleep";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } };

let ctx: QueryCtx;
beforeAll(async () => {
  const store = new MemoryStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  await runPipeline(store, PROFILE, { today: TODAY });
  ctx = { store, profile: PROFILE, timeZone: TZ, today: TODAY, now: NOW, sync: await store.getSyncState() };
});

describe("sleep analysis", () => {
  it("pins the wake-up date and reuses matching requests, but refreshes when notes change", async () => {
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({ doGenerate: async ({ prompt }) => {
      prompts.push(JSON.stringify(prompt));
      return { content: [{ type: "text", text: " A steady night. " }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    } });
    const glance = createSleepGlance();
    const deps = { ctx: () => ctx, model: async () => ({ model, provider: "openai", instructions: null as string | null }), allow: () => true };
    const night = "2026-10-01";
    expect(await Promise.all([glance(deps, night), glance(deps, night)])).toEqual(["A steady night.", "A steady night."]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(night);
    expect(prompts[0]).toContain("asleepMinutes");
    expect(prompts[0]).toContain("wake-up date");
    await glance({ ...deps, model: async () => ({ model, provider: "openai", instructions: "Be concise" }) }, night);
    expect(prompts).toHaveLength(2);
    await glance(deps, "2026-09-30");
    expect(prompts).toHaveLength(3);
    const row = (await ctx.store.getScores(night))!;
    await ctx.store.putScores({ ...row, sleep_planner: { ...row.sleep_planner!, needMin: row.sleep_planner!.needMin + 30 } });
    await glance(deps, night);
    expect(prompts).toHaveLength(3);
    await ctx.store.putScores(row);
    const main = row.sleep!.main!;
    await ctx.store.putScores({ ...row, sleep: { ...row.sleep!, main: { ...main, asleepMin: main.asleepMin - 30 } } });
    await glance(deps, night);
    expect(prompts).toHaveLength(4);
    await ctx.store.putScores(row);
    await glance({ ...deps, model: async () => ({ model, provider: "openai", instructions: null, cacheKey: "another-server" }) }, night);
    expect(prompts).toHaveLength(5);
  });

  it("does not analyze absent sleep and retries a failed provider request", async () => {
    const glance = createSleepGlance();
    let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      calls++;
      if (calls === 1) throw new Error("offline");
      return { content: [{ type: "text", text: "Try again worked." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    } });
    const deps = { ctx: () => ctx, model: async () => ({ model, provider: "openai", instructions: null }), allow: () => true };
    await expect(glance(deps, "2020-01-01")).rejects.toThrow("not_found");
    expect(calls).toBe(0);
    await expect(glance(deps, "2026-10-01")).rejects.toThrow("provider");
    expect(await glance(deps, "2026-10-01")).toBe("Try again worked.");
  });
});
