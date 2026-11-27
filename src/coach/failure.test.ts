import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { failureText, failureToken, providerFailure } from "./failure";

const api = (statusCode?: number) =>
  new APICallError({ message: "Provider error", url: "https://provider.example/v1", requestBodyValues: {}, statusCode, responseBody: "secret echo" });

describe("providerFailure", () => {
  it("names the HTTP status and distinguishes a refusal, a busy provider and the key", () => {
    expect(providerFailure(api(400))).toEqual({ code: "bad_request", status: 400 });
    expect(providerFailure(api(404))).toEqual({ code: "bad_request", status: 404 });
    expect(providerFailure(api(422))).toEqual({ code: "bad_request", status: 422 });
    expect(providerFailure(api(401))).toEqual({ code: "key", status: 401 });
    expect(providerFailure(api(403))).toEqual({ code: "key", status: 403 });
    expect(providerFailure(api(429))).toEqual({ code: "provider", status: 429 });
    expect(providerFailure(api(503))).toEqual({ code: "unavailable", status: 503 });
    expect(providerFailure(api(500))).toEqual({ code: "unavailable", status: 500 });
    expect(providerFailure(api(302))).toEqual({ code: "provider", status: 302 });
  });

  it("treats an absent status as a network failure and unwraps retries", () => {
    expect(providerFailure(api())).toEqual({ code: "network", status: null });
    expect(providerFailure(new TypeError("Network request failed"))).toEqual({ code: "network", status: null });
    expect(providerFailure(new Error("unknown"))).toEqual({ code: "provider", status: null });
    const retried = new RetryError({ message: "Retried", reason: "maxRetriesExceeded", errors: [api(503)] });
    expect(providerFailure(retried)).toEqual({ code: "unavailable", status: 503 });
    // A retried fetch rejection is a RetryError around a TypeError: still a network failure, not a provider refusal.
    const retriedNetwork = new RetryError({ message: "Retried", reason: "maxRetriesExceeded", errors: [new TypeError("Network request failed")] });
    expect(providerFailure(retriedNetwork)).toEqual({ code: "network", status: null });
  });
});

describe("failure tokens", () => {
  it("carries the status without the provider's body", () => {
    expect(failureToken(api(503))).toBe("unavailable:503");
    expect(failureToken(api(400))).toBe("bad_request:400");
    expect(failureToken(api())).toBe("network");
  });

  it("localises a token and appends the status, never the provider text", () => {
    const busy = failureText("unavailable:503");
    expect(busy).toContain("busy or unavailable");
    expect(busy).toContain("(HTTP 503)");
    expect(busy).not.toContain("secret echo");
    expect(failureText("bad_request:400")).toContain("(HTTP 400)");
    expect(failureText("limit")).toContain("Slow down");
    expect(failureText("something_unexpected")).toContain("Couldn’t get an answer");
  });
});
