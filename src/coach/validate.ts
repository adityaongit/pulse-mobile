// Provider setup checks, ported from Pulse's saveProviderAction (src/server/actions/coach.ts): the form's rules, then
// one tiny test request with the key, so a bad key, model id or empty account is never saved.
import { generateText } from "ai";
import { i18n } from "@/i18n/config";
import { modelFor, providerOf, type Fetch } from "./providers";

export type ProviderInput = { provider: string; model: string; apiKey: string; baseUrl?: string };
export type Checked = { ok: true; provider: string; model: string; apiKey: string | null; baseUrl: string | null } | { ok: false; error: string };

/** The person's server URL, trimmed of a trailing slash, or null when it is not an http(s) address. */
export function serverUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

/**
 * The web's zod rules, as plain checks: a known provider, a model id providers use, a key of plausible length. The
 * person's own server needs its http(s) URL instead, and a key only if it asks for one.
 */
export function checkProvider(input: ProviderInput): Checked {
  const p = providerOf(input.provider);
  const model = input.model.trim();
  const apiKey = input.apiKey.trim();
  if (!p) return { ok: false, error: i18n.t("coach:validate.pickProvider") };
  if (!model) return { ok: false, error: i18n.t("coach:validate.enterModel") };
  if (model.length > 120 || !/^[\w.:/@-]+$/.test(model)) return { ok: false, error: i18n.t("coach:validate.modelChars") };
  const baseUrl = p.custom ? serverUrl(input.baseUrl ?? "") : null;
  if (p.custom && !baseUrl) return { ok: false, error: i18n.t("coach:validate.serverAddress") };
  if (!apiKey && !p.custom) return { ok: false, error: i18n.t("coach:validate.pasteKey") };
  if (apiKey && apiKey.length < 8) return { ok: false, error: i18n.t("coach:validate.keyShort") };
  if (apiKey.length > 500) return { ok: false, error: i18n.t("coach:validate.keyLong") };
  return { ok: true, provider: input.provider, model, apiKey: apiKey || null, baseUrl };
}

/** The English wording, for tests; the app shows `coach:validate.testFailed`. */
export const TEST_FAILED = "That didn’t work: check the key and the model id, and that your account has credit.";

/**
 * One tiny request with the key (or to the person's server). 16 output tokens rather than the web's 5: OpenAI's Responses API rejects fewer.
 * Never logs the key or the provider's body (only the error's name).
 */
export async function testKey(input: ProviderInput, fetch?: Fetch, timeoutMs = 20_000): Promise<Checked> {
  const c = checkProvider(input);
  if (!c.ok) return c;
  const model = modelFor(c, fetch);
  if (!model) return { ok: false, error: i18n.t("coach:validate.pickProvider") };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("timeout")), timeoutMs);
  try {
    await generateText({ model, prompt: "Reply with OK.", maxOutputTokens: 16, maxRetries: 0, abortSignal: ctl.signal });
    // The checked values, ready to save.
    return c;
  } catch (e) {
    console.warn(`[coach] key test failed for ${c.provider}: ${e instanceof Error ? e.name : "error"}`);
    return { ok: false, error: i18n.t("coach:validate.testFailed") };
  } finally {
    clearTimeout(timer);
  }
}
