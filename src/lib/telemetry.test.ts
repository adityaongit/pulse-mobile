// Telemetry with Sentry and AsyncStorage mocked: nothing starts without a DSN, the switch stops sending at once, a code
// with the same tags goes once a day, and the scrubber lets no key, URL host, query or number through.
import type { ErrorEvent } from "@sentry/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => new Map<string, string>());
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  close: vi.fn(async () => {}),
}));
vi.mock("@sentry/react-native", () => sentry);
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => void mem.set(k, v),
    multiRemove: async (ks: string[]) => ks.forEach((k) => mem.delete(k)),
  },
}));

const DSN = "https://public@o1.ingest.sentry.io/1";
/** A fresh copy of the module (its state is per runtime), with or without a DSN. */
async function load(dsn = DSN) {
  vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", dsn);
  vi.resetModules();
  return import("./telemetry");
}

beforeEach(() => {
  mem.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T10:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("init", () => {
  it("does nothing without a DSN", async () => {
    const t = await load("");
    expect(await t.initTelemetry()).toBeNull();
    await t.report("sync.failed");
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("starts without PII, breadcrumbs, tracing or request context, as a random install id", async () => {
    const t = await load();
    await t.initTelemetry();
    const opts = sentry.init.mock.calls[0][0];
    expect(opts).toMatchObject({ dsn: DSN, sendDefaultPii: false, maxBreadcrumbs: 0, attachScreenshot: false, attachViewHierarchy: false, enableCaptureFailedRequests: false });
    expect(opts).not.toHaveProperty("tracesSampleRate");
    expect(opts).not.toHaveProperty("replaysSessionSampleRate");
    const kept = opts.integrations([{ name: "Breadcrumbs" }, { name: "HttpContext" }, { name: "ReactNativeErrorHandlers" }]).map((i: { name: string }) => i.name);
    expect(kept).toEqual(["ReactNativeErrorHandlers"]);
    expect(opts.beforeBreadcrumb({ category: "console", message: "x" })).toBeNull();
    expect(sentry.setUser.mock.calls[0][0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("keeps the install id across launches and makes a new one on Delete Everything", async () => {
    let t = await load();
    await t.initTelemetry();
    const first = sentry.setUser.mock.calls[0][0].id;
    t = await load();
    await t.initTelemetry();
    expect(sentry.setUser.mock.calls[1][0].id).toBe(first);
    await t.resetTelemetryId();
    expect(sentry.setUser.mock.calls[2][0].id).not.toBe(first);
  });
});

describe("volume", () => {
  it("sends a code with the same tags once a day and app version, fingerprinted by code", async () => {
    const t = await load();
    await t.initTelemetry();
    await t.report("sync.type_skipped", { type: "Steps" });
    await t.report("sync.type_skipped", { type: "Steps" });
    await t.report("sync.type_skipped", { type: "HeartRate" });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(2);
    expect(sentry.captureMessage.mock.calls[0]).toEqual(["sync.type_skipped", { level: "warning", fingerprint: ["sync.type_skipped"], tags: { type: "Steps", code: "sync.type_skipped" } }]);
    // A restart remembers today's set.
    const again = await load();
    await again.initTelemetry();
    await again.report("sync.type_skipped", { type: "Steps" });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(2);
    // The next local day starts a new one.
    vi.setSystemTime(new Date("2026-11-10T10:00:00"));
    await again.report("sync.type_skipped", { type: "Steps" });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(3);
  });

  it("dedupes errors by code and kind, never crashes", async () => {
    const t = await load();
    await t.initTelemetry();
    await t.reportError("pipeline.failed", new Error("store_not_open"));
    await t.reportError("pipeline.failed", new Error("store_not_open"));
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException.mock.calls[0][1].tags).toEqual({ kind: "store_not_open", code: "pipeline.failed" });
    const boom = new Error("render");
    await t.reportCrash(boom);
    await t.reportCrash(boom);
    expect(sentry.captureException).toHaveBeenCalledTimes(3);
  });
});

describe("the switch", () => {
  it("off closes Sentry, drops what is in flight and stays off on the next launch; on starts it again", async () => {
    const t = await load();
    await t.initTelemetry();
    const beforeSend = sentry.init.mock.calls[0][0].beforeSend;
    expect(beforeSend({ event_id: "a", type: undefined })).not.toBeNull();
    await t.setTelemetryEnabled(false);
    expect(sentry.close).toHaveBeenCalled();
    expect(beforeSend({ event_id: "a", type: undefined })).toBeNull();
    await t.report("sync.failed");
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(await t.telemetryEnabled()).toBe(false);

    const next = await load();
    expect(await next.initTelemetry()).toBeNull();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    await next.setTelemetryEnabled(true);
    expect(sentry.init).toHaveBeenCalledTimes(2);
    await next.report("sync.failed");
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });
});

describe("scrubbing", () => {
  it("cuts URLs to their path, redacts keys and replaces numbers", async () => {
    const { scrubText } = await load();
    expect(scrubText("GET https://generativelanguage.googleapis.com/v1beta/models/flash:generateContent?key=AIzaSyA1b2C3d4E5f6G7h8I9 failed")).toBe("GET /v#beta/models/flash:generateContent failed");
    expect(scrubText("Bearer sk-proj-4f9a8b7c6d5e4f3a2b1c rejected")).toBe("[redacted] rejected");
    expect(scrubText("HRV 72.5 ms below 80, steps 10,234")).toBe("HRV # ms below #, steps #");
    expect(scrubText("x".repeat(500))).toHaveLength(200);
  });

  it("builds the event from an allowlist", async () => {
    const { scrubEvent } = await load();
    const event = {
      type: undefined,
      event_id: "e1",
      level: "error",
      release: "in.portlabs.pulse@0.5.0+12",
      fingerprint: ["coach.provider"],
      tags: { code: "coach.provider", status: 401, nested: { no: 1 } },
      message: "resting HR 58 bpm",
      user: { id: "install-id", email: "me@example.com", ip_address: "1.2.3.4" },
      request: { url: "https://api.openai.com/v1/chat?key=sk-123", headers: { Authorization: "Bearer sk-1234567890abcdefgh" } },
      extra: { body: "sleep 7.5 h" },
      breadcrumbs: [{ category: "console", message: "hrv 40" }],
      modules: { ai: "7" },
      contexts: { device: { model: "Pixel 8", name: "Aditya’s Pixel", battery_level: 54 }, os: { name: "Android", version: "15", kernel_version: "x" }, app: { app_version: "0.5.0", app_start_time: "t" }, culture: { locale: "en-IN" }, trace: { trace_id: "t" } },
      exception: {
        values: [
          {
            type: "AI_APICallError",
            value: "Request to https://generativelanguage.googleapis.com/v1/models?key=AIzaSyA1b2C3d4E5f6G7h8I9 failed: weight 81.2 kg",
            mechanism: { type: "generic", handled: true, data: { url: "x" } },
            stacktrace: { frames: [{ filename: "app:///index.android.bundle", abs_path: "app:///index.android.bundle", function: "sync", lineno: 1, colno: 2, in_app: true, context_line: "const key = 'k'", vars: { hrv: 40 } }] },
          },
        ],
      },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    const text = JSON.stringify(out);
    for (const leak of ["AIza", "key=", "googleapis", "81", "58", "email", "ip_address", "request", "extra", "breadcrumbs", "modules", "Aditya", "battery", "culture", "trace_id", "vars", "context_line", "kernel"]) expect(text).not.toContain(leak);
    expect(out.exception?.values?.[0].value).toBe("Request to /v#/models failed: weight # kg");
    expect(out.message).toBe("resting HR # bpm");
    expect(out.user).toEqual({ id: "install-id" });
    expect(out.tags).toEqual({ code: "coach.provider", status: 401 });
    expect(out.contexts).toEqual({ device: { model: "Pixel 8" }, os: { name: "Android", version: "15" }, app: { app_version: "0.5.0" } });
    expect(out.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({ filename: "app:///index.android.bundle", abs_path: "app:///index.android.bundle", function: "sync", lineno: 1, colno: 2, in_app: true });
  });
});

describe("errorKind", () => {
  it("names an error without its details", async () => {
    const { errorKind } = await load();
    expect(errorKind(new Error("store_not_open"))).toBe("store_not_open");
    expect(errorKind(Object.assign(new Error("Bad record at 12:00"), { code: "ARGUMENT_VALIDATION_ERROR" }))).toBe("ARGUMENT_VALIDATION_ERROR");
    expect(errorKind(new Error("java.lang.SecurityException: Caller doesn't have permission to read data"))).toBe("permission");
    expect(errorKind(new Error("database disk image is malformed"))).toBe("storage");
    expect(errorKind(new TypeError("Cannot read property 'hrv' of undefined"))).toBe("TypeError");
    expect(errorKind("weird")).toBe("weird");
    expect(errorKind(42)).toBe("unknown");
  });
});
