// The day's timeline from its stays (docs/timeline.md): the owner's edits on top, then the trips and unknown gaps
// between stays, and the week's totals. Pure: no clock, no store.
import { distanceM } from "./geo";
import { MOVE_BUCKET_S, type Fix, type FrozenStay, type MoveBucket, type Stay, type TimelineOverride } from "./types";

/** A gap with no movement and no stay on either side reads as a trip only up to this long; longer is "no location". */
export const TRIP_MAX_S = 3 * 3600;
/** Pieces shorter than this, left by an edit, are dropped. */
const MIN_PIECE_S = 60;

const cut = (s: Stay, start: number, end: number): Stay[] => {
  if (end <= s.start || start >= s.end) return [s];
  const keep: Stay[] = [];
  if (start > s.start) keep.push({ ...s, end: start, open: false, capped: false });
  if (end < s.end) keep.push({ ...s, start: end });
  return keep.filter((p) => p.end - p.start >= MIN_PIECE_S);
};

/** Applies the owner's edits in the order they were made; a `clear` before a `stay` made in the same second. */
export function applyOverrides(stays: readonly Stay[], overrides: readonly TimelineOverride[], from: number, to: number): Stay[] {
  const ordered = [...overrides].sort((a, b) => a.createdAt - b.createdAt || (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "clear" ? -1 : 1));
  let out = [...stays];
  for (const o of ordered) {
    out = out.flatMap((s) => cut(s, o.start, o.end));
    if (o.kind !== "stay") continue;
    const start = Math.max(o.start, from);
    const end = Math.min(o.end, to);
    if (end - start < MIN_PIECE_S) continue;
    out.push({ start, end, open: false, capped: false, placeId: o.placeId, latitude: o.latitude, longitude: o.longitude, label: o.label, overrideId: o.id });
  }
  return out.sort((a, b) => a.start - b.start);
}

export const frozenToStay = (f: FrozenStay): Stay => ({
  start: f.start,
  end: f.end,
  open: false,
  capped: f.capped,
  placeId: f.placeId,
  latitude: f.latitude,
  longitude: f.longitude,
  label: null,
  overrideId: null,
});

/**
 * Metres moved per MOVE_BUCKET_S slot, credited to the slot of the later fix. A step shorter than the two fixes' error
 * (or 25 m) is GPS jitter, not movement.
 */
export function movementOf(fixes: readonly Fix[]): MoveBucket[] {
  const sorted = fixes.filter((f) => f.accuracyM === null || f.accuracyM <= 100).sort((a, b) => a.ts - b.ts);
  const buckets = new Map<number, number>();
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const d = distanceM(a.latitude, a.longitude, b.latitude, b.longitude);
    if (d < Math.max(25, (a.accuracyM ?? 0) + (b.accuracyM ?? 0))) continue;
    const k = Math.floor(b.ts / MOVE_BUCKET_S);
    buckets.set(k, (buckets.get(k) ?? 0) + d);
  }
  return [...buckets].map(([bucket, metres]) => ({ bucket, metres })).sort((a, b) => a.bucket - b.bucket);
}

/** Metres moved in slots that start inside [start, end]. */
export function movedIn(buckets: readonly MoveBucket[], start: number, end: number): number {
  let m = 0;
  for (const b of buckets) {
    const t = b.bucket * MOVE_BUCKET_S;
    if (t >= start - MOVE_BUCKET_S && t < end) m += b.metres;
  }
  return m;
}

export type TimelineEntry =
  | { kind: "stay"; start: number; end: number; stay: Stay }
  | {
      kind: "trip";
      start: number;
      end: number;
      fromPlaceId: string | null;
      toPlaceId: string | null;
      /** Path distance from the fixes, or the straight line between the stays when that is longer; null with neither. */
      metres: number | null;
      /** True when only the straight line was known (no fixes on the way). */
      approx: boolean;
      /** Still moving: the trip ends now. */
      open: boolean;
    }
  | { kind: "gap"; start: number; end: number };

/**
 * Stays, the trips between them and gaps nothing explains, covering [from, to). A gap is a trip when the fixes moved
 * in it, or when it is short enough to be one; a long still gap is honest "no location", never a made-up trip.
 */
export function entriesOf(stays: readonly Stay[], from: number, to: number, buckets: readonly MoveBucket[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const sorted = [...stays].sort((a, b) => a.start - b.start);
  const gap = (start: number, end: number, before: Stay | null, after: Stay | null) => {
    if (end - start < MIN_PIECE_S) return;
    const path = movedIn(buckets, start, end);
    const straight =
      before && after && before.latitude !== null && before.longitude !== null && after.latitude !== null && after.longitude !== null
        ? distanceM(before.latitude, before.longitude, after.latitude, after.longitude)
        : 0;
    const open = !after && end === to;
    const trip = path > 0 || (before !== null && (after !== null || open) && end - start <= TRIP_MAX_S);
    if (!trip) return out.push({ kind: "gap", start, end });
    const metres = Math.max(path, straight);
    out.push({ kind: "trip", start, end, fromPlaceId: before?.placeId ?? null, toPlaceId: after?.placeId ?? null, metres: metres > 0 ? metres : null, approx: path === 0, open });
  };
  let cursor = from;
  let prev: Stay | null = null;
  for (const s of sorted) {
    if (s.start > cursor) gap(cursor, s.start, prev, s);
    out.push({ kind: "stay", start: s.start, end: s.end, stay: s });
    cursor = Math.max(cursor, s.end);
    prev = s;
  }
  if (to > cursor) gap(cursor, to, prev, null);
  return out;
}

export type WeekTotals = {
  /** Minutes and arrivals per saved place, most time first. */
  places: { placeId: string; minutes: number; visits: number }[];
  unknownMinutes: number;
  unknownStops: number;
  trips: { count: number; minutes: number; metres: number };
};

/**
 * Totals over days of entries. A stay that starts exactly at its day's start continues the day before's, so it adds
 * time but not an arrival.
 */
export function weekTotals(days: readonly { dayStart: number; entries: readonly TimelineEntry[] }[]): WeekTotals {
  const places = new Map<string, { minutes: number; visits: number }>();
  let unknownMinutes = 0;
  let unknownStops = 0;
  const trips = { count: 0, minutes: 0, metres: 0 };
  for (const { dayStart, entries } of days) {
    for (const e of entries) {
      const minutes = (e.end - e.start) / 60;
      if (e.kind === "trip") {
        trips.minutes += minutes;
        trips.metres += e.metres ?? 0;
        if (e.start !== dayStart) trips.count++;
      } else if (e.kind === "stay") {
        const arrival = e.start !== dayStart;
        if (e.stay.placeId) {
          const p = places.get(e.stay.placeId) ?? { minutes: 0, visits: 0 };
          p.minutes += minutes;
          if (arrival) p.visits++;
          places.set(e.stay.placeId, p);
        } else {
          unknownMinutes += minutes;
          if (arrival) unknownStops++;
        }
      }
    }
  }
  return {
    places: [...places].map(([placeId, p]) => ({ placeId, minutes: Math.round(p.minutes), visits: p.visits })).sort((a, b) => b.minutes - a.minutes),
    unknownMinutes: Math.round(unknownMinutes),
    unknownStops,
    trips: { count: trips.count, minutes: Math.round(trips.minutes), metres: Math.round(trips.metres) },
  };
}
