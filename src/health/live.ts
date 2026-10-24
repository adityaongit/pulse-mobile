// The "current heart rate": Pulse cannot talk to the band, so the newest reading is whatever the Google Health app has
// written to Health Connect (a Fitbit sync lands a batch of samples every ~15 minutes, sooner while that app is open),
// or, with a Google account as the source, what the Google Health API has (src/google/live.ts, passed in as
// `pullGoogle`). This is the cheap path the foreground ticker takes every minute: one short heart-rate read, the new
// samples written to the Store, today marked intraday-dirty so the next full run rescores it. No pipeline run.
import type { Store } from "@/data/store";
import type { HrSample } from "@/data/types";
import { availability, permissionState, readAll } from "@/health/connect";
import { mapHr } from "@/health/import";
import { localDay } from "@/lib/time";

/** How far back the ticker asks Health Connect: a Fitbit sync lands ~15 minutes of samples, plus slack. */
export const LIVE_READ_MINUTES = 20;
/** The window of samples kept for the sparkline: the 30 minutes ending at the newest reading. */
export const RECENT_MINUTES = 30;

export type LiveSource = "health_connect" | "google" | "demo";

export type LiveHrOptions = {
  /** Minutes before `now` to read from Health Connect (default LIVE_READ_MINUTES). */
  minutes?: number;
  /** Minutes before the newest reading returned in `samples` (default RECENT_MINUTES). */
  recentMinutes?: number;
  /** Demo reads the Store only: the demo generator wrote its samples, there is no Health Connect to ask. */
  source?: LiveSource;
  /** IANA zone, for the day marked dirty (default: the runtime's zone). */
  timeZone?: string;
  /** Unix seconds (tests); default Date.now(). */
  now?: number;
  /**
   * With Google as the source: the pull from the Google Health API (src/google/live.ts pullGoogleHeartRate), passed in
   * so this file and its tests never load Google sign-in. Returns the samples it added.
   */
  pullGoogle?: (store: Store, timeZone: string) => Promise<number>;
};

export type LiveHrResult = {
  /** The newest sample known, whether this read or an earlier sync brought it. Null when the Store has none. */
  latest: { ts: number; bpm: number } | null;
  /** The samples of the `recentMinutes` ending at `latest`, ascending. Empty when `latest` is null. */
  samples: HrSample[];
  /** Samples this read added or changed in the Store. */
  added: number;
  /** Why Health Connect was not read, or what failed reading it. The Store's samples are still returned. */
  error?: string;
};

const runtimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** The newest sample in the Store and the window of samples ending there. */
async function recentFromStore(store: Store, recentMinutes: number): Promise<Pick<LiveHrResult, "latest" | "samples">> {
  const bounds = await store.hrBounds();
  if (!bounds) return { latest: null, samples: [] };
  const samples = await store.readHr(bounds.last - recentMinutes * 60, bounds.last + 1);
  const last = samples.at(-1);
  return { latest: last ? { ts: last.ts, bpm: last.bpm } : null, samples };
}

/** The newest reading already in the Store and its recent window, with no Health Connect read (Pulse, not halo). */
export const storedRecentHeartRate = (store: Store) => recentFromStore(store, RECENT_MINUTES);

/**
 * Reads the last `minutes` of HeartRate from Health Connect, writes what is new, marks its days dirty and returns the
 * newest reading with its recent window. Errors never throw: they come back as `error` with the Store's own answer.
 */
export async function refreshRecentHeartRate(store: Store, opts: LiveHrOptions = {}): Promise<LiveHrResult> {
  const minutes = opts.minutes ?? LIVE_READ_MINUTES;
  const recentMinutes = opts.recentMinutes ?? RECENT_MINUTES;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  let added = 0;
  let error: string | undefined;

  if (opts.source === "google") {
    try {
      added = opts.pullGoogle ? await opts.pullGoogle(store, opts.timeZone ?? runtimeZone()) : 0;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  } else if (opts.source !== "demo") {
    try {
      added = await pullFromHealthConnect(store, now - minutes * 60, now, opts.timeZone ?? runtimeZone());
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  try {
    const recent = await recentFromStore(store, recentMinutes);
    return error ? { ...recent, added, error } : { ...recent, added };
  } catch (e) {
    return { latest: null, samples: [], added, error: error ?? (e instanceof Error ? e.message : String(e)) };
  }
}

/** One HeartRate read over [from, to) unix seconds; only samples the Store lacks (or has with another bpm) are written. */
async function pullFromHealthConnect(store: Store, from: number, to: number, timeZone: string): Promise<number> {
  if ((await availability()) !== "available") throw new Error("Health Connect is not available on this phone.");
  const perms = await permissionState();
  if (!perms.granted.includes("HeartRate")) throw new Error("Heart-rate permission is missing in Health Connect.");

  const records = await readAll("HeartRate", { start: new Date(from * 1000), end: new Date(to * 1000) });
  const incoming = mapHr(records, { startTs: from, endTs: to });
  if (!incoming.length) return 0;

  // The full sync re-imports whole days, so most of the window is already stored: write only the samples that moved.
  const stored = new Map((await store.readHr(from, to)).map((s) => [s.ts, s.bpm]));
  const fresh = incoming.filter((s) => stored.get(s.ts) !== s.bpm);
  if (!fresh.length) return 0;

  await store.putHr(fresh);
  await store.markIntradayDirty([...new Set(fresh.map((s) => localDay(s.ts, timeZone)))]);
  return fresh.length;
}
