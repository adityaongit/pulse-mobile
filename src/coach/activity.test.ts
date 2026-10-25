import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { Profile } from "@/data/types";
import { runPipeline } from "@/pipeline";
import type { QueryCtx } from "@/queries/ctx";
import { activityFacts, createActivityGlance } from "./activity";

const TODAY = "2026-10-02";
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: "Asia/Kolkata" };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } };
let ctx: QueryCtx;
beforeAll(async () => {
  const store = new MemoryStore();
  const now = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
  await seedDemo(store, { today: TODAY, timeZone: PROFILE.timeZone, now });
  await runPipeline(store, PROFILE, { today: TODAY });
  await store.upsertExercises([{ id: "archery-1", day: TODAY, startTs: now - 3600, endTs: now - 1800, type: "ARCHERY", name: "Afternoon archery", calories: null, distanceM: null }]);
  await store.upsertExercises([{ id: "walk-1", day: TODAY, startTs: now - 3600, endTs: now - 1800, type: "WALKING", name: "Selected walk", calories: null, distanceM: null }]);
  const windowSteps = await store.readSteps(now - 3600, now - 1800);
  await store.putSteps(windowSteps.map((sample) => ({ ...sample, v: 0 })));
  await store.putSteps([{ ts: now - 3500, v: 123 }]);
  await store.upsertSessions([{ id: "nap-1", day: TODAY, startTs: now - 1800, endTs: now, isMain: false, processed: true, stagesStatus: null, asleepMin: 22, awakeMin: null, deepMin: null, lightMin: null, remMin: null }, { id: "nap-missing", day: TODAY, startTs: now - 1800, endTs: now, isMain: false, processed: true, stagesStatus: null, asleepMin: null, awakeMin: null, deepMin: null, lightMin: null, remMin: null }], []);
  await store.upsertSessions([{ id: "nap-no-hr", day: "2020-01-01", startTs: 1577880000, endTs: 1577881800, isMain: false, processed: true, stagesStatus: null, asleepMin: 20, awakeMin: null, deepMin: null, lightMin: null, remMin: null }], []);
  const napHr = await store.readHr(now - 1800, now);
  await store.putHr(napHr.map((sample) => ({ ...sample, bpm: 60 })));
  await store.putHr([...Array.from({ length: 30 }, (_, i) => ({ ts: now - 1800 + i * 60 + 1, bpm: 60 })), { ts: now - 1830, bpm: 180 }, { ts: now + 30, bpm: 190 }]);
  ctx = { store, profile: PROFILE, timeZone: PROFILE.timeZone, today: TODAY, now, sync: await store.getSyncState() };
});

describe("shared activity analysis", () => {
  it("reads the exact workout, night or nap without mixing their data", async () => {
    const workout = JSON.stringify(await activityFacts(ctx, { kind: "workout", id: "archery-1" }));
    expect(workout).toContain("archery-1");
    expect(workout).toContain("Afternoon archery");
    expect(await activityFacts(ctx, { kind: "workout", id: "walk-1" })).toMatchObject({ workout: { steps: { value: 123 }, strainAverage: expect.any(Number) } });
    const sleep = await activityFacts(ctx, { kind: "sleep", id: "2026-10-01" });
    expect(sleep).toMatchObject({ kind: "sleep", day: "2026-10-01" });
    expect(sleep).not.toHaveProperty("planner");
    const nap = await activityFacts(ctx, { kind: "nap", id: "nap-1" });
    expect(nap).toMatchObject({ kind: "nap", id: "nap-1", day: TODAY, durationMinutes: 30, asleepMinutes: { value: 22 }, stages: null });
    expect(nap).toMatchObject({ heartRate: { value: { averageBpm: 60, minimumBpm: 60, maximumBpm: 60 } } });
    expect(nap).not.toHaveProperty("heartRate.value.points");
    expect(await activityFacts(ctx, { kind: "nap", id: "nap-missing" })).toMatchObject({ asleepMinutes: { value: null } });
    expect(await activityFacts(ctx, { kind: "nap", id: "nap-no-hr" })).toMatchObject({ heartRate: { value: null, reason: "insufficient_hr_data" } });
    expect(await activityFacts(ctx, { kind: "nap", id: "unknown" })).toBeNull();
  });

  it("shares in-flight requests and refreshes on changed context or source data", async () => {
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({ doGenerate: async ({ prompt }) => {
      prompts.push(JSON.stringify(prompt));
      return { content: [{ type: "text", text: " A useful observation. " }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    } });
    const glance = createActivityGlance();
    const deps = { ctx: () => ctx, model: async () => ({ model, provider: "openai", instructions: null }), allow: () => true };
    const nap = { kind: "nap", id: "nap-1" } as const;
    expect(await Promise.all([glance(deps, nap), glance(deps, nap)])).toEqual(["A useful observation.", "A useful observation."]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("nap-1");
    await glance(deps, { kind: "workout", id: "archery-1" });
    expect(prompts).toHaveLength(2);
    await glance({ ...deps, model: async () => ({ model, provider: "openai", instructions: null, cacheKey: "other-server" }) }, nap);
    expect(prompts).toHaveLength(3);
    const session = (await ctx.store.allSessions()).find((s) => s.id === "nap-1")!;
    await ctx.store.upsertSessions([{ ...session, asleepMin: 20 }], []);
    await glance(deps, nap);
    expect(prompts).toHaveLength(4);
    await ctx.store.upsertSessions([session], []);
  });

  it("does not request absent data, respects the guard and permits retry after failure", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      calls++;
      if (calls === 1) throw new Error("offline");
      return { content: [{ type: "text", text: "Worked." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    } });
    const glance = createActivityGlance();
    const deps = { ctx: () => ctx, model: async () => ({ model, provider: "openai", instructions: null }), allow: () => true };
    const activity = { kind: "nap", id: "nap-1" } as const;
    await expect(glance(deps, { kind: "nap", id: "unknown" })).rejects.toThrow("not_found");
    await expect(glance({ ...deps, allow: () => false }, activity)).rejects.toThrow("limit");
    expect(calls).toBe(0);
    await expect(glance(deps, activity)).rejects.toThrow("provider");
    expect(await glance(deps, activity)).toBe("Worked.");
  });
});
