// The in-process chat turn (the web's route, run on the phone): a scripted model calls a tool, then answers; the UI
// stream carries the tool card and the text; the chat is saved; problems surface as the codes the screen maps.
import { readUIMessageStream, simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/data/memory";
import type { Profile } from "@/data/types";
import type { QueryCtx } from "@/queries/ctx";
import { fingerprint } from "./history";
import { coachTurn, rateGuard, streamProblem, type CoachDeps } from "./transport";

const TZ = "Asia/Kolkata";
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
const ctx: QueryCtx = { store: new MemoryStore(), profile: PROFILE, timeZone: TZ, today: "2026-10-02", now: Date.parse("2026-10-02T14:00:00+05:30") / 1000, sync: { lastSyncTs: null, firstDay: null, lastError: null } };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } };
const user = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });

/** First step calls get_profile, the next answers in two text deltas. Records each step's prompt. */
function scripted() {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: "text", text: "summary" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }),
    doStream: async ({ prompt }) => {
      prompts.push(prompt);
      const toolDone = prompt.some((m) => m.role === "tool");
      const chunks = toolDone
        ? [
            { type: "text-start" as const, id: "t1" },
            { type: "text-delta" as const, id: "t1", delta: "You are **36**." },
            { type: "text-delta" as const, id: "t1", delta: " Keep it easy." },
            { type: "text-end" as const, id: "t1" },
            { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
          ]
        : [
            { type: "tool-call" as const, toolCallId: "call-1", toolName: "get_profile", input: "{}" },
            { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
          ];
      return { stream: simulateReadableStream({ chunks: chunks as never[], chunkDelayInMs: null }) };
    },
  });
  return { model, prompts };
}

function deps(over: Partial<CoachDeps> = {}): CoachDeps & { saved: Map<string, UIMessage[]> } {
  const saved = new Map<string, UIMessage[]>();
  const { model } = scripted();
  return {
    saved,
    ctx: () => ctx,
    model: async () => ({ model, provider: "anthropic", instructions: "Short and direct." }),
    load: async (id) => saved.get(id) ?? null,
    save: async (id, m) => void saved.set(id, m),
    allow: () => true,
    ...over,
  };
}

async function last(stream: ReadableStream<never> | ReadableStream<unknown>) {
  let message: UIMessage | undefined;
  for await (const m of readUIMessageStream({ stream: stream as never })) message = m as UIMessage;
  return message!;
}

describe("coach turn", () => {
  it("keeps the selected workout in context on the first turn and saved follow-ups", async () => {
    const store = new MemoryStore();
    await store.upsertExercises([
      { id: "selected-ride", day: ctx.today, startTs: ctx.now - 3600, endTs: ctx.now - 1800, type: "BIKING", name: "Selected ride", calories: 250, distanceM: 8000 },
      { id: "other-ride", day: ctx.today, startTs: ctx.now - 7200, endTs: ctx.now - 5400, type: "BIKING", name: "Other ride", calories: 200, distanceM: 7000 },
    ]);
    const { model, prompts } = scripted();
    const d = deps({ ctx: () => ({ ...ctx, store }), model: async () => ({ model, provider: "anthropic", instructions: null }) });
    const first = { ...user("selected-question", "Analyze this workout"), metadata: { workoutId: "selected-ride" } };
    await last(await coachTurn(d, "selected-chat", [first]));
    expect(JSON.stringify(prompts[0])).toContain("selected-ride");
    expect(JSON.stringify(prompts[0])).not.toContain("other-ride");
    const saved = d.saved.get("selected-chat")!;
    await last(await coachTurn(d, "selected-chat", [...saved.map((m) => ({ ...m, metadata: undefined })), user("follow-up", "And my heart rate?")]));
    expect(JSON.stringify(prompts.at(-1))).toContain("selected-ride");
  });

  it("streams a tool card then the answer, and saves the whole chat", async () => {
    const { model, prompts } = scripted();
    const d = deps({ model: async () => ({ model, provider: "anthropic", instructions: "Short and direct." }) });
    const answer = await last(await coachTurn(d, "chat-0001", [user("u1", "How old am I?")]));
    expect(answer.role).toBe("assistant");
    const tool = answer.parts.find((p) => p.type === "tool-get_profile") as { state: string; output: { age: number } };
    expect(tool.state).toBe("output-available");
    expect(tool.output.age).toBe(36);
    expect(answer.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")).toBe("You are **36**. Keep it easy.");

    const saved = d.saved.get("chat-0001")!;
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(saved[1].id).toBe(answer.id);
    // The instructions carry today in the person's zone and their notes as preferences.
    const system = JSON.stringify(prompts[0]);
    expect(system).toContain("Today is 2026-10-02 in the user's time zone (Asia/Kolkata)");
    expect(system).toContain("<user_notes>\\nShort and direct.\\n</user_notes>");
  });

  it("refuses before calling the provider: per-minute limit, no key, no profile, no question", async () => {
    await expect(coachTurn(deps({ allow: () => false }), "chat-0001", [user("u1", "Hi")])).rejects.toThrow("limit");
    await expect(coachTurn(deps({ model: async () => null }), "chat-0001", [user("u1", "Hi")])).rejects.toThrow("key");
    await expect(coachTurn(deps({ ctx: () => null }), "chat-0001", [user("u1", "Hi")])).rejects.toThrow("profile");
    const answerLast: UIMessage[] = [user("u1", "Hi"), { id: "a1", role: "assistant", parts: [{ type: "text", text: "Hello" }] }];
    await expect(coachTurn(deps(), "chat-0001", answerLast)).rejects.toThrow("bad_request");
  });

  it("a provider failure mid-stream becomes the 'provider' error, a network failure 'network'", async () => {
    const failing = (error: unknown) =>
      new MockLanguageModelV4({
        doStream: async () => {
          throw error;
        },
      });
    const errorText = async (error: unknown) => {
      const stream = await coachTurn(deps({ model: async () => ({ model: failing(error), provider: "openai", instructions: null }) }), "chat-0002", [user("u1", "Hi")]);
      const reader = stream.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return null;
        if (value.type === "error") return value.errorText;
      }
    };
    const { APICallError } = await import("ai");
    expect(await errorText(new APICallError({ message: "Unauthorized", url: "https://api.openai.com/v1/responses", requestBodyValues: {}, statusCode: 401, responseBody: "secret echo" }))).toBe("provider");
    expect(await errorText(new TypeError("Network request failed"))).toBe("network");
    expect(streamProblem(new Error("x"))).toBe("provider");
  });

  it("carries the saved summary checkpoint forward, so a long chat is not summarised again every turn", async () => {
    const generate = vi.fn(async () => ({ content: [{ type: "text" as const, text: "They prefer cycling." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] }));
    const { model } = scripted();
    const counting = new MockLanguageModelV4({ doGenerate: generate, doStream: (o) => model.doStream(o) });
    const d = deps({ model: async () => ({ model: counting, provider: "anthropic", instructions: null }) });
    const long: UIMessage[] = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", parts: [{ type: "text", text: `Turn ${i}` }] }));
    const ask = [...long, user("m40", "And today?")];
    await last(await coachTurn(d, "chat-long", ask));
    expect(generate).toHaveBeenCalledTimes(1);
    const saved = d.saved.get("chat-long")!;
    const checkpoint = (saved[0].metadata as { coachSummary: { count: number; hash: string } }).coachSummary;
    expect(checkpoint.hash).toBe(fingerprint(saved.slice(0, checkpoint.count)));
    // useChat holds the messages without the metadata; the transport takes it from the saved chat.
    const next = [...saved.map((m) => ({ ...m, metadata: undefined })), user("m42", "Thanks")];
    await last(await coachTurn(d, "chat-long", next));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("the per-minute guard allows ten requests a minute", () => {
    const allow = rateGuard();
    for (let i = 0; i < 10; i++) expect(allow(1000 + i)).toBe(true);
    expect(allow(2000)).toBe(false);
    expect(allow(61_001)).toBe(true);
  });
});
