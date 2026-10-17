// Photo and description estimates through the person's own provider: the schema the model answers in, the lenient
// reading of what comes back, and every way it can fail (refusal, unreadable JSON, a refused key, rate limits, no
// network, too slow, cancelled). The providers are the real AI SDK clients over a fake fetch with recorded-shape
// answers; no network, and the photo is a few bytes.
import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { modelFor, type Fetch } from "@/coach/providers";
import { ESTIMATE_INSTRUCTIONS, estimateFood, extractJson, FoodEstimateSchema, looksLikeRefusal, MAX_FOODS, parseEstimate, problemOf } from "./estimate";

const KEY = "sk-test-key-0000";
const PHOTO = { image: { base64: "/9j/4AAQSkZJRgABAQ==", mediaType: "image/jpeg" } };

const ANSWER = {
  foods: [
    { name: "Scrambled eggs", portion: "2 large eggs (100 g)", kcal: 182, protein_g: 12.6, carbs_g: 1.6, fat_g: 13.9, fiber_g: 0, confidence: "high" },
    { name: "Whole-wheat toast", portion: "1 slice (32 g)", kcal: 80, protein_g: 4, carbs_g: 13.8, fat_g: 1.1, fiber_g: 1.9, confidence: "medium" },
  ],
  totals: { kcal: 262, protein_g: 16.6, carbs_g: 15.4, fat_g: 15, fiber_g: 1.9 },
  note: "Assumed the eggs were cooked with a little butter.",
};

type Call = { url: string; body: Record<string, unknown> };

/** Answers each request with the next reply (JSON with a status), recording what was sent. */
function fakeFetch(replies: { status: number; json: unknown }[]) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    const r = replies[calls.length - 1];
    if (!r) throw new Error("unexpected request");
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as Fetch;
  return { fetch, calls };
}

const anthropic = (text: string, stop = "end_turn") => ({
  status: 200,
  json: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: text ? [{ type: "text", text }] : [], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 120 } },
});
const openrouter = (content: string) => ({
  status: 200,
  json: { id: "c1", object: "chat.completion", created: 1, model: "anthropic/claude-sonnet-5.5", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 } },
});
const claude = (fetch: Fetch) => modelFor({ provider: "anthropic", model: "claude-opus-5-5", apiKey: KEY }, fetch)!;

describe("the schema", () => {
  it("accepts the answer it asks for and refuses a malformed one", () => {
    expect(FoodEstimateSchema.safeParse(ANSWER).success).toBe(true);
    expect(FoodEstimateSchema.safeParse({ ...ANSWER, note: undefined }).success).toBe(false);
    expect(FoodEstimateSchema.safeParse({ ...ANSWER, foods: [{ ...ANSWER.foods[0], confidence: "certain" }] }).success).toBe(false);
    expect(FoodEstimateSchema.safeParse({ ...ANSWER, foods: [{ ...ANSWER.foods[0], kcal: "182" }] }).success).toBe(false);
  });

  it("tells the model the same shape in words, for providers without JSON-schema output", () => {
    for (const k of ["foods", "portion", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "confidence", "totals", "note"]) expect(ESTIMATE_INSTRUCTIONS).toContain(`"${k}"`);
  });
});

describe("reading an answer", () => {
  it("keeps a good answer, re-adding the totals from the foods", () => {
    const e = parseEstimate({ ...ANSWER, totals: { kcal: 9999, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1 } })!;
    expect(e.foods.map((f) => [f.name, f.kcal, f.protein, f.confidence])).toEqual([
      ["Scrambled eggs", 182, 12.6, "high"],
      ["Whole-wheat toast", 80, 4, "medium"],
    ]);
    expect(e.totals).toEqual({ kcal: 262, protein: 16.6, carbs: 15.4, fat: 15, fiber: 1.9 });
    expect(e.note).toBe("Assumed the eggs were cooked with a little butter.");
  });

  it("reads numbers sent as strings, clamps and rounds, and drops foods without a name", () => {
    const e = parseEstimate({
      foods: [
        { name: " Dal ", portion: "1 bowl", kcal: "230.6", protein: "12,25", carbs_g: -4, fat_g: 7, confidence: "HIGH" },
        { name: "", kcal: 100 },
        { name: "Ghee rice", portion: "", calories: 99999, protein_g: 5, carbs_g: 80, fat_g: 3000, fiber_g: "n/a", confidence: "sure" },
        "not a food",
      ],
      note: "   ",
    })!;
    expect(e.foods).toEqual([
      { name: "Dal", portion: "1 bowl", kcal: 231, protein: 12.3, carbs: 0, fat: 7, fiber: 0, confidence: "high" },
      { name: "Ghee rice", portion: "", kcal: 5000, protein: 5, carbs: 80, fat: 1000, fiber: 0, confidence: "medium" },
    ]);
    expect(e.totals.kcal).toBe(5231);
    expect(e.note).toBeNull();
  });

  it("keeps at most 20 foods and accepts an empty plate", () => {
    const many = { foods: Array.from({ length: 30 }, (_, i) => ({ ...ANSWER.foods[0], name: `Food ${i}` })), note: "" };
    expect(parseEstimate(many)!.foods).toHaveLength(MAX_FOODS);
    expect(parseEstimate({ foods: [], totals: {}, note: "No food in this photo." })).toEqual({ foods: [], totals: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, note: "No food in this photo." });
  });

  it("refuses what isn't an estimate", () => {
    expect(parseEstimate(null)).toBeNull();
    expect(parseEstimate("eggs")).toBeNull();
    expect(parseEstimate({ items: [] })).toBeNull();
  });

  it("finds the JSON in a fenced block or in prose, and tells a refusal from noise", () => {
    expect(extractJson('```json\n{"foods": []}\n```')).toEqual({ foods: [] });
    expect(extractJson('Here you go: {"foods": [], "note": "x"} Enjoy!')).toEqual({ foods: [], note: "x" });
    expect(extractJson("no json here")).toBeNull();
    expect(looksLikeRefusal("I'm sorry, but I can't help identify people in photos.")).toBe(true);
    expect(looksLikeRefusal('{"foods": []}')).toBe(false);
    expect(looksLikeRefusal("Lots of protein, I think.")).toBe(false);
  });
});

describe("a photo estimate", () => {
  it("sends the photo and the schema to the provider and reads its answer", async () => {
    const { fetch, calls } = fakeFetch([anthropic(JSON.stringify(ANSWER))]);
    const r = await estimateFood(claude(fetch), PHOTO);
    expect(r).toMatchObject({ ok: true, estimate: { foods: [{ name: "Scrambled eggs" }, { name: "Whole-wheat toast" }], totals: { kcal: 262 } } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.stringify(calls[0].body);
    expect(body).toContain(PHOTO.image.base64);
    expect(body).toContain('"media_type":"image/jpeg"');
    expect(body).toContain("Estimate the nutrition of the food and drink in this photo.");
    expect(calls[0].body).toMatchObject({ model: "claude-opus-5-5", output_config: { format: { type: "json_schema" } } });
    expect(JSON.stringify(calls[0].body.system)).toContain("You estimate the nutrition of food");
  });

  it("estimates a typed description the same way, with no photo", async () => {
    const { fetch, calls } = fakeFetch([anthropic(JSON.stringify(ANSWER))]);
    expect((await estimateFood(claude(fetch), { text: "2 eggs and a slice of toast" })).ok).toBe(true);
    const body = JSON.stringify(calls[0].body);
    expect(body).toContain("2 eggs and a slice of toast");
    expect(body).not.toContain("image");
  });

  it("over OpenRouter's JSON mode, reads an answer the schema check rejects (numbers as strings, fenced)", async () => {
    const loose = { ...ANSWER, foods: [{ ...ANSWER.foods[0], kcal: "182", confidence: "High" }] };
    const { fetch, calls } = fakeFetch([openrouter(`\`\`\`json\n${JSON.stringify(loose)}\n\`\`\``)]);
    const r = await estimateFood(modelFor({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5", apiKey: KEY }, fetch)!, PHOTO, { maxRetries: 0 });
    expect(r).toMatchObject({ ok: true, estimate: { foods: [{ name: "Scrambled eggs", kcal: 182, confidence: "high" }] } });
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(calls[0].body.messages)).toContain("data:image/jpeg;base64");
  });

  it("names a refusal, an unreadable answer and a prose apology", async () => {
    const refusal = fakeFetch([anthropic("", "refusal")]);
    expect(await estimateFood(claude(refusal.fetch), PHOTO)).toEqual({ ok: false, problem: "refused" });
    const noise = fakeFetch([anthropic("Mostly carbs, roughly 400 calories.")]);
    expect(await estimateFood(claude(noise.fetch), PHOTO)).toEqual({ ok: false, problem: "unreadable" });
    const apology = fakeFetch([anthropic("I'm sorry, I can't help with that image.")]);
    expect(await estimateFood(claude(apology.fetch), PHOTO)).toEqual({ ok: false, problem: "refused" });
  });

  it("names a refused key, a rate limit and a provider error", async () => {
    const err = (status: number, type: string) => ({ status, json: { type: "error", error: { type, message: "nope" } } });
    for (const [status, type, problem] of [
      [401, "authentication_error", "key"],
      [403, "permission_error", "key"],
      [429, "rate_limit_error", "busy"],
      [500, "api_error", "provider"],
    ] as const) {
      const { fetch } = fakeFetch([err(status, type)]);
      expect(await estimateFood(claude(fetch), PHOTO, { maxRetries: 0 })).toEqual({ ok: false, problem });
    }
  });

  it("names no connection, a timeout and a cancel", async () => {
    const offline = (async () => {
      throw new TypeError("Network request failed");
    }) as Fetch;
    expect(await estimateFood(claude(offline), PHOTO, { maxRetries: 0 })).toEqual({ ok: false, problem: "network" });

    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted"))))) as Fetch;
    expect(await estimateFood(claude(hanging), PHOTO, { timeoutMs: 20, maxRetries: 0 })).toEqual({ ok: false, problem: "timeout" });

    const ctl = new AbortController();
    const pending = estimateFood(claude(hanging), PHOTO, { signal: ctl.signal, timeoutMs: 5000, maxRetries: 0 });
    setTimeout(() => ctl.abort(), 10);
    expect(await pending).toEqual({ ok: false, problem: "cancelled" });
    const gone = new AbortController();
    gone.abort();
    expect(await estimateFood(claude(hanging), PHOTO, { signal: gone.signal })).toEqual({ ok: false, problem: "cancelled" });
  });

  it("looks through the SDK's retry wrapper to the last error", () => {
    const busy = new APICallError({ message: "slow down", url: "https://x", requestBodyValues: {}, statusCode: 429, isRetryable: true });
    expect(problemOf(new RetryError({ message: "failed", reason: "maxRetriesExceeded", errors: [busy] }))).toBe("busy");
    expect(problemOf(new APICallError({ message: "down", url: "https://x", requestBodyValues: {} }))).toBe("network");
    expect(problemOf(new Error("odd"))).toBe("provider");
  });
});
