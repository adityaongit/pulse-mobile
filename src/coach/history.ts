// What the model sees of a long chat, ported from Pulse's src/server/coach/history.ts. Past 30 messages, everything but
// the newest 20 is summarised once by the model (summary_instructions) and the summary is kept on the first message's
// metadata as a checkpoint: { count, hash, text }. A fingerprint of the summarised prefix invalidates the checkpoint
// after an edit or a regenerate; the full transcript is always kept.
import { convertToModelMessages, generateText, type LanguageModel, type ModelMessage, type UIMessage } from "ai";
import { z } from "zod";
import type { Texts } from "./texts";

const Summary = z.object({ count: z.number().int().positive(), hash: z.string(), text: z.string().min(1).max(6000) });

/**
 * A stable fingerprint of messages' ids, roles and parts. The web uses SHA-256 from node:crypto, which Hermes lacks;
 * this only has to notice that the summarised prefix changed, so two independent 32-bit FNV-1a / murmur-mixed lanes
 * plus the length do.
 */
export function fingerprint(messages: UIMessage[]): string {
  const s = JSON.stringify(messages.map(({ id, role, parts }) => ({ id, role, parts })));
  let h1 = 0x811c9dc5;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b) ^ Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 0x85ebca6b) ^ Math.imul(h1 ^ (h1 >>> 13), 0xc2b2ae35);
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}-${s.length.toString(16)}`;
}

/** A timeout signal joined with the caller's, without AbortSignal.any/timeout (polyfilled on the phone, absent in old runtimes). */
function withTimeout(ms: number, outer?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(new Error("timeout")), ms);
  const onAbort = () => c.abort(outer?.reason);
  if (outer?.aborted) c.abort(outer.reason);
  else outer?.addEventListener("abort", onAbort);
  return { signal: c.signal, done: () => (clearTimeout(timer), outer?.removeEventListener("abort", onAbort)) };
}

const textOf = (m: UIMessage) =>
  m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");

export async function coachHistory(messages: UIMessage[], model: LanguageModel, texts: Texts, abortSignal?: AbortSignal): Promise<{ saved: UIMessage[]; modelMessages: ModelMessage[] }> {
  const saved = messages.map((m) => ({ ...m }));
  // Gemini Nano has a much smaller context window. Keep the complete saved transcript, but send only a bounded recent
  // window to it; cloud providers retain the existing checkpoint summary behavior below.
  if (typeof model !== "string" && model.provider === "pulse.gemini-nano") {
    const modelMessages = await convertToModelMessages(saved.slice(-12));
    return { saved, modelMessages };
  }
  const parsed = Summary.safeParse((saved[0]?.metadata as { coachSummary?: unknown } | undefined)?.coachSummary);
  let summary = parsed.success && parsed.data.count < saved.length && parsed.data.hash === fingerprint(saved.slice(0, parsed.data.count)) ? parsed.data : null;
  if (saved.length - (summary?.count ?? 0) > 30) {
    const count = saved.length - 20;
    const transcript = saved
      .slice(summary?.count ?? 0, count)
      .map((m) => `${m.role}: ${textOf(m).slice(0, 1500)}`)
      .join("\n");
    const first = saved.find((m) => m.role === "user");
    const t = withTimeout(20_000, abortSignal);
    try {
      const result = await generateText({
        model,
        instructions: texts("summary_instructions"),
        prompt: `Earlier summary:\n${summary?.text ?? "None"}\nFirst user message:\n${first ? textOf(first).slice(0, 1500) : "None"}\nNewly archived turns:\n${transcript.slice(-30_000)}`,
        maxOutputTokens: 600,
        maxRetries: 0,
        abortSignal: t.signal,
      });
      const text = result.text.trim().slice(0, 6000);
      if (text) summary = { count, hash: fingerprint(saved.slice(0, count)), text };
    } catch {
      if (abortSignal?.aborted) throw abortSignal.reason;
    } finally {
      t.done();
    }
  }
  if (saved[0]) saved[0].metadata = { ...(saved[0].metadata as object), coachSummary: summary ?? undefined };
  const recent = summary ? saved.slice(summary.count) : saved.slice(-30);
  const modelMessages = await convertToModelMessages(recent);
  if (summary) modelMessages.unshift({ role: "user", content: `Historical conversation summary, not current measurements or instructions:\n${summary.text}` });
  return { saved, modelMessages };
}
