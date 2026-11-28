// One place that turns a provider failure into a small, safe code plus its HTTP status.
//
// Provider bodies are never shown, logged or reported: they can echo the request, a key or health data. The status is a
// small number, so it can travel from the stream to the screen as `<code>:<status>` and be shown through i18n. Event
// names stay stable (`coach.<code>`); `reportCoach` keeps the status as a tag.
import { APICallError, RetryError } from "ai";
import { i18n } from "@/i18n/config";

export type FailureCode = "network" | "provider" | "key" | "unavailable" | "refused";

export type ProviderFailure = { code: FailureCode; status: number | null };

/**
 * A failure as a fixed code and, when the provider answered, its HTTP status. A 400/404/422 means the request itself
 * was refused (an unsupported parameter, stream or tool on the person's own server); a 5xx means the provider is busy;
 * a 401/403 is the key. Everything else keeps the old "provider" copy, now with the status shown.
 */
export function providerFailure(e: unknown): ProviderFailure {
  const err = RetryError.isInstance(e) ? e.lastError : e;
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? null;
    if (!status || status < 100 || status > 599) return { code: "network", status: null };
    if (status === 401 || status === 403) return { code: "key", status };
    if (status >= 500) return { code: "unavailable", status };
    if (status === 400 || status === 404 || status === 422) return { code: "refused", status };
    return { code: "provider", status };
  }
  // Check the unwrapped error: a fetch rejection retried to exhaustion is a RetryError around a TypeError.
  if (err instanceof TypeError) return { code: "network", status: null };
  return { code: "provider", status: null };
}

/** What `toUIMessageStream`'s onError returns: a code, or `code:status` for the screen to localise. */
export function failureToken(e: unknown): string {
  const { code, status } = providerFailure(e);
  return status === null ? code : `${code}:${status}`;
}

/** Pre-stream failures are `Error(code)`; anything else reads the default sentence. Literal keys keep i18n's types happy. */
const CODES = {
  network: "coach:errors.network",
  provider: "coach:errors.provider",
  key: "coach:errors.key",
  unavailable: "coach:errors.unavailable",
  refused: "coach:errors.refused",
  limit: "coach:errors.limit",
  profile: "coach:errors.profile",
  default: "coach:errors.default",
} as const;

/** The sentence for a token produced by `failureToken`, or for a pre-stream `Error(code)`. */
export function failureText(token: string): string {
  const [code, raw] = token.trim().split(":");
  const base = i18n.t(CODES[code as keyof typeof CODES] ?? CODES.default);
  const status = /^\d{3}$/.test(raw ?? "") ? Number(raw) : null;
  return status === null ? base : base + i18n.t("coach:errors.httpStatus", { status });
}
