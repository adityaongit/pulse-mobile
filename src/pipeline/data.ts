// Loading: the daily rows, sessions and exercises both stages fold over, and small shared helpers.
import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Repos } from "../data/repos";
import type { Session } from "../data/repos/sessions";
import { addDays, daysBetween, localDay, localMidnight } from "../time";
import type { PipelineOptions } from "./types";

// The row shapes are the repositories' (pulse declared them here).
export type { Exercise, Segment, Session } from "../data/repos/sessions";
export type { Metrics } from "../data/repos/daily";

export type Data = Awaited<ReturnType<typeof load>> & {};

export function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/**
 * Text order by UTF-8 bytes (code points), as the database's "C" collation sorts. Replaces `localeCompare`, which
 * follows the platform's ICU (Hermes differs from V8); data.test.ts proves both agree on every id the fixtures hold.
 */
export function byteCompare(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
  }
  return Number(i < a.length) - Number(i < b.length);
}

// Text tie-breaks sort bytewise ("C"), as SQLite did: session and exercise order feeds stage 1's keys and the naps
// list. The repositories return sessions and exercises in that order.
export async function load(store: Repos, { timeZone: tz }: PipelineOptions) {
  const [metrics, sessions, exercises, hrSpan] = await Promise.all([
    store.daily.readMetrics(),
    store.sessions.readSessions(),
    store.sessions.readExercises(),
    store.samples.sampleRange("hr"),
  ]);
  const candidates = [
    ...metrics.map((m) => m.day),
    ...sessions.map((s) => s.day),
    ...exercises.map((x) => x.day),
    ...(hrSpan ? [localDay(hrSpan.min, tz), localDay(hrSpan.max, tz)] : []),
  ].sort();
  if (!candidates.length) return null;
  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  const days = Array.from({ length: daysBetween(first, last) + 1 }, (_, i) => addDays(first, i));
  const start = new Map(days.map((d) => [d, localMidnight(d, tz)]));
  start.set(addDays(last, 1), localMidnight(addDays(last, 1), tz));

  const sessionsByDay = groupBy(sessions, (s) => s.day);
  const mainOf = new Map<string, Session>();
  for (const [day, list] of sessionsByDay) {
    const mains = list.filter((s) => s.isMain).sort((a, b) => b.endTs - b.startTs - (a.endTs - a.startTs) || byteCompare(a.id, b.id));
    if (mains.length) mainOf.set(day, mains[0]);
  }
  return {
    days,
    first,
    last,
    dayStart: (d: string) => start.get(d) ?? localMidnight(d, tz),
    metrics: new Map(metrics.map((m) => [m.day, m])),
    sessions,
    sessionsByDay,
    mainOf,
    exercises,
    exercisesByDay: groupBy(exercises, (x) => x.day),
  };
}

/** Sessions and exercises that overlap [lo, hi). */
export const touching = <T extends { startTs: number; endTs: number }>(xs: T[], lo: number, hi: number) =>
  xs.filter((x) => x.endTs > lo && x.startTs < hi);

// SHA-1 from @noble/hashes: Hermes has no node:crypto. data.test.ts checks it against node:crypto.
// Not in pulse: on a phone the pipeline shares the one JavaScript thread with the screens. A long synchronous loop calls
// this once per day; after 8 ms of work it yields a turn to the event loop, so frames, gestures and progress keep
// running. It changes no value (the F3 and F4 parity tests run through it).
let lastBreath = Date.now();
export async function breathe() {
  if (Date.now() - lastBreath < 8) return;
  await new Promise((r) => setTimeout(r, 0));
  lastBreath = Date.now();
}

export const sha = (s: string) => bytesToHex(sha1(utf8ToBytes(s))).slice(0, 16);
export const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
export const r1 = (x: number | null) => (x == null ? null : round(x, 1));

/** Days per write transaction: keeps memory flat in history length and each write lock short. */
export const BATCH_DAYS = 30;
