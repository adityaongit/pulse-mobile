// More, Settings and the shell's status (spec §7.14, §4.2). Ported from pulse src/server/queries/settings.ts: reads go
// through the repositories; there is no demo mode, no user id and no worker (the phone syncs itself, and the background
// stream says whether a run is going: `getShellStatus`'s `syncing` argument).
import { missingScopes } from "../google/oauth";
import { SCORING_VERSION } from "../pipeline";
import { addDays, wholeYears } from "../time";
import { latestReport } from "./home";
import { firstDay, type QueryCtx, todayOf } from "./common";
import type { MoreVM, SettingsVM, ShellStatusVM, YourDataVM } from "./types";

export const APP_VERSION = "0.1.0";
const STALE_MS = 2 * 3600_000;

/** Google sync jobs grouped as Settings lists them. */
const GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "heart-rate", label: "Heart rate", types: ["heart-rate"] },
  { key: "steps", label: "Steps", types: ["steps", "steps-daily"] },
  { key: "sleep", label: "Sleep", types: ["sleep"] },
  { key: "hrv", label: "Heart rate variability", types: ["daily-heart-rate-variability"] },
  { key: "rhr", label: "Resting heart rate", types: ["daily-resting-heart-rate"] },
  { key: "resp", label: "Respiratory rate", types: ["daily-respiratory-rate"] },
  { key: "temp", label: "Skin temperature", types: ["daily-sleep-temperature-derivations"] },
  { key: "zones", label: "Heart rate zones", types: ["daily-heart-rate-zones", "time-in-heart-rate-zone"] },
  { key: "spo2", label: "Blood oxygen", types: ["daily-oxygen-saturation"] },
  { key: "exercise", label: "Exercise", types: ["exercise"] },
  { key: "vo2max", label: "VO2 max", types: ["daily-vo2-max", "run-vo2-max"] },
  { key: "calories", label: "Calories", types: ["total-calories"] },
  { key: "weight", label: "Weight and body fat", types: ["weight", "body-fat", "height"] },
  { key: "activity", label: "Distance, floors and active minutes", types: ["distance", "floors", "altitude", "active-zone-minutes", "active-minutes", "active-energy-burned", "sedentary-period", "heart-rate-daily", "swim-lengths-data"] },
  // logged-entries: Journal › Log's import of entries logged in other apps (sync.ts LOG_IMPORT_KEY).
  { key: "nutrition", label: "Food and water", types: ["hydration-log", "nutrition-log", "logged-entries"] },
  { key: "vitals", label: "Glucose and core temperature", types: ["blood-glucose", "core-body-temperature"] },
  { key: "rhythm", label: "ECG and irregular rhythm", types: ["electrocardiogram", "irregular-rhythm-notification"] },
];

/**
 * Shown-only types (extra metrics, records, height) and the Google inputs Pulse falls back from (zones, personal
 * ranges). Optional for the shell: one that fails (a scope granted only on the next consent, a type the account never
 * has) shows in Settings, but never turns the sync dot red or holds the import banner open.
 */
const OPTIONAL_TYPES = new Set(GROUPS.filter((g) => ["zones", "activity", "nutrition", "vitals", "rhythm"].includes(g.key)).flatMap((g) => g.types).concat("height"));

/** Types every Google account syncs: the shell's sync dot and the import banner follow these alone. */
const CORE_TYPES = new Set(GROUPS.flatMap((g) => g.types).filter((t) => !OPTIONAL_TYPES.has(t)));

type SyncRow = {
  type: string;
  lastSuccessAt: number | null;
  lastError: string | null;
  backfillDaysDone: number | null;
  backfillDaysTotal: number | null;
};

const syncRows = (ctx: QueryCtx): Promise<SyncRow[]> => ctx.store.settings.readSyncState();

/** The sync's paired-device check (src/google/sync.ts `DEVICES_KEY`): account state, not a data type. */
const DEVICES_ROW = "paired-devices";

/**
 * "not_linked": the grant works but the Google account has no Google Health profile, so every type fails the same way.
 * "no_device": it has a profile but no paired Fitbit device, so every type imports nothing.
 */
async function authState(ctx: QueryCtx, rows: SyncRow[]): Promise<"not_connected" | "not_linked" | "no_device" | "connected" | "revoked"> {
  const grant = await ctx.store.settings.get("google.grant");
  if (!grant) return "not_connected";
  if (grant.revokedAt != null) return "revoked";
  if (rows.some((r) => r.lastError?.includes("ACCOUNT_NOT_LINKED"))) return "not_linked";
  return rows.some((r) => r.type === DEVICES_ROW && r.lastError?.includes("NO_PAIRED_DEVICE")) ? "no_device" : "connected";
}

/**
 * A sync error as a person reads it. `last_error` is `[google] <type>: <CODE> (HTTP n)` (GoogleError); the
 * code is kept in brackets for a bug report, the rest is dropped.
 */
export function syncErrorText(raw: string): string {
  const code = /: ([A-Za-z_0-9]+)(?: \(HTTP \d+\))?$/.exec(raw)?.[1] ?? raw;
  const text: Record<string, string> = {
    ACCOUNT_NOT_LINKED: "No Google Health profile",
    auth_revoked: "Access revoked",
    not_connected: "Not connected",
    RESOURCE_EXHAUSTED: "Rate limited, retrying",
    http_429: "Rate limited, retrying",
    PERMISSION_DENIED: "Permission missing",
  };
  return text[code] ?? (/^http_5\d\d$/.test(code) ? "Google is having trouble, retrying" : `Failed (${code})`);
}

/** The core types' backfill only: an optional type that keeps failing (or a retired job's leftover row) never holds it at 0. */
function importProgress(all: SyncRow[]) {
  const rows = all.filter((r) => CORE_TYPES.has(r.type));
  const pending = rows.filter((r) => r.backfillDaysTotal != null && (r.backfillDaysDone ?? 0) < r.backfillDaysTotal);
  if (!pending.length) return null;
  return { done: Math.min(...pending.map((r) => r.backfillDaysDone ?? 0)), total: Math.max(...pending.map((r) => r.backfillDaysTotal!)) };
}

/** Settings `/settings`: data source, auth, per-type sync status, backfill progress and the profile. */
export async function getSettings(ctx: QueryCtx): Promise<SettingsVM> {
  const nowMs = ctx.now * 1000;
  const rows = await syncRows(ctx);
  const statusOf = (last: number | null, error: string | null) => (error ? "error" : last == null ? "never" : nowMs - last * 1000 > STALE_MS ? "stale" : "ok");
  const auth = await authState(ctx, rows);
  const needsPermissions = (auth === "connected" || auth === "no_device") && (await missingScopes(ctx.store)).length > 0;
  // Not linked is one account-level problem, said once in Data source, not on every row.
  const rowError = (e: string | null) => (e && auth !== "not_linked" ? syncErrorText(e) : null);
  const sync: SettingsVM["sync"] = GROUPS.map((g) => {
    const members = rows.filter((r) => g.types.includes(r.type));
    const successes = members.map((r) => r.lastSuccessAt);
    const last = members.length && successes.every((s) => s != null) ? Math.min(...(successes as number[])) : null;
    const error = rowError(members.find((r) => r.lastError)?.lastError ?? null);
    return { key: g.key, label: g.label, lastSuccessAt: last && last * 1000, status: statusOf(last, error), error };
  });
  const p = ctx.profile;
  return {
    mode: "google",
    source: { label: "Google Health", status: auth, needsPermissions },
    import: auth === "connected" ? importProgress(rows) : null,
    sync,
    profile: {
      birthDate: p.birthDate,
      age: wholeYears(p.birthDate, todayOf(ctx)),
      sex: p.sex,
      maxHr: p.maxHr,
      maxHrSource: p.maxHrSource,
      timeZone: ctx.timeZone,
      heightCm: p.heightCm,
    },
    version: APP_VERSION,
    scoringVersion: SCORING_VERSION,
  };
}

/** More `/more`. */
export async function getMore(ctx: QueryCtx): Promise<MoreVM> {
  const [tags, latestWeek, latestMonth, reportCount] = await Promise.all([
    ctx.store.journal.tagCounts(),
    latestReport(ctx, "week"),
    latestReport(ctx, "month"),
    ctx.store.scores.countReportsWithData(),
  ]);
  return { latestWeek, latestMonth, reportCount, behaviours: tags, mode: "google", version: APP_VERSION, scoringVersion: SCORING_VERSION };
}

/** Your data `/more/data`: what each export holds. */
export async function getYourData(ctx: QueryCtx): Promise<YourDataVM> {
  const [first, days, answers] = await Promise.all([firstDay(ctx), ctx.store.scores.countDays(todayOf(ctx)), ctx.store.journal.answerCount()]);
  return { first, days: first ? days : 0, answers, mode: "google" };
}

/** Settings › App: the theme and the notification toggles (all off until the person turns them on). */
export type AppPrefs = { theme: "system" | "light" | "dark"; notifyRecovery: boolean; notifySyncProblem: boolean };

export async function getAppPrefs(ctx: QueryCtx): Promise<AppPrefs> {
  const { settings } = ctx.store;
  const [theme, recovery, syncProblem] = await Promise.all([settings.get("theme"), settings.get("notify.recovery"), settings.get("notify.syncProblem")]);
  return { theme: theme ?? "system", notifyRecovery: recovery ?? false, notifySyncProblem: syncProblem ?? false };
}

/** Your data › Coach: the card shows only once a chat is saved. */
export async function hasCoachChats(ctx: QueryCtx): Promise<boolean> {
  return (await ctx.store.coach.listChats()).chats.length > 0;
}

/** Today counts toward the streak once it has this many minutes of heart rate; until then the streak ends yesterday. */
const STREAK_TODAY_MIN = 6 * 60;

/**
 * Consecutive worn days (spec §4.3, I4): the reference app's "continuous data" streak. A day is worn when it has any
 * heart rate, the same rule that keeps `band_not_worn` off its Strain. Null when the streak is 0.
 */
export async function getWearStreak(ctx: QueryCtx): Promise<{ days: number; asOf: string } | null> {
  const today = todayOf(ctx);
  // ponytail: reads every scored day to find the first gap; page by a few hundred days if histories grow long.
  const rows = await ctx.store.scores.wearDays(today);
  let expected = today;
  let asOf: string | null = null;
  let days = 0;
  for (const r of rows) {
    if (r.day !== expected) break;
    expected = addDays(r.day, -1);
    // Today neither counts nor breaks the streak until it has enough data.
    if (r.day === today && r.hrMinutes < STREAK_TODAY_MIN) continue;
    if (r.hrCount <= 0) break;
    asOf ??= r.day;
    days++;
  }
  return days > 0 && asOf ? { days, asOf } : null;
}

/**
 * The shell's ShellStatus (top bar, sync dot, ConnectionBanner). `syncing` is whether a sync run is going: the
 * background stream knows, so it passes it (pulse read the worker's global).
 */
export async function getShellStatus(ctx: QueryCtx, syncing = false): Promise<ShellStatusVM> {
  const [all, first, streak] = await Promise.all([syncRows(ctx), firstDay(ctx), getWearStreak(ctx)]);
  // The device check is account state (connection below), not a sync that succeeded or failed.
  // Core types only: an optional type, or a retired job's leftover row (rhr/hrv personal ranges), never turns the dot red.
  const auth = await authState(ctx, all);
  const rows = all.filter((r) => CORE_TYPES.has(r.type));
  const successes = rows.map((r) => r.lastSuccessAt).filter((s): s is number => s != null);
  const lastSuccessAt = successes.length ? Math.max(...successes) * 1000 : null;
  const stale = lastSuccessAt == null || ctx.now * 1000 - lastSuccessAt > STALE_MS;
  const error = rows.some((r) => r.lastError);
  const progress = auth === "connected" ? importProgress(rows) : null;
  const connection: ShellStatusVM["connection"] =
    auth === "not_connected" || auth === "not_linked" || auth === "no_device" ? auth : auth === "revoked" ? "auth_revoked" : progress ? "importing" : stale ? "stale" : "connected";
  return {
    mode: "google",
    sync: { state: syncing ? "syncing" : error ? "error" : stale ? "stale" : "ok", lastSuccessAt },
    connection,
    ...(progress && { importProgress: progress }),
    today: todayOf(ctx),
    ...(first && { firstDay: first }),
    timeZone: ctx.timeZone,
    streak,
  };
}
