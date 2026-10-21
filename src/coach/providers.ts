// Where the coach's model comes from: the person's own key with one of these providers (BYOK), ported from Pulse's
// src/server/coach/providers.ts. The phone calls the provider directly over HTTPS; every provider gets the fetch the
// app passes in (expo/fetch on the device, which streams response bodies), so nothing goes through a Pulse server.
// OpenRouter goes through the OpenAI-compatible client with its fixed URL; "Your own server" through the same client with
// the URL the person gives (Ollama, LM Studio, vLLM on their network or over Tailscale), and a key only if it asks.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway, type LanguageModel } from "ai";
import { i18n } from "@/i18n/config";

export type ProviderId = "openai" | "anthropic" | "google" | "gateway" | "openrouter" | "custom";

/** The AI SDK's fetch shape; expo/fetch is cast to it where it is created (net.ts). */
export type Fetch = typeof globalThis.fetch;

export type Provider = {
  id: ProviderId;
  label: string;
  /** Pre-filled model id; the person may type another one their provider offers. */
  model: string;
  /** Where to get a key (shown with the key field); none for the person's own server. */
  keyUrl?: string;
  /** The person's own OpenAI-compatible server: they give its URL, and a key only if it needs one. */
  custom?: true;
  create: (apiKey: string | null, model: string, fetch?: Fetch, baseUrl?: string) => LanguageModel;
};

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    model: "claude-opus-5-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    create: (apiKey, model, fetch) => createAnthropic({ apiKey: apiKey!, fetch })(model),
  },
  {
    id: "openai",
    label: "OpenAI",
    model: "gpt-5.4-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    create: (apiKey, model, fetch) => createOpenAI({ apiKey: apiKey!, fetch })(model),
  },
  {
    id: "google",
    label: "Google Gemini",
    model: "gemini-3.8-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    create: (apiKey, model, fetch) => createGoogleGenerativeAI({ apiKey: apiKey!, fetch })(model),
  },
  {
    id: "gateway",
    label: "Vercel AI Gateway",
    model: "anthropic/claude-sonnet-5.5",
    keyUrl: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai",
    create: (apiKey, model, fetch) => createGateway({ apiKey: apiKey!, fetch })(model),
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    model: "anthropic/claude-sonnet-5.5",
    keyUrl: "https://openrouter.ai/settings/keys",
    create: (apiKey, model, fetch) => createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey: apiKey!, fetch })(model),
  },
  {
    id: "custom",
    get label() {
      return i18n.t("coach:provider.custom");
    },
    model: "llama3.1:8b",
    custom: true,
    // No key, no Authorization header: a local Ollama takes none.
    create: (apiKey, model, fetch, baseUrl) => createOpenAICompatible({ name: "custom", baseURL: baseUrl!, apiKey: apiKey || undefined, fetch })(model),
  },
];

export const providerOf = (id: string | null | undefined) => PROVIDERS.find((p) => p.id === id) ?? null;

/** How the chat names the provider ("using Anthropic"). */
export const providerLabel = (id: string | null) => providerOf(id)?.label ?? i18n.t("coach:providerFallback");

/** What the person chose: the provider, the model, the key (none for a server that takes none), the server's URL. */
export type ModelChoice = { provider: string; model: string; apiKey: string | null; baseUrl?: string | null };

/** The model to answer with, or null for an unknown provider, a missing key, or the person's server without its URL. */
export function modelFor(c: ModelChoice, fetch?: Fetch): LanguageModel | null {
  const p = providerOf(c.provider);
  if (!p) return null;
  if (p.custom) return c.baseUrl ? p.create(c.apiKey, c.model, fetch, c.baseUrl) : null;
  return c.apiKey ? p.create(c.apiKey, c.model, fetch) : null;
}

/** Whether a saved setup can answer: consent, a provider, and its key, or for the person's own server its URL. */
export const coachReady = (s: { consent: boolean; provider: string | null; last4: string | null; baseUrl?: string | null } | undefined) =>
  !!s?.consent && !!s.provider && (providerOf(s.provider)?.custom ? !!s.baseUrl : !!s.last4);
