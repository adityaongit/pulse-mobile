// Stays from geofence events and GPS fixes (docs/timeline.md). Pure: the caller passes `now`, so the same rules run in
// Node tests, in the screens' queries and when a day is frozen.
//
// 1. Event visits: each saved place's enter/exit pairs. An arrival at another, separate place closes an open one; an
//    open visit that later fixes place elsewhere closes at the last fix inside; one with no evidence either way is
//    capped at MAX_VISIT_H rather than trusted as a 30-hour day.
// 2. Fix runs: consecutive fixes at one place, or within STAY_RADIUS_M of their centre, make a stay at that place or an
//    unknown stop. Unknown stops need MIN_STOP_S; place visits MIN_VISIT_S (a walk past the gym is not a visit).
// 3. One place's event visits and runs merge when they overlap or sit within MERGE_GAP_S.
// 4. Overlaps are painted: shorter place visits first (a gym hour inside a stale home span splits it), then unknown
//    stops into what is left.
import { distanceM } from "./geo";
import type { Fix, Place, PlaceEvent, Stay } from "./types";

/** Fixes reporting a worse accuracy than this are dropped: they cannot tell a street from the next. */
export const MAX_FIX_ACCURACY_M = 150;
/** At most this much of a fix's own accuracy widens a fence, so a coarse fix near a place still counts as there. */
const ACCURACY_SLACK_M = 50;
/** An unknown stop: fixes within this of their running centre. */
export const STAY_RADIUS_M = 120;
/** The shortest unknown stop the timeline shows. */
export const MIN_STOP_S = 10 * 60;
/** The shortest place visit: passing a fence is not a visit. */
export const MIN_VISIT_S = 5 * 60;
/** One place's visits this close together are one (stepping out to the car, a fence firing twice at its edge). */
export const MERGE_GAP_S = 15 * 60;
/** Fixes further apart than this never join one stay, even at the same spot. */
export const MAX_RUN_GAP_S = 12 * 3600;
/** A missed departure must not read as a whole day. */
export const MAX_VISIT_H = 16;
/** The last run is still going if its newest fix is this recent: Balanced mode's fixes can be 20 minutes apart. */
export const OPEN_GRACE_S = 30 * 60;

type Interval = {
  start: number;
  end: number;
  open: boolean;
  capped: boolean;
  placeId: string | null;
  latitude: number;
  longitude: number;
};

/** Fixes worth reading, oldest first, one per second. */
export function usableFixes(fixes: readonly Fix[]): Fix[] {
  const out: Fix[] = [];
  for (const f of [...fixes].sort((a, b) => a.ts - b.ts)) {
    if (f.accuracyM !== null && f.accuracyM > MAX_FIX_ACCURACY_M) continue;
    if (out.length && out[out.length - 1].ts === f.ts) continue;
    out.push(f);
  }
  return out;
}

/** The nearest saved place whose fence (widened by some of the fix's error) holds the point; null when none does. */
export function placeAt(latitude: number, longitude: number, accuracyM: number | null, places: readonly Place[]): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (const p of places) {
    const d = distanceM(latitude, longitude, p.latitude, p.longitude);
    if (d <= p.radiusM + Math.min(accuracyM ?? 0, ACCURACY_SLACK_M) && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Two fences that do not touch: being in one means having left the other. */
const apart = (a: Place, b: Place) => distanceM(a.latitude, a.longitude, b.latitude, b.longitude) > a.radiusM + b.radiusM;

function eventVisits(events: readonly PlaceEvent[], places: readonly Place[], fixes: readonly Fix[], now: number): Interval[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  const sorted = events
    .filter((e) => byId.has(e.placeId))
    .sort((a, b) => a.ts - b.ts || (a.kind === b.kind ? 0 : a.kind === "enter" ? -1 : 1));
  const open = new Map<string, number>();
  const out: Interval[] = [];
  const close = (place: Place, start: number, end: number, extra: Partial<Interval> = {}) =>
    out.push({ start, end: Math.max(start, end), open: false, capped: false, placeId: place.id, latitude: place.latitude, longitude: place.longitude, ...extra });
  for (const e of sorted) {
    const place = byId.get(e.placeId)!;
    if (e.kind === "enter") {
      // Arriving somewhere separate means the open visit elsewhere ended, whatever its own exit did.
      for (const [id, start] of [...open]) {
        const other = byId.get(id)!;
        if (id !== place.id && apart(place, other)) {
          close(other, start, e.ts);
          open.delete(id);
        }
      }
      if (!open.has(place.id)) open.set(place.id, e.ts);
      continue;
    }
    const start = open.get(place.id);
    if (start === undefined) continue;
    close(place, start, e.ts);
    open.delete(place.id);
  }
  for (const [id, start] of open) {
    const place = byId.get(id)!;
    // Fixes after the arrival: the last one inside, and the first one clearly elsewhere after it.
    let lastIn: number | null = null;
    let left: number | null = null;
    for (const f of fixes) {
      if (f.ts <= start) continue;
      const inside = distanceM(f.latitude, f.longitude, place.latitude, place.longitude) <= place.radiusM + Math.min(f.accuracyM ?? 0, ACCURACY_SLACK_M);
      if (inside) {
        lastIn = f.ts;
        left = null;
      } else left ??= f.ts;
    }
    if (left !== null) close(place, start, lastIn ?? left);
    else if (now - start > MAX_VISIT_H * 3600) close(place, start, start + MAX_VISIT_H * 3600, { capped: true });
    else out.push({ start, end: now, open: true, capped: false, placeId: id, latitude: place.latitude, longitude: place.longitude });
  }
  return out;
}

type Run = { placeId: string | null; first: number; last: number; lat: number; lon: number; n: number };

function fixRuns(fixes: readonly Fix[], places: readonly Place[], now: number): Interval[] {
  const runs: Run[] = [];
  for (const f of fixes) {
    const place = placeAt(f.latitude, f.longitude, f.accuracyM, places);
    const cur = runs[runs.length - 1];
    const same =
      cur &&
      f.ts - cur.last <= MAX_RUN_GAP_S &&
      (place
        ? cur.placeId === place.id
        : cur.placeId === null && distanceM(cur.lat, cur.lon, f.latitude, f.longitude) <= STAY_RADIUS_M + Math.min(f.accuracyM ?? 0, ACCURACY_SLACK_M));
    if (same) {
      cur.last = f.ts;
      if (!place) {
        // The running centre of an unknown stop.
        cur.lat = (cur.lat * cur.n + f.latitude) / (cur.n + 1);
        cur.lon = (cur.lon * cur.n + f.longitude) / (cur.n + 1);
      }
      cur.n++;
    } else {
      runs.push({ placeId: place?.id ?? null, first: f.ts, last: f.ts, lat: place?.latitude ?? f.latitude, lon: place?.longitude ?? f.longitude, n: 1 });
    }
  }
  const out: Interval[] = [];
  runs.forEach((r, i) => {
    const latest = i === runs.length - 1 && now - r.last <= OPEN_GRACE_S;
    const end = latest ? now : r.last;
    if (end - r.first < (r.placeId ? MIN_VISIT_S : MIN_STOP_S)) return;
    out.push({ start: r.first, end, open: latest, capped: false, placeId: r.placeId, latitude: r.lat, longitude: r.lon });
  });
  return out;
}

/** One place's intervals joined where they overlap or nearly touch. */
function merge(xs: Interval[]): Interval[] {
  const sorted = [...xs].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const x of sorted) {
    const cur = out[out.length - 1];
    if (cur && x.start <= cur.end + MERGE_GAP_S) {
      if (x.end >= cur.end) {
        cur.end = x.end;
        cur.open = x.open;
        cur.capped = x.capped;
      }
      continue;
    }
    out.push({ ...x });
  }
  return out;
}

/** `x` minus every interval in `taken`: the pieces left, in order. */
function subtract(x: Interval, taken: readonly Interval[]): Interval[] {
  let pieces = [x];
  for (const t of taken) {
    pieces = pieces.flatMap((p) => {
      if (t.end <= p.start || t.start >= p.end) return [p];
      const keep: Interval[] = [];
      if (t.start > p.start) keep.push({ ...p, end: t.start, open: false, capped: false });
      if (t.end < p.end) keep.push({ ...p, start: t.end });
      return keep;
    });
  }
  return pieces;
}

export type StayInputs = {
  places: readonly Place[];
  events: readonly PlaceEvent[];
  fixes: readonly Fix[];
  /** The window the result is clipped to: [from, to). */
  from: number;
  to: number;
  now: number;
};

/** The detected stays inside [from, to), oldest first, never overlapping. */
export function detectStays({ places, events, fixes, from, to, now }: StayInputs): Stay[] {
  const usable = usableFixes(fixes);
  const visits = eventVisits(events, places, usable, now);
  const runs = fixRuns(usable, places, now);
  const byPlace = new Map<string, Interval[]>();
  for (const v of [...visits, ...runs.filter((r) => r.placeId)]) byPlace.set(v.placeId!, [...(byPlace.get(v.placeId!) ?? []), v]);
  const placeVisits = [...byPlace.values()]
    .flatMap(merge)
    .filter((v) => v.end - v.start >= MIN_VISIT_S || v.open)
    .sort((a, b) => a.end - a.start - (b.end - b.start));
  const taken: Interval[] = [];
  for (const v of placeVisits) for (const piece of subtract(v, taken)) if (piece.end - piece.start >= 60) taken.push(piece);
  for (const u of runs.filter((r) => !r.placeId)) for (const piece of subtract(u, taken)) if (piece.end - piece.start >= MIN_STOP_S) taken.push(piece);
  return taken
    .filter((x) => x.end > from && x.start < to)
    .map((x): Stay => {
      const end = Math.min(x.end, to);
      return {
        start: Math.max(x.start, from),
        end,
        open: x.open && end === x.end,
        capped: x.capped && end === x.end,
        placeId: x.placeId,
        latitude: x.latitude,
        longitude: x.longitude,
        label: null,
        overrideId: null,
      };
    })
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
}
