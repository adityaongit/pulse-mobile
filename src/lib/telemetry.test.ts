// Telemetry with Sentry and AsyncStorage mocked: nothing starts without a DSN, the switch stops sending at once, a code
// with the same tags goes once a day, and the scrubber lets no key, URL host, query or number through.
import type { ErrorEvent } from "@sentry/react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => new Map<string, string>());
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureMessage: vi.fn(),
  captureFeedback: vi.fn(),
  processors: [] as ((e: Record<string, unknown>) => unknown)[],
  getGlobalScope: vi.fn(() => ({ addEventProcessor: (f: (e: Record<string, unknown>) => unknown) => void sentry.processors.push(f) })),
  captureException: vi.fn(),
  close: vi.fn(async () => {}),
  startSpan: vi.fn((_opts: unknown, run: () => unknown) => run()),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  reactNativeTracingIntegration: vi.fn((o: unknown) => ({ name: "ReactNativeTracing", options: o })),
  reactNavigationIntegration: vi.fn(() => ({ name: "ReactNavigation", registerNavigationContainer: vi.fn() })),
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

  it("starts without PII, breadcrumbs, HTTP spans, replays or request context, as a random install id", async () => {
    const t = await load();
    await t.initTelemetry();
    const opts = sentry.init.mock.calls[0][0];
    expect(opts).toMatchObject({ dsn: DSN, sendDefaultPii: false, maxBreadcrumbs: 0, attachScreenshot: false, attachViewHierarchy: false, enableCaptureFailedRequests: false, tracesSampleRate: 0.2, enableLogs: true });
    expect(opts).not.toHaveProperty("replaysSessionSampleRate");
    expect(opts).not.toHaveProperty("profilesSampleRate");
    const defaults = ["Breadcrumbs", "HttpContext", "ReactNativeErrorHandlers", "ReactNativeTracing", "ConsoleLogs"].map((name) => ({ name }));
    const kept = opts.integrations(defaults).map((i: { name: string }) => i.name);
    // The tracing integration comes back configured, with no fetch or XHR spans; console lines never become logs.
    expect(kept).toEqual(["ReactNativeErrorHandlers", "ReactNativeTracing", "ReactNavigation"]);
    expect(sentry.reactNativeTracingIntegration).toHaveBeenCalledWith({ traceFetch: false, traceXHR: false, enableHTTPTimings: false });
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

describe("traces and logs", () => {
  it("runs work untraced and logs nothing without a DSN or with the switch off", async () => {
    const t = await load("");
    await t.initTelemetry();
    expect(await t.traced("sync", { owner: "app" }, async () => 7)).toBe(7);
    await t.log("info", "sync.done", { ms: 5 });
    expect(sentry.startSpan).not.toHaveBeenCalled();
    expect(sentry.logger.info).not.toHaveBeenCalled();

    const on = await load();
    await on.initTelemetry();
    await on.setTelemetryEnabled(false);
    expect(await on.traced("sync", {}, async () => 1)).toBe(1);
    await on.log("info", "sync.done");
    expect(sentry.startSpan).not.toHaveBeenCalled();
    expect(sentry.logger.info).not.toHaveBeenCalled();
  });

  it("spans and logs carry the code and clean attributes", async () => {
    const t = await load();
    await t.initTelemetry();
    expect(await t.traced("sync.health_connect", { owner: "task" }, async () => "ok")).toBe("ok");
    expect(sentry.startSpan.mock.calls[0][0]).toEqual({ name: "sync.health_connect", op: "pulse.sync", attributes: { owner: "task" } });
    await t.log("warn", "sync.read", { types: 12, records: 4810, full: false });
    expect(sentry.logger.warn).toHaveBeenCalledWith("sync.read", { types: 12, records: 4810, full: false, code: "sync.read" });
  });

  it("registers the navigation container whether it arrives before or after init", async () => {
    const t = await load();
    const ref = { current: null } as never;
    t.registerNavigation(ref);
    await t.initTelemetry();
    const nav = sentry.reactNavigationIntegration.mock.results[0].value;
    expect(nav.registerNavigationContainer).toHaveBeenCalledWith(ref);
  });

  it("drops span params, URLs and free text, keeping route names, counts and the SDK's keys", async () => {
    const t = await load();
    const span = t.scrubSpan({
      span_id: "a", trace_id: "b", start_timestamp: 1, op: "navigation",
      description: "GET https://generativelanguage.googleapis.com/v1/models?key=AIzaSyFAKEKEY1234567890 took 812ms",
      data: { "route.name": "metric/[key]", "route.params": { key: "hrv" }, "http.url": "https://x.io?key=1", "frames.total": 120, records: 4810, owner: "app", note: "HRV 81.1 ms on 2026-11-02", "sentry.release": "in.portlabs.pulse@0.5.0+1" },
    } as never);
    expect(span.description).toBe("GET /v#/models took #ms");
    expect(span.data).toEqual({ "route.name": "metric/[key]", "frames.total": 120, records: 4810, owner: "app", "sentry.release": "in.portlabs.pulse@0.5.0+1" });
  });

  it("builds a transaction from the allowlist, with scrubbed spans and no request", async () => {
    const t = await load();
    const out = t.scrubTransaction({
      type: "transaction", event_id: "e", transaction: "metric/[key]", start_timestamp: 1, timestamp: 2,
      transaction_info: { source: "component" }, measurements: { ttid: { value: 300, unit: "millisecond" } },
      request: { url: "https://x.io?key=1" }, extra: { hrv: 81 }, breadcrumbs: [{ message: "x" }],
      contexts: { trace: { trace_id: "t", span_id: "s", op: "navigation", data: { "route.params": { key: "hrv" }, "route.name": "metric/[key]" } }, culture: { locale: "de" } },
      spans: [{ span_id: "c", trace_id: "t", start_timestamp: 1, data: { url: "https://x.io" } }],
    } as never);
    expect(out).toMatchObject({ type: "transaction", transaction: "metric/[key]", measurements: { ttid: { value: 300 } } });
    expect(out).not.toHaveProperty("request");
    expect(out).not.toHaveProperty("extra");
    expect(out).not.toHaveProperty("breadcrumbs");
    expect(out.contexts).not.toHaveProperty("culture");
    expect(out.contexts?.trace?.data).toEqual({ "route.name": "metric/[key]" });
    expect(out.spans?.[0].data).toEqual({});
  });

  it("scrubs a log's message and attributes", async () => {
    const t = await load();
    const entry = t.scrubLog({
      level: "info", message: "sync.read 4810 records from https://x.io?key=AIzaSyFAKEKEY1234567890",
      attributes: { records: 4810, owner: "app", url: "https://x.io", note: "HRV 81.1 ms", "sentry.environment": "production", wrapped: { value: 12, type: "integer" } },
    } as never);
    expect(entry.message).toBe("sync.read # records from /");
    expect(entry.attributes).toEqual({ records: 4810, owner: "app", "sentry.environment": "production", wrapped: { value: 12, type: "integer" } });
  });
});

describe("report a problem", () => {
  it("sends the person's words and the screen only while telemetry runs; shake follows both switches", async () => {
    const t = await load();
    await t.initTelemetry();
    expect(await t.sendFeedback("   ", "/")).toBe(false);
    expect(await t.sendFeedback("  The sleep chart is blank  ", "/sleep")).toBe(true);
    expect(sentry.captureFeedback).toHaveBeenCalledWith({ message: "The sleep chart is blank", source: "pulse.report", tags: { screen: "/sleep" } });
    const seen: boolean[] = [];
    t.onShakeEnabled((on) => seen.push(on));
    await t.setShakeEnabled(false);
    await t.setShakeEnabled(true);
    await t.setTelemetryEnabled(false);
    expect(await t.sendFeedback("again", "/")).toBe(false);
    expect(seen.slice(-3)).toEqual([false, true, false]);
    expect(sentry.captureFeedback).toHaveBeenCalledTimes(1);
  });
});

describe("feedback events", () => {
  it("go through the allowlist: the person's words, the screen and the basic device context only", async () => {
    const t = await load();
    await t.initTelemetry();
    const processor = sentry.processors.at(-1)!;
    const out = processor({
      type: "feedback", event_id: "f", level: "info", tags: { screen: "/sleep" }, user: { id: "install", ip_address: "1.2.3.4" },
      contexts: {
        feedback: { message: "Sleep chart blank", source: "pulse.report" },
        device: { model: "CPH2611", battery_level: 81, memory_size: 12_000_000_000, free_storage: 5 },
        os: { name: "Android", version: "16", kernel_version: "6.6" },
        culture: { timezone: "Asia/Kolkata", locale: "en-IN" },
      },
      extra: { rooted: false },
    }) as Record<string, Record<string, unknown>>;
    expect(out.type).toBe("feedback");
    expect(out.contexts.feedback).toEqual({ message: "Sleep chart blank", source: "pulse.report" });
    expect(out.contexts.device).toEqual({ model: "CPH2611" });
    expect(out.contexts.os).toEqual({ name: "Android", version: "16" });
    expect(out.contexts.culture).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(out.user).toEqual({ id: "install" });
    expect(out.tags).toEqual({ screen: "/sleep" });
    // Other events pass untouched (beforeSend scrubs them), and nothing goes once the switch is off.
    const error = { type: undefined, event_id: "e" };
    expect(processor(error)).toBe(error);
    await t.setTelemetryEnabled(false);
    expect(processor({ type: "feedback", contexts: {} })).toBeNull();
  });
});
