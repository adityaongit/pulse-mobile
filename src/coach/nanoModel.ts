import { cancelNano, generateNano, type NanoStatus } from "../../modules/pulse-nano";
import { generateId, type LanguageModel } from "ai";

type AnyRecord = Record<string, any>;
const flatten = (parts: AnyRecord[] | string = []) => typeof parts === "string" ? parts : parts.map((part) => {
  if (part.type === "text") return part.text;
  if (part.type === "tool-call") return `Tool result ${part.toolName}: ${part.input ?? ""}`;
  if (part.type === "tool-result") return `Tool result ${part.toolName}: ${JSON.stringify(part.output ?? part.result ?? "")}`;
  return "";
}).filter(Boolean).join("\n");

function promptOf(options: AnyRecord): string {
  const prompt = options.prompt ?? [];
  const system = prompt.filter((m: AnyRecord) => m.role === "system").map((m: AnyRecord) => flatten(m.content)).join("\n").slice(0, 2400);
  const messages = prompt.filter((m: AnyRecord) => m.role !== "system").map((m: AnyRecord) => `${m.role.toUpperCase()}: ${flatten(m.content)}`).join("\n\n").slice(-6200);
  const tools = (options.tools ?? []).filter((t: AnyRecord) => t.type === "function").map((t: AnyRecord) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })).filter((t: AnyRecord) => t.name);
  const toolInstructions = tools.length ? `Available read-only tools. If a tool is needed, respond with exactly one JSON object {"toolCall":{"name":"...","arguments":{...}}}; otherwise answer in plain text. Tool definitions: ${JSON.stringify(tools)}`.slice(0, 2800) : "";
  const jsonInstructions = options.responseFormat?.type === "json" ? `Return only valid JSON matching this schema: ${JSON.stringify(options.responseFormat.schema ?? {})}` : "";
  return [system, toolInstructions, jsonInstructions, messages].filter(Boolean).join("\n\n").slice(0, 11800);
}

export function nanoLanguageModel(): LanguageModel {
  const generate = async (options: AnyRecord) => {
    const requestId = generateId();
    const signal = options.abortSignal as AbortSignal | undefined;
    const onAbort = () => cancelNano(requestId);
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    let text: string;
    try {
      text = await generateNano(promptOf(options), options.maxOutputTokens ?? 512, requestId);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    let content: AnyRecord[] = [{ type: "text", text }];
    try {
      const parsed = JSON.parse(text.trim());
      const call = parsed?.toolCall;
      const known = (options.tools ?? []).some((t: AnyRecord) => t.type === "function" && t.name === call?.name);
      if (known && call && typeof call.arguments === "object") content = [{ type: "tool-call", toolCallId: generateId(), toolName: call.name, input: call.arguments }];
    } catch { /* Plain text is the normal response shape. */ }
    return { content, finishReason: { unified: content[0].type === "tool-call" ? "tool-calls" : "stop", raw: undefined }, usage: { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined }, raw: undefined }, request: { body: { prompt: options.prompt } }, warnings: [] };
  };
  const model = {
    specificationVersion: "v3",
    provider: "pulse.gemini-nano",
    modelId: "gemini-nano",
    supportedUrls: {},
    doGenerate: generate,
    async doStream(options: AnyRecord) {
      const result = await generate(options);
      const item = result.content[0];
      const chunks: AnyRecord[] = [{ type: "stream-start", warnings: [] }, { type: "response-metadata", modelId: "gemini-nano" }];
      if (item.type === "tool-call") chunks.push({ type: "tool-call", ...item });
      else chunks.push({ type: "text-start", id: "nano" }, { type: "text-delta", id: "nano", delta: item.text }, { type: "text-end", id: "nano" });
      chunks.push({ type: "finish", finishReason: result.finishReason, usage: result.usage });
      return { stream: new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }), request: result.request, warnings: [] };
    },
  };
  return model as unknown as LanguageModel;
}

export type { NanoStatus };
