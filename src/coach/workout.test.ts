// The workout glance over the demo seed with a scripted model (no network), and the coach chats in the Store.
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import type { Profile } from "@/data/types";
import { runPipeline } from "@/pipeline";
import type { QueryCtx } from "@/queries/ctx";
import { coachTools } from "./tools";
import { createActivityGlance, type GlanceDeps } from "./activity";

const workoutGlance = (deps: GlanceDeps, id: string) => createActivityGlance()(deps, { kind: "workout", id });

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

describe("workout glance", () => {
  it("asks once with the glance wording and the workout's numbers, and returns the trimmed line", async () => {
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt, maxOutputTokens }) => {
        prompts.push(JSON.stringify(prompt));
        expect(maxOutputTokens).toBe(80);
        return { content: [{ type: "text", text: "  Harder than your usual ride.  " }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    });
    const list = await coachTools(ctx).get_activities.execute!({ days: 14 }, { toolCallId: "t", messages: [] } as never);
    const id = (list as { workouts: { id: string }[] }).workouts[0].id;
    const text = await workoutGlance({ ctx: () => ctx, model: async () => ({ model, provider: "anthropic", instructions: null }), allow: () => true }, id);
    expect(text).toBe("Harder than your usual ride.");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("one sentence of at most 20 words");
    expect(prompts[0]).toContain(id);
    expect(prompts[0]).toContain("strainAverage");
    expect(prompts[0]).toContain("You are Pulse's recovery and performance coach");
  });

  it("refuses without a model, past the limit, or for an unknown workout; a provider failure is 'provider'", async () => {
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("boom");
      },
    });
    const deps = { ctx: () => ctx, model: async () => ({ model: failing, provider: "openai", instructions: null }), allow: () => true };
    await expect(workoutGlance({ ...deps, model: async () => null }, "x")).rejects.toThrow("key");
    await expect(workoutGlance(deps, "nope")).rejects.toThrow("not_found");
    const list = await coachTools(ctx).get_activities.execute!({ days: 14 }, { toolCallId: "t", messages: [] } as never);
    const id = (list as { workouts: { id: string }[] }).workouts[0].id;
    await expect(workoutGlance({ ...deps, allow: () => false }, id)).rejects.toThrow("limit");
    await expect(workoutGlance(deps, id)).rejects.toThrow("provider");
  });
});

describe("coach chats in the store", () => {
  it("lists newest first with a cursor, upserts, counts and deletes", async () => {
    const s = new MemoryStore();
    await s.putCoachChat("a", "A", [{ id: "1" }], 10);
    await s.putCoachChat("b", "B", [], 20);
    await s.putCoachChat("c", "C", [], 20);
    expect((await s.coachChats(10)).map((c) => c.id)).toEqual(["c", "b", "a"]);
    expect((await s.coachChats(10, { updatedAt: 20, id: "c" })).map((c) => c.id)).toEqual(["b", "a"]);
    await s.putCoachChat("a", "A2", [{ id: "2" }], 30);
    expect(await s.coachChats(1)).toEqual([{ id: "a", title: "A2", updatedAt: 30 }]);
    expect(await s.coachChatMessages("a")).toEqual([{ id: "2" }]);
    await s.deleteCoachChats("a");
    expect(await s.coachChatCount()).toBe(2);
    expect(await s.coachChatMessages("a")).toBeNull();
    await s.deleteCoachChats();
    expect(await s.coachChatCount()).toBe(0);
  });
});
