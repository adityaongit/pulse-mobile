// The providers as the phone uses them: the real AI SDK clients with the app's fetch injected (expo/fetch on the
// device). Each test answers with a recorded-shape SSE fixture, split at awkward byte boundaries the way a network
// delivers it, and checks the request (endpoint, auth header, tools) and that the tool runs and the text streams.
// No network.
import { isStepCount, streamText, type ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import type { Profile } from "@/data/types";
import type { QueryCtx } from "@/queries/ctx";
import { coachReady, modelFor, PROVIDERS, providerOf, type Fetch } from "./providers";
import { coachTools } from "./tools";
import { checkProvider, testKey, TEST_FAILED } from "./validate";

const TZ = "Asia/Kolkata";
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
const ctx: QueryCtx = { store: new MemoryStore(), profile: PROFILE, timeZone: TZ, today: "2026-10-02", now: Date.parse("2026-10-02T14:00:00+05:30") / 1000, sync: { lastSyncTs: null, firstDay: null, lastError: null } };
const KEY = "sk-test-key-0000";

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** A body that arrives in uneven pieces (an SSE event split mid-line), as a ReadableStream. */
function chunked(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(c) {
      if (at >= bytes.length) return c.close();
      const n = 7 + (at % 13);
      c.enqueue(bytes.slice(at, at + n));
      at += n;
    },
  });
}

/** Answers the i-th request with `bodies[i]` as an event stream (or a JSON error), recording what was sent. */
function fakeFetch(bodies: (string | { status: number; json: unknown })[]) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: String(input), headers, body: JSON.parse(String(init?.body ?? "{}")) });
    const b = bodies[calls.length - 1];
    if (b === undefined) throw new Error("unexpected request");
    if (typeof b !== "string") return new Response(JSON.stringify(b.json), { status: b.status, headers: { "content-type": "application/json" } });
    return new Response(chunked(b), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as Fetch;
  return { fetch, calls };
}

const sse = (events: [string | null, unknown][]) => events.map(([event, data]) => `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`).join("");

const ANTHROPIC_TOOL = sse([
  ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 1 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "get_profile", input: {} } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 9 } }],
  ["message_stop", { type: "message_stop" }],
]);
const ANTHROPIC_TEXT = sse([
  ["message_start", { type: "message_start", message: { id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 60, output_tokens: 1 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "You’re 36, " } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "so **easy** today." } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } }],
  ["message_stop", { type: "message_stop" }],
]);

const chunk = (delta: unknown, finish: string | null = null, extra: object = {}) => ({ id: "c1", object: "chat.completion.chunk", created: 1, model: "anthropic/claude-sonnet-5.5", choices: [{ index: 0, delta, finish_reason: finish }], ...extra });
const OPENAI_COMPAT_TOOL = sse([
  [null, chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_profile", arguments: "" } }] })],
  [null, chunk({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] })],
  [null, chunk({}, "tool_calls", { usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } })],
  [null, "[DONE]"],
]);
const OPENAI_COMPAT_TEXT = sse([
  [null, chunk({ role: "assistant", content: "You’re 36, " })],
  [null, chunk({ content: "so **easy** today." })],
  [null, chunk({}, "stop", { usage: { prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 } })],
  [null, "[DONE]"],
]);

async function run(provider: string, model: string, fetch: Fetch, choice: { apiKey?: string | null; baseUrl?: string } = {}) {
  const m = modelFor({ provider, model, apiKey: KEY, ...choice }, fetch)!;
  const tools = coachTools(ctx) as ToolSet;
  const result = streamText({ model: m, instructions: "Coach.", prompt: "How old am I?", tools, stopWhen: isStepCount(6), maxRetries: 0 });
  let text = "";
  const toolResults: unknown[] = [];
  for await (const part of result.stream) {
    if (part.type === "text-delta") text += part.text;
    if (part.type === "tool-result") toolResults.push(part.output);
    if (part.type === "error") throw part.error;
  }
  return { text, toolResults };
}

describe("providers", () => {
  it("lists the web's five providers and the person's own server, Anthropic defaulting to the current Claude model", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["anthropic", "openai", "google", "gateway", "openrouter", "custom"]);
    expect(providerOf("anthropic")?.model).toBe("claude-opus-5-5");
    expect(modelFor({ provider: "anthropic", model: "claude-opus-5-5", apiKey: null })).toBeNull();
    expect(modelFor({ provider: "nope", model: "x", apiKey: KEY })).toBeNull();
  });

  it("Anthropic: Messages API with the key header, a tool round trip, then streamed text", async () => {
    const { fetch, calls } = fakeFetch([ANTHROPIC_TOOL, ANTHROPIC_TEXT]);
    const r = await run("anthropic", "claude-opus-5-5", fetch);
    expect(r.text).toBe("You’re 36, so **easy** today.");
    expect(r.toolResults).toEqual([expect.objectContaining({ age: 36, sex: "male", maxHr: 183 })]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe(KEY);
    expect(calls[0].body).toMatchObject({ model: "claude-opus-5-5", stream: true });
    expect((calls[0].body.tools as { name: string }[]).map((t) => t.name)).toContain("get_profile");
    // The second request carries the tool result back.
    expect(JSON.stringify(calls[1].body.messages)).toContain("tool_result");
  });

  it("OpenRouter: OpenAI-compatible chat completions at its fixed URL with a bearer key", async () => {
    const { fetch, calls } = fakeFetch([OPENAI_COMPAT_TOOL, OPENAI_COMPAT_TEXT]);
    const r = await run("openrouter", "anthropic/claude-sonnet-5.5", fetch);
    expect(r.text).toBe("You’re 36, so **easy** today.");
    expect(r.toolResults).toEqual([expect.objectContaining({ age: 36 })]);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toMatchObject({ model: "anthropic/claude-sonnet-5.5", stream: true });
    expect(JSON.stringify(calls[1].body.messages)).toContain("call_1");
  });

  it("your own server: OpenAI-compatible at the URL the person gave, with no Authorization header without a key", async () => {
    const { fetch, calls } = fakeFetch([OPENAI_COMPAT_TOOL, OPENAI_COMPAT_TEXT]);
    const r = await run("custom", "llama3.1:8b", fetch, { apiKey: null, baseUrl: "http://192.168.1.20:11434/v1" });
    expect(r.text).toBe("You’re 36, so **easy** today.");
    expect(calls[0].url).toBe("http://192.168.1.20:11434/v1/chat/completions");
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body).toMatchObject({ model: "llama3.1:8b", stream: true });
    expect(modelFor({ provider: "custom", model: "llama3.1:8b", apiKey: null })).toBeNull();
    expect(coachReady({ consent: true, provider: "custom", last4: null, baseUrl: "http://x:1/v1" })).toBe(true);
    expect(coachReady({ consent: true, provider: "custom", last4: null, baseUrl: null })).toBe(false);
    expect(coachReady({ consent: true, provider: "openai", last4: null })).toBe(false);
  });

  it("OpenAI, Gemini and the Gateway send the key to their own endpoints only", async () => {
    for (const [id, host] of [
      ["openai", "https://api.openai.com/v1/"],
      ["google", "https://generativelanguage.googleapis.com/"],
      ["gateway", "https://ai-gateway.vercel.sh/"],
    ] as const) {
      const { fetch, calls } = fakeFetch([{ status: 401, json: { error: { message: "bad key" } } }]);
      await run(id, providerOf(id)!.model, fetch).catch(() => {});
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c.url.startsWith(host)).toBe(true);
      expect(JSON.stringify(calls[0].headers)).toContain(KEY);
    }
  });
});

describe("key test", () => {
  it("checks the form like the web: provider, model id characters, key length", () => {
    expect(checkProvider({ provider: "x", model: "m", apiKey: KEY })).toEqual({ ok: false, error: "Pick a provider." });
    expect(checkProvider({ provider: "openai", model: " ", apiKey: KEY })).toEqual({ ok: false, error: "Enter a model." });
    expect(checkProvider({ provider: "openai", model: "gpt 5", apiKey: KEY })).toEqual({ ok: false, error: "That model id has characters no provider uses." });
    expect(checkProvider({ provider: "openai", model: "gpt-5.4-mini", apiKey: "" })).toEqual({ ok: false, error: "Paste your API key." });
    expect(checkProvider({ provider: "openai", model: "gpt-5.4-mini", apiKey: "short" })).toEqual({ ok: false, error: "That key looks too short." });
    expect(checkProvider({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5", apiKey: `  ${KEY} ` })).toEqual({ ok: true, provider: "openrouter", model: "anthropic/claude-sonnet-5.5", apiKey: KEY, baseUrl: null });
    // The person's own server: its http(s) address, and a key only if given.
    expect(checkProvider({ provider: "custom", model: "llama3.1:8b", apiKey: "", baseUrl: "ollama.local" })).toEqual({ ok: false, error: "Enter your server’s address, starting with http:// or https://." });
    expect(checkProvider({ provider: "custom", model: "llama3.1:8b", apiKey: "", baseUrl: " http://192.168.1.20:11434/v1/ " })).toEqual({ ok: true, provider: "custom", model: "llama3.1:8b", apiKey: null, baseUrl: "http://192.168.1.20:11434/v1" });
  });

  it("saves only after one tiny request works; a refused key gives the web's message", async () => {
    // generateText asks for a non-streamed answer: answer it as JSON.
    const okJson = fakeFetch([{ status: 200, json: { id: "msg_3", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } }]);
    expect(await testKey({ provider: "anthropic", model: "claude-opus-5-5", apiKey: KEY }, okJson.fetch)).toMatchObject({ ok: true, provider: "anthropic", apiKey: KEY });
    expect(okJson.calls[0].body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16 });
    expect(okJson.calls[0].body.stream).toBeFalsy();
    const refused = fakeFetch([{ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }]);
    expect(await testKey({ provider: "anthropic", model: "claude-opus-5-5", apiKey: KEY }, refused.fetch)).toEqual({ ok: false, error: TEST_FAILED });
    expect(refused.calls).toHaveLength(1);
  });
});
