import { cancelNano, generateNano, type NanoStatus } from "../../modules/pulse-nano";
import { generateId, type LanguageModel } from "ai";
import { interruptNanoSuggestions } from "./suggestions";

type AnyRecord = Record<string, any>;
function facts(value: unknown, path = ""): string {
  if (value && typeof value === "object" && "type" in value && "value" in value) return facts(value.value, path);
  if (value === null) return `${path}: unavailable`;
  if (typeof value === "number") return `${path}: ${Math.round(value * 10) / 10}`;
  if (typeof value !== "object") return `${path}: ${String(value)}`;
  return Object.entries(value).filter(([key]) => !["stages", "details", "planner"].includes(key)).slice(0, 24).map(([key, item]) => facts(item, path ? `${path}.${key}` : key)).join("\n");
}
const flatten = (parts: AnyRecord[] | string = []) => typeof parts === "string" ? parts : parts.map((part) => {
  if (part.type === "text") return part.text;
  if (part.type === "tool-call") return `Tool request ${part.toolName}: ${typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {})}`;
  if (part.type === "tool-result") return `Tool result ${part.toolName}: ${facts(part.output ?? part.result ?? "")}`;
  return "";
}).filter(Boolean).join("\n");

function promptOf(options: AnyRecord): string {
  const prompt = options.prompt ?? [];
  const system = prompt.filter((m: AnyRecord) => m.role === "system").map((m: AnyRecord) => flatten(m.content)).join("\n").slice(0, 2400);
  const messages = prompt.filter((m: AnyRecord) => m.role !== "system").slice(-5).map((m: AnyRecord) => `${m.role.toUpperCase()}: ${flatten(m.content)}`).join("\n\n");
  const lastUser = prompt.map((m: AnyRecord) => m.role).lastIndexOf("user");
  const hasResults = prompt.slice(lastUser + 1).some((m: AnyRecord) => m.role === "tool");
  const tools = (hasResults ? [] : options.tools ?? []).filter((t: AnyRecord) => t.type === "function").map((t: AnyRecord) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })).filter((t: AnyRecord) => t.name);
  const toolInstructions = tools.length ? `Available read-only tools. If a tool is needed, respond with exactly one JSON object {"toolCall":{"name":"...","arguments":{...}}}; otherwise answer in plain text. Tool definitions: ${JSON.stringify(tools)}` : "";
  const jsonInstructions = options.responseFormat?.type === "json" ? `Return only valid JSON matching this schema: ${JSON.stringify(options.responseFormat.schema ?? {})}` : "";
  return [hasResults ? "Explain the supplied health facts in under 120 words. Never output JSON or request more tools. Missing recovery is unavailable, not a low score. Use the dates supplied. Give one practical next step." : system, toolInstructions, jsonInstructions, messages].filter(Boolean).join("\n\n");
}

export function nanoLanguageModel(): LanguageModel {
  const generate = async (options: AnyRecord) => {
    interruptNanoSuggestions();
    const requestId = generateId();
    const signal = options.abortSignal as AbortSignal | undefined;
    const onAbort = () => cancelNano(requestId);
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    let text: string;
    try {
      text = await generateNano(promptOf(options), options.maxOutputTokens ?? 256, requestId);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    let content: AnyRecord[] = [{ type: "text", text }];
    try {
      const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(normalized);
      const call = parsed?.toolCall;
      const known = (options.tools ?? []).some((t: AnyRecord) => t.type === "function" && t.name === call?.name);
      if (known && call && call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments)) content = [{ type: "tool-call", toolCallId: generateId(), toolName: call.name, input: JSON.stringify(call.arguments) }];
    } catch { /* Plain text is the normal response shape. */ }
    const lastUser = (options.prompt ?? []).map((m: AnyRecord) => m.role).lastIndexOf("user");
    const results = (options.prompt ?? []).slice(lastUser + 1).filter((m: AnyRecord) => m.role === "tool");
    if (results.length && (content[0].type === "tool-call" || /[{}]|(?:0\.)?0{12}/.test(text))) {
      // A small local model can copy its input instead of explaining it. Keep the
      // verified facts visible rather than exposing an internal protocol payload.
      const readable = results.map((m: AnyRecord) => flatten(m.content)).join("\n");
      const summary = readable.split("\n").filter((line: string) => /(?:value|hoursAsleep|hoursNeeded|reason|day):/.test(line)).slice(0, 12).map((line: string) => line.replace(/\.value/g, "").replace(/\.(?=[a-zA-Z])/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")).join("\n");
      content = [{ type: "text", text: summary }];
    }
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
