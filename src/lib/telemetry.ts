// Error telemetry (docs/telemetry.md): crashes, a short list of coded problems, sampled performance traces and coded
// logs go to Sentry, on by default, off in Settings › App › Privacy. Nothing initialises without EXPO_PUBLIC_SENTRY_DSN, so local and development builds send
// nothing. Every event passes scrubEvent: an allowlist of fields, URLs cut to their path, key-like strings redacted,
// numbers replaced. Codes are stable dotted strings ("sync.failed"); their tags carry enums and small counts, never a
// health value. A code with the same tags goes at most once per install, app version and local day; crashes always go.
// The SDK and storage load lazily, so a module that reports can be imported in Node tests without either.
import type { Breadcrumb, ErrorEvent, Event, TransactionEvent } from "@sentry/react-native";
import app from "../../app.json";
import { localDay } from "./time";

type Sentry = typeof import("@sentry/react-native");
type Options = NonNullable<Parameters<Sentry["init"]>[0]>;
type Log = Parameters<NonNullable<Options["beforeSendLog"]>>[0];
type SpanJSON = Parameters<NonNullable<Options["beforeSendSpan"]>>[0];
export type Tags = Record<string, string | number | boolean>;

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";
/** "off" when the person turned telemetry off. */
const OFF_KEY = "pulse.telemetry";
/** The random install id, Sentry's user id; Delete Everything makes a new one. */
const ID_KEY = "pulse.telemetry.id";
/** What went today: { day, version, keys }. */
const SENT_KEY = "pulse.telemetry.sent";

type Storage = typeof import("@react-native-async-storage/async-storage").default;
let store: Promise<Storage> | null = null;
/** AsyncStorage, imported once (lazily, so Node tests can import this module without it). */
const storage = () => (store ??= import("@react-native-async-storage/async-storage").then((m) => m.default));

let sentry: Promise<Sentry | null> | null = null;
/** The live gate beforeSend reads: false the moment the switch goes off, so nothing still in the pipeline goes out. */
let on = false;
/** Share of sessions whose performance is traced (docs/telemetry.md, Volume). */
const TRACES_SAMPLE_RATE = 0.2;
/** Expo Router's navigation container, registered once Sentry's navigation integration exists. */
type NavigationRef = Parameters<ReturnType<Sentry["reactNavigationIntegration"]>["registerNavigationContainer"]>[0];
let navigationRef: NavigationRef | null = null;
let navigation: ReturnType<Sentry["reactNavigationIntegration"]> | null = null;

/** Starts Sentry once per runtime, unless there is no DSN or the person turned it off. Never throws. */
export function initTelemetry(): Promise<Sentry | null> {
  sentry ??= start().catch(() => null);
  return sentry;
}

async function start(): Promise<Sentry | null> {
  if (!DSN) return null;
  const store = await storage();
  if ((await store.getItem(OFF_KEY).catch(() => null)) === "off") return null;
  const S = await import("@sentry/react-native");
  on = true;
  navigation = S.reactNavigationIntegration({ enableTimeToInitialDisplay: true });
  if (navigationRef) navigation.registerNavigationContainer(navigationRef);
  S.init({
    dsn: DSN,
    environment: typeof __DEV__ !== "undefined" && __DEV__ ? "development" : "production",
    sendDefaultPii: false,
    // No breadcrumbs anywhere: the option reaches the native SDK too, and beforeSend drops any that merge in.
    maxBreadcrumbs: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    // Logs come only from log() below: no console integration is added, so console lines never become logs.
    enableLogs: true,
    // Release health (sessions) and native crash handling stay on.
    enableAutoSessionTracking: true,
    enableNativeCrashHandling: true,
    // A fifth of sessions are traced: app start, screen loads and Pulse's own spans (sync, scoring). No HTTP spans: the
    // coach's URLs can hold its key, so fetch and XHR are not traced at all. No replay or profiling.
    tracesSampleRate: TRACES_SAMPLE_RATE,
    // Console, fetch and XHR breadcrumbs, and the request context, go with their integrations.
    integrations: (defaults) => [
      ...defaults.filter((i) => !DROPPED.has(i.name)),
      S.reactNativeTracingIntegration({ traceFetch: false, traceXHR: false, enableHTTPTimings: false }),
      navigation!,
    ],
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: (event) => (on ? scrubEvent(event) : null),
    beforeSendTransaction: (event) => (on ? scrubTransaction(event) : null),
    beforeSendSpan: scrubSpan,
    beforeSendLog: (entry) => (on ? scrubLog(entry) : null),
  });
  S.setUser({ id: await installId() });
  // Feedback (sendFeedback) skips beforeSend, but the device-context integration still merges every native context into
  // it (battery, memory, storage, locale, kernel, root). Scope processors run after the integrations' own, so this one
  // puts it through the same allowlist and keeps only the feedback itself.
  S.getGlobalScope().addEventProcessor((event) => (event.type === "feedback" ? (on ? scrubFeedback(event) : null) : event));
  return S;
}

// ReactNativeTracing and ReactNavigation are dropped from the defaults and added back configured (above).
const DROPPED = new Set(["Breadcrumbs", "HttpContext", "ReactNativeTracing", "ReactNavigation", "ConsoleLogs"]);

/** Expo Router's root layout hands its navigation container over, so screen loads are traced. Safe before init. */
export function registerNavigation(ref: NavigationRef): void {
  navigationRef = ref;
  navigation?.registerNavigationContainer(ref);
}

/** Whether telemetry is on (the Settings switch). */
export async function telemetryEnabled(): Promise<boolean> {
  return (await (await storage()).getItem(OFF_KEY).catch(() => null)) !== "off";
}

/** The Settings switch: off closes Sentry at once and drops what is still queued in JS; on starts it now. */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  await (await storage()).setItem(OFF_KEY, enabled ? "on" : "off");
  if (enabled) {
    if (!(await sentry)) sentry = null;
    await initTelemetry();
  } else {
    on = false;
    const S = await sentry;
    sentry = Promise.resolve(null);
    await S?.close();
  }
  // Shake to report follows the switch.
  const now = await shakeEnabled();
  shakeListeners.forEach((f) => f(now));
}

/** "off" when the person turned shake to report off; on by default, and only ever acts while telemetry runs. */
const SHAKE_KEY = "pulse.shake";
const shakeListeners = new Set<(on: boolean) => void>();

/** Whether a shake opens the report page: telemetry on and the shake switch not off. */
export async function shakeEnabled(): Promise<boolean> {
  return (await telemetryEnabled()) && (await (await storage()).getItem(SHAKE_KEY).catch(() => null)) !== "off";
}

/** The shake switch's own setting, whatever telemetry's is (the Settings row shows it). */
export async function shakeSetting(): Promise<boolean> {
  return (await (await storage()).getItem(SHAKE_KEY).catch(() => null)) !== "off";
}

export async function setShakeEnabled(enabled: boolean): Promise<void> {
  await (await storage()).setItem(SHAKE_KEY, enabled ? "on" : "off");
  const now = await shakeEnabled();
  shakeListeners.forEach((f) => f(now));
}

/** Calls `f` with shakeEnabled() now and whenever either switch changes; returns the unsubscribe. */
export function onShakeEnabled(f: (on: boolean) => void): () => void {
  shakeListeners.add(f);
  void shakeEnabled().then(f);
  return () => void shakeListeners.delete(f);
}

/**
 * A problem the person wrote and chose to send (the report page): their words as typed, cut to 4,000 characters, and
 * the screen's route name. The event goes through scrubFeedback (the start's scope processor), so nothing else of
 * theirs is added: no screenshot, no breadcrumbs, the install id and the allowlisted device, OS and app context only.
 * True once it is queued (the SDK sends it and retries); false when telemetry is off.
 */
export async function sendFeedback(message: string, screen: string): Promise<boolean> {
  try {
    const S = await sentry;
    if (!S || !on || !message.trim()) return false;
    S.captureFeedback({ message: message.trim().slice(0, 4000), source: "pulse.report", tags: { screen: scrubText(screen, 64) } });
    return true;
  } catch {
    return false;
  }
}

/** Delete Everything: a new install id (and a fresh sent-set), so nothing links the old data's reports to the new. */
export async function resetTelemetryId(): Promise<void> {
  const store = await storage();
  await store.multiRemove([ID_KEY, SENT_KEY]).catch(() => {});
  sent = null;
  const S = await sentry;
  if (S) S.setUser({ id: await installId() });
}

async function installId(): Promise<string> {
  const store = await storage();
  const saved = await store.getItem(ID_KEY).catch(() => null);
  if (saved) return saved;
  const id = uuid();
  await store.setItem(ID_KEY, id).catch(() => {});
  return id;
}

/** A random v4 UUID; an install id, not a secret, so Math.random is enough. */
const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((c === "x" ? 0 : 8) + Math.floor(Math.random() * (c === "x" ? 16 : 4))).toString(16));

// ── Volume ──────────────────────────────────────────────────────────────────

type Sent = { day: string; version: string; keys: string[] };
let sent: Promise<Sent> | null = null;
const today = () => localDay(Date.now() / 1000, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

/**
 * True the first time `key` is asked for on this local day and app version (and remembers it); false after, and false
 * whenever telemetry is not running. The data-gap checks use it for their once-a-day gate too.
 */
export async function once(key: string): Promise<boolean> {
  if (!(await sentry) || !on) return false;
  sent ??= storage()
    .then((s) => s.getItem(SENT_KEY))
    .then((raw) => (raw ? (JSON.parse(raw) as Sent) : null))
    .catch(() => null)
    .then((s) => s ?? { day: "", version: "", keys: [] });
  const s = await sent;
  const day = today();
  if (s.day !== day || s.version !== app.expo.version) Object.assign(s, { day, version: app.expo.version, keys: [] });
  if (s.keys.includes(key)) return false;
  s.keys.push(key);
  await storage().then((st) => st.setItem(SENT_KEY, JSON.stringify(s))).catch(() => {});
  return true;
}

const keyOf = (code: string, tags: Tags) => `${code}${JSON.stringify(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)))}`;
/** Tag values are enums and small numbers; a string is cut short in case one ever carries more. */
const clean = (tags: Tags): Tags => Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 64) : v]));

/** A coded problem without an exception. Grouped in Sentry by `code`. Never throws. */
export async function report(code: string, tags: Tags = {}): Promise<void> {
  try {
    const S = await sentry;
    if (!S || !(await once(keyOf(code, tags)))) return;
    S.captureMessage(code, { level: "warning", fingerprint: [code], tags: { ...clean(tags), code } });
  } catch {
    // Telemetry never breaks the app.
  }
}

/** A coded problem with the error behind it (its stack, message scrubbed). Grouped by `code`. Never throws. */
export async function reportError(code: string, error: unknown, tags: Tags = {}): Promise<void> {
  try {
    const S = await sentry;
    const all = { ...tags, kind: errorKind(error) };
    if (!S || !(await once(keyOf(code, all)))) return;
    S.captureException(error, { level: "error", fingerprint: [code], tags: { ...clean(all), code } });
  } catch {
    // Telemetry never breaks the app.
  }
}

/**
 * Runs `run` inside a span named `name` (a stable code, like the report codes) when this session is traced; otherwise
 * just runs it. Attributes follow the tag rules: enums and small counts. Never throws for telemetry's sake.
 */
export async function traced<T>(name: string, attributes: Tags, run: () => Promise<T>): Promise<T> {
  const S = await (sentry ?? Promise.resolve(null)).catch(() => null);
  if (!S || !on) return run();
  return S.startSpan({ name, op: `pulse.${name.split(".")[0]}`, attributes: clean(attributes) }, run);
}

/**
 * A coded log line (`sync.done`, `pipeline.done`) with attributes that follow the tag rules. Logs give an error the
 * steps that led to it; they are not deduped, so keep them to a few per sync. Never throws.
 */
export async function log(level: "info" | "warn" | "error", code: string, attributes: Tags = {}): Promise<void> {
  try {
    const S = await (sentry ?? Promise.resolve(null));
    if (!S || !on) return;
    S.logger[level](code, { ...clean(attributes), code });
  } catch {
    // Telemetry never breaks the app.
  }
}

/** A render error a screen's boundary caught: a crash in all but name, so never deduped and grouped by its stack. */
export async function reportCrash(error: unknown, code = "render.screen"): Promise<void> {
  try {
    (await sentry)?.captureException(error, { level: "fatal", tags: { code } });
  } catch {
    // Telemetry never breaks the app.
  }
}

/**
 * A coarse, safe name for an error: the app's own short codes ("store_not_open", "invalidCursor") and the libraries'
 * upper-case codes as they are, else a class of failure read from the message, else the error's class name.
 */
export function errorKind(e: unknown): string {
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (/^[A-Za-z_]{3,32}$/.test(message)) return message;
  const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined;
  if (typeof code === "string" && /^[A-Z_]{3,40}$/.test(code)) return code;
  for (const [kind, re] of KINDS) if (re.test(message)) return kind;
  return e instanceof Error && /^\w{1,40}$/.test(e.name) ? e.name : "unknown";
}

const KINDS: [string, RegExp][] = [
  ["permission", /SecurityException|permission/i],
  ["timeout", /timed? ?out/i],
  ["storage", /sqlite|database|disk|no space/i],
  ["network", /network|fetch|connect|socket/i],
  ["remote", /RemoteException|binder|service/i],
];

// ── Scrubbing ───────────────────────────────────────────────────────────────

/**
 * Free text made safe to send: a URL keeps only its path (no host, no query: Gemini puts the key in it), anything
 * key-like (16 or more letters, digits, - or _ with a digit among them) is redacted, every number becomes #, and the
 * whole is cut to `max` characters.
 */
export function scrubText(text: string, max = 200): string {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, (u) => {
      const path = u.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "").replace(/[?#].*$/, "");
      return path || "/";
    })
    .replace(/[?&](?:key|api_key|apikey|token|access_token)=[^&\s]*/gi, "")
    .replace(/(?:Bearer\s+)?(?=[\w-]*\d)[\w-]{16,}/g, "[redacted]")
    .replace(/\d+(?:[.,]\d+)*/g, "#")
    .slice(0, max);
}

/** Breadcrumbs carry console lines, URLs and touches: none is allowed. */
export const scrubBreadcrumb = (_b: Breadcrumb): Breadcrumb | null => null;

type Frame = NonNullable<NonNullable<NonNullable<ErrorEvent["exception"]>["values"]>[number]["stacktrace"]>["frames"];
const pick = <T extends object>(o: T | undefined, keys: readonly string[]) => (o ? Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, (o as Record<string, unknown>)[k]])) : undefined);
const DEVICE = ["family", "model", "manufacturer", "brand", "arch", "simulator"];
const OS = ["name", "version"];
const APP = ["app_identifier", "app_version", "app_build"];

/**
 * beforeSend: builds a new event from an allowlist. Kept: ids, time, level, release, environment, the SDK, the
 * fingerprint, primitive tags, the debug images (for source maps), the install id, the basic device, OS and app
 * context, and the exception with its message scrubbed and its frames without source lines or variables. Dropped:
 * request, extra, breadcrumbs, modules, every other context and user field.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const tags = event.tags && Object.fromEntries(Object.entries(event.tags).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)));
  const frames = (fs: Frame) => fs?.map(({ filename, abs_path, function: fn, module, lineno, colno, in_app, platform, instruction_addr }) => ({ filename, abs_path, function: fn, module, lineno, colno, in_app, platform, instruction_addr }));
  const out: ErrorEvent = {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    dist: event.dist,
    environment: event.environment,
    sdk: event.sdk,
    fingerprint: event.fingerprint,
    tags,
    debug_meta: event.debug_meta,
    message: event.message === undefined ? undefined : scrubText(event.message),
    user: typeof event.user?.id === "string" ? { id: event.user.id } : undefined,
    contexts: { device: pick(event.contexts?.device, DEVICE), os: pick(event.contexts?.os, OS), app: pick(event.contexts?.app, APP) },
    exception: event.exception && {
      values: event.exception.values?.map((v) => ({
        type: v.type && scrubText(v.type, 80),
        value: v.value && scrubText(v.value),
        mechanism: v.mechanism && { type: v.mechanism.type, handled: v.mechanism.handled },
        stacktrace: v.stacktrace && { frames: frames(v.stacktrace.frames) },
      })),
    },
  };
  return JSON.parse(JSON.stringify(out)) as ErrorEvent;
}

/** A feedback event through scrubEvent's allowlist, keeping its type and the feedback context (the person's words). */
export function scrubFeedback(event: Event): Event {
  const base = scrubEvent(event as ErrorEvent);
  const feedback = event.contexts?.feedback;
  return JSON.parse(JSON.stringify({ ...base, type: "feedback", contexts: { ...base.contexts, feedback } })) as Event;
}

/** Span and log attribute keys the SDK sets itself (release, environment, SDK name, frame counts) pass as they are. */
const SDK_KEY = /^(sentry\.|frames\.|stall_|app_start|ttid|ttfd|thread\.|device\.|os\.|app\.)/;
/** Route names may be strings; any parameters (`route.params`, query strings) never are. */
const ROUTE_KEY = /^(route|previous_route)\.name$/;

/**
 * Attributes made safe: the SDK's own keys as they are, numbers and booleans, and strings only under a route-name key
 * or when they read as a short enum after scrubbing. Everything else (params, URLs, free text) is dropped.
 */
export function scrubAttributes(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (/params|url|query|http|body|message/i.test(k)) continue;
    if (SDK_KEY.test(k)) out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && (ROUTE_KEY.test(k) || /^[A-Za-z0-9_.:/()[\]-]{1,64}$/.test(v))) out[k] = scrubText(v, 64);
    else if (v && typeof v === "object" && "value" in v) {
      // A log attribute arrives as { value, type }.
      const inner = scrubAttributes({ [k]: (v as { value: unknown }).value });
      if (inner && k in inner) out[k] = { ...(v as object), value: inner[k] };
    }
  }
  return out;
}

/** beforeSendSpan: the span's name scrubbed (no URL host or query, no numbers) and its data allowlisted. */
export function scrubSpan(span: SpanJSON): SpanJSON {
  return { ...span, description: span.description && scrubText(span.description), data: (scrubAttributes(span.data) ?? {}) as SpanJSON["data"] };
}

/** beforeSendTransaction: the event's allowlist (scrubEvent) plus the transaction's name, timing, trace and spans. */
export function scrubTransaction(event: TransactionEvent): TransactionEvent {
  const base = scrubEvent(event as unknown as ErrorEvent) as unknown as TransactionEvent;
  const trace = event.contexts?.trace;
  return JSON.parse(
    JSON.stringify({
      ...base,
      type: "transaction",
      transaction: event.transaction && scrubText(event.transaction, 100),
      transaction_info: event.transaction_info && { source: event.transaction_info.source },
      start_timestamp: event.start_timestamp,
      measurements: event.measurements,
      contexts: { ...base.contexts, trace: trace && { trace_id: trace.trace_id, span_id: trace.span_id, parent_span_id: trace.parent_span_id, op: trace.op, status: trace.status, origin: trace.origin, data: scrubAttributes(trace.data) } },
      spans: event.spans?.map(scrubSpan),
    }),
  ) as TransactionEvent;
}

/** beforeSendLog: the message scrubbed like an event's and the attributes allowlisted. */
export function scrubLog(entry: Log): Log {
  return { ...entry, message: scrubText(String(entry.message)), attributes: scrubAttributes(entry.attributes as Record<string, unknown> | undefined) as Log["attributes"] };
}

