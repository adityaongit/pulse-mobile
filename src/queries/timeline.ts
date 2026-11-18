// The location timeline's reads (Pulse-only, docs/timeline.md): one day's stays and trips with their steps, heart rate
// and sleep, the week's totals, Home's card and Settings › Places. Days older than the frozen horizon read their
// stored stays; newer days are detected from the raw events and fixes on every read (src/core/places/stays.ts).
import { detectStays } from "@/core/places/stays";
import { applyOverrides, entriesOf, frozenToStay, movementOf, weekTotals, type TimelineEntry } from "@/core/places/timeline";
import { MOVE_BUCKET_S, type MoveBucket, type Place, type PlaceIcon, type Stay, type TimelineState, type TrackingMode } from "@/core/places/types";
import type { Store } from "@/data/store";
import type { Session } from "@/data/types";
import { addDays, localMidnight } from "@/lib/time";
import type { QueryCtx } from "./ctx";

const H = 3600;

/** A day's span: [from, end) is the local day, `to` the part of it that has happened. */
export function daySpan(day: string, timeZone: string, now: number) {
  const from = localMidnight(day, timeZone);
  const end = localMidnight(addDays(day, 1), timeZone);
  return { from, end, to: Math.max(from, Math.min(end, now)) };
}

/**
 * A day detected from its raw events and fixes: a day either side of context, so a stay across midnight closes the
 * same way from both days. The movement slots cover the day only.
 */
export async function detectDay(store: Store, places: readonly Place[], day: string, timeZone: string, now: number): Promise<{ stays: Stay[]; buckets: MoveBucket[] }> {
  const { from, end, to } = daySpan(day, timeZone, now);
  if (to <= from) return { stays: [], buckets: [] };
  const ctxFrom = from - 24 * H;
  const ctxTo = Math.min(end + 12 * H, now + 1);
  const [events, fixes] = await Promise.all([store.placeEvents(ctxFrom, ctxTo), store.locationFixes(ctxFrom, ctxTo)]);
  const stays = detectStays({ places, events, fixes, from, to, now });
  const buckets = movementOf(fixes.filter((f) => f.ts >= from - MOVE_BUCKET_S && f.ts < end)).filter((b) => b.bucket * MOVE_BUCKET_S >= from && b.bucket * MOVE_BUCKET_S < end);
  return { stays, buckets };
}

/** One day's stays as the screens show them: frozen or detected, then the owner's edits. */
export async function dayStays(store: Store, places: readonly Place[], state: TimelineState, day: string, timeZone: string, now: number) {
  const span = daySpan(day, timeZone, now);
  const frozen = state.frozenThrough !== null && day <= state.frozenThrough;
  const base = frozen
    ? { stays: (await store.frozenStays(day, day)).map(frozenToStay), buckets: await store.moveBuckets(span.from, span.end) }
    : await detectDay(store, places, day, timeZone, now);
  const overrides = await store.timelineOverrides(span.from, span.end);
  const stays = applyOverrides(base.stays, overrides, span.from, span.to);
  return { ...span, stays, buckets: base.buckets, entries: entriesOf(stays, span.from, span.to, base.buckets) };
}

export type PlaceRef = { id: string | null; name: string | null; icon: PlaceIcon | null };

export type StayVM = {
  kind: "stay";
  /** Epoch ms. */
  start: number;
  end: number;
  minutes: number;
  open: boolean;
  capped: boolean;
  place: PlaceRef;
  /** The owner's own name for an unknown stop. */
  label: string | null;
  latitude: number | null;
  longitude: number | null;
  overrideId: string | null;
  steps: number | null;
  avgHr: number | null;
  /** The main sleep inside this stay, clipped to it. */
  sleep: { start: number; end: number; minutes: number } | null;
};
export type TripVM = {
  kind: "trip";
  start: number;
  end: number;
  minutes: number;
  from: PlaceRef | null;
  to: PlaceRef | null;
  metres: number | null;
  approx: boolean;
  open: boolean;
  steps: number | null;
  avgHr: number | null;
};
/** `open`: the gap runs to now on a day still going. */
export type GapVM = { kind: "gap"; start: number; end: number; minutes: number; open: boolean };
export type EntryVM = StayVM | TripVM | GapVM;

export type TimelineDayVM = {
  day: string;
  isToday: boolean;
  mode: TrackingMode;
  places: Place[];
  /** Oldest first: the day reads top to bottom. */
  entries: EntryVM[];
  /** Minutes the day has known: at a place, at an unknown stop, travelling. */
  totals: { place: number; unknown: number; trip: number; metres: number };
};

const refOf = (byId: Map<string, Place>, id: string | null): PlaceRef => {
  const p = id ? byId.get(id) : undefined;
  return p ? { id: p.id, name: p.name, icon: p.icon } : { id: null, name: null, icon: null };
};

/** Sums and means over sorted samples in [lo, hi) by binary search. */
function windowed<T extends { ts: number }>(xs: readonly T[], value: (x: T) => number) {
  const first = (t: number) => {
    let a = 0;
    let z = xs.length;
    while (a < z) {
      const m = (a + z) >> 1;
      if (xs[m].ts < t) a = m + 1;
      else z = m;
    }
    return a;
  };
  return (lo: number, hi: number) => {
    let sum = 0;
    let n = 0;
    for (let i = first(lo); i < xs.length && xs[i].ts < hi; i++) {
      sum += value(xs[i]);
      n++;
    }
    return { sum, n };
  };
}

const mainSleep = (sessions: readonly Session[], from: number, end: number) => sessions.filter((s) => s.isMain && s.endTs > from && s.startTs < end);

export async function getTimelineDay(day: string, ctx: QueryCtx): Promise<TimelineDayVM> {
  const { store, timeZone, now } = ctx;
  const [places, state] = await Promise.all([store.places(), store.getTimelineState()]);
  const byId = new Map(places.map((p) => [p.id, p]));
  const d = await dayStays(store, places, state, day, timeZone, now);
  const [steps, hr, sessions] = await Promise.all([store.readSteps(d.from, d.to), store.readHr(d.from, d.to), store.allSessions()]);
  const stepsIn = windowed(steps, (x) => x.v);
  const hrIn = windowed(hr, (x) => x.bpm);
  const sleeps = mainSleep(sessions, d.from, d.end);
  const health = (start: number, end: number) => {
    const s = stepsIn(start, end);
    const h = hrIn(start, end);
    return { steps: s.n ? Math.round(s.sum) : null, avgHr: h.n ? Math.round(h.sum / h.n) : null };
  };
  const minutes = (e: { start: number; end: number }) => Math.round((e.end - e.start) / 60);
  const totals = { place: 0, unknown: 0, trip: 0, metres: 0 };
  const entries = d.entries.map((e: TimelineEntry): EntryVM => {
    const base = { start: e.start * 1000, end: e.end * 1000, minutes: minutes(e) };
    if (e.kind === "gap") return { kind: "gap", ...base, open: e.end === d.to && d.to < d.end };
    if (e.kind === "trip") {
      totals.trip += base.minutes;
      totals.metres += e.metres ?? 0;
      return { kind: "trip", ...base, from: e.fromPlaceId || e.start > d.from ? refOf(byId, e.fromPlaceId) : null, to: e.open ? null : refOf(byId, e.toPlaceId), metres: e.metres, approx: e.approx, open: e.open, ...health(e.start, e.end) };
    }
    const s = e.stay;
    const place = refOf(byId, s.placeId);
    if (place.id) totals.place += base.minutes;
    else totals.unknown += base.minutes;
    const night = sleeps.map((n) => ({ start: Math.max(n.startTs, s.start), end: Math.min(n.endTs, s.end) })).filter((n) => n.end - n.start >= 15 * 60).sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    return {
      kind: "stay",
      ...base,
      open: s.open,
      capped: s.capped,
      place,
      label: s.label,
      latitude: s.latitude,
      longitude: s.longitude,
      overrideId: s.overrideId,
      ...health(s.start, s.end),
      sleep: night ? { start: night.start * 1000, end: night.end * 1000, minutes: minutes(night) } : null,
    };
  });
  totals.metres = Math.round(totals.metres);
  return { day, isToday: day === ctx.today, mode: state.mode, places, entries, totals };
}

export type TimelineWeekVM = {
  from: string;
  to: string;
  places: { place: PlaceRef; minutes: number; visits: number }[];
  unknownMinutes: number;
  unknownStops: number;
  trips: { count: number; minutes: number; metres: number };
};

/** The week (Monday to Sunday, as the habit tracker counts one) holding `day`, up to today. */
export async function getTimelineWeek(day: string, ctx: QueryCtx): Promise<TimelineWeekVM> {
  const { store, timeZone, now } = ctx;
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  const from = addDays(day, -((dow + 6) % 7));
  const to = addDays(from, 6);
  const [places, state] = await Promise.all([store.places(), store.getTimelineState()]);
  const byId = new Map(places.map((p) => [p.id, p]));
  const days = [];
  for (let d = from; d <= to && d <= ctx.today; d = addDays(d, 1)) {
    const x = await dayStays(store, places, state, d, timeZone, now);
    days.push({ dayStart: x.from, entries: x.entries });
  }
  const t = weekTotals(days);
  return { from, to, ...t, places: t.places.map((p) => ({ place: refOf(byId, p.placeId), minutes: p.minutes, visits: p.visits })).filter((p) => p.place.id) };
}

export type TimelineCardVM = {
  places: number;
  /** Where the phone is now: an open stay, or a trip in progress; null when not known. */
  now: { kind: "stay"; place: PlaceRef; label: string | null; since: number; minutes: number } | { kind: "moving"; since: number; minutes: number } | null;
  /** Today's stays, oldest first. */
  stays: { place: PlaceRef; label: string | null; start: number; end: number; minutes: number; open: boolean }[];
};

/** Home's card: where you are and today's stays. Empty until a place is saved. */
export async function getTimelineCard(ctx: QueryCtx): Promise<TimelineCardVM> {
  const { store, timeZone, now } = ctx;
  const [places, state] = await Promise.all([store.places(), store.getTimelineState()]);
  if (!places.length) return { places: 0, now: null, stays: [] };
  const byId = new Map(places.map((p) => [p.id, p]));
  const d = await dayStays(store, places, state, ctx.today, timeZone, now);
  const stays = d.entries.flatMap((e) =>
    e.kind === "stay" ? [{ place: refOf(byId, e.stay.placeId), label: e.stay.label, start: e.start * 1000, end: e.end * 1000, minutes: Math.round((e.end - e.start) / 60), open: e.stay.open }] : [],
  );
  const last = d.entries[d.entries.length - 1];
  const current =
    last?.kind === "stay" && last.stay.open
      ? { kind: "stay" as const, place: refOf(byId, last.stay.placeId), label: last.stay.label, since: last.start * 1000, minutes: Math.round((now - last.start) / 60) }
      : last?.kind === "trip" && last.open
        ? { kind: "moving" as const, since: last.start * 1000, minutes: Math.round((now - last.start) / 60) }
        : null;
  return { places: places.length, now: current, stays };
}

export type PlacesSettingsVM = { places: Place[]; mode: TrackingMode };

export async function getPlacesSettings(ctx: QueryCtx): Promise<PlacesSettingsVM> {
  const [places, state] = await Promise.all([ctx.store.places(), ctx.store.getTimelineState()]);
  return { places, mode: state.mode };
}

/** The place editor: the place, or null for a new one. */
export async function getPlace(ctx: QueryCtx, id: string | undefined): Promise<{ place: Place | null }> {
  if (!id) return { place: null };
  return { place: (await ctx.store.places()).find((p) => p.id === id) ?? null };
}
