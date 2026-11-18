import { describe, expect, it } from "vitest";
import { distanceM, parseCoordinates } from "./geo";
import { detectStays, MAX_VISIT_H, MIN_STOP_S } from "./stays";
import { applyOverrides, entriesOf, movementOf, weekTotals } from "./timeline";
import type { Fix, Place, PlaceEvent, TimelineOverride } from "./types";

const H = 3600;
const M = 60;
// Home, and a gym about 600 m north: a 5-10 minute walk, as the owner's.
const home: Place = { id: "home", name: "Home", icon: "home", latitude: 12.97, longitude: 77.59, radiusM: 150, createdAt: 0 };
const gym: Place = { id: "gym", name: "Gym", icon: "gym", latitude: 12.9754, longitude: 77.59, radiusM: 150, createdAt: 0 };
const places = [home, gym];
const ev = (placeId: string, kind: "enter" | "exit", ts: number): PlaceEvent => ({ id: `${placeId}-${kind}-${ts}`, placeId, kind, ts, day: "2026-11-18" });
const fix = (ts: number, latitude: number, longitude: number, accuracyM: number | null = 15): Fix => ({ ts, latitude, longitude, accuracyM });
const at = (p: Place, ts: number) => fix(ts, p.latitude, p.longitude);
const DAY = { from: 0, to: 24 * H };

describe("geo", () => {
  it("measures the walk to the gym", () => {
    expect(distanceM(home.latitude, home.longitude, gym.latitude, gym.longitude)).toBeGreaterThan(580);
    expect(distanceM(home.latitude, home.longitude, gym.latitude, gym.longitude)).toBeLessThan(620);
  });

  it("reads pasted coordinates and a maps link", () => {
    expect(parseCoordinates("12.9716, 77.5946")).toEqual({ latitude: 12.9716, longitude: 77.5946 });
    expect(parseCoordinates("https://maps.google.com/@12.9716,77.5946,17z")).toEqual({ latitude: 12.9716, longitude: 77.5946 });
    expect(parseCoordinates("95, 10")).toBeNull();
    expect(parseCoordinates("home")).toBeNull();
  });
});

describe("detectStays from geofences only (Saver)", () => {
  it("turns home → gym → home into three stays", () => {
    const events = [ev("home", "enter", 0), ev("home", "exit", 7 * H), ev("gym", "enter", 7 * H + 8 * M), ev("gym", "exit", 8 * H + 10 * M), ev("home", "enter", 8 * H + 20 * M)];
    const stays = detectStays({ places, events, fixes: [], ...DAY, now: 12 * H });
    expect(stays.map((s) => [s.placeId, s.start, s.end, s.open])).toEqual([
      ["home", 0, 7 * H, false],
      ["gym", 7 * H + 8 * M, 8 * H + 10 * M, false],
      ["home", 8 * H + 20 * M, 12 * H, true],
    ]);
  });

  it("closes a visit whose exit was lost when another place is entered", () => {
    const events = [ev("home", "enter", 0), ev("gym", "enter", 9 * H), ev("gym", "exit", 10 * H)];
    const stays = detectStays({ places, events, fixes: [], ...DAY, now: 11 * H });
    expect(stays.map((s) => [s.placeId, s.start, s.end])).toEqual([
      ["home", 0, 9 * H],
      ["gym", 9 * H, 10 * H],
    ]);
  });

  it("caps a stale open visit instead of trusting it", () => {
    const stays = detectStays({ places, events: [ev("gym", "enter", H)], fixes: [], from: 0, to: 48 * H, now: 40 * H });
    expect(stays[0]).toMatchObject({ placeId: "gym", start: H, end: H + MAX_VISIT_H * H, capped: true, open: false });
  });

  it("ignores a fence brushed in passing", () => {
    const stays = detectStays({ places, events: [ev("gym", "enter", H), ev("gym", "exit", H + 2 * M)], fixes: [], ...DAY, now: 5 * H });
    expect(stays).toEqual([]);
  });

  it("joins a visit split by a short step outside", () => {
    const events = [ev("gym", "enter", H), ev("gym", "exit", 2 * H), ev("gym", "enter", 2 * H + 5 * M), ev("gym", "exit", 3 * H)];
    const stays = detectStays({ places, events, fixes: [], ...DAY, now: 5 * H });
    expect(stays.map((s) => [s.start, s.end])).toEqual([[H, 3 * H]]);
  });
});

describe("detectStays with fixes (Balanced, Precise)", () => {
  it("finds an unknown stop of 10 minutes or more", () => {
    const cafe = { latitude: 12.99, longitude: 77.6 };
    const fixes = [0, 10, 20, 30].map((m) => fix(10 * H + m * M, cafe.latitude + (m % 20 ? 0.0002 : 0), cafe.longitude));
    const stays = detectStays({ places, events: [], fixes, ...DAY, now: 14 * H });
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({ placeId: null, start: 10 * H, end: 10 * H + 30 * M, open: false });
    expect(stays[0].latitude).toBeCloseTo(cafe.latitude, 3);
  });

  it("does not make a stop from a walk", () => {
    // 80 m a minute heading north from somewhere far from both places.
    const fixes = Array.from({ length: 20 }, (_, i) => fix(10 * H + i * M, 13.1 + (i * 80) / 111_000, 77.7));
    expect(detectStays({ places, events: [], fixes, ...DAY, now: 14 * H })).toEqual([]);
  });

  it("drops a fix too coarse to place", () => {
    const fixes = [fix(10 * H, 13.1, 77.7, 900), fix(10 * H + MIN_STOP_S + M, 13.1, 77.7, 900)];
    expect(detectStays({ places, events: [], fixes, ...DAY, now: 14 * H })).toEqual([]);
  });

  it("finds a gym visit the fence missed", () => {
    const fixes = [at(gym, 18 * H), at(gym, 18 * H + 20 * M), at(gym, 19 * H), fix(19 * H + 20 * M, 13.1, 77.7)];
    const stays = detectStays({ places, events: [], fixes, ...DAY, now: 21 * H });
    expect(stays.map((s) => [s.placeId, s.start, s.end])).toEqual([["gym", 18 * H, 19 * H]]);
  });

  it("closes an open fence visit at the last fix inside once fixes show it was left", () => {
    const fixes = [at(gym, 18 * H + 30 * M), fix(19 * H + 10 * M, 13.1, 77.7)];
    const stays = detectStays({ places, events: [ev("gym", "enter", 18 * H)], fixes, ...DAY, now: 21 * H });
    expect(stays.map((s) => [s.placeId, s.start, s.end, s.open])).toEqual([["gym", 18 * H, 18 * H + 30 * M, false]]);
  });

  it("extends a late fence arrival back to the first fix inside", () => {
    const fixes = [at(gym, 18 * H), at(gym, 18 * H + 15 * M)];
    const stays = detectStays({ places, events: [ev("gym", "enter", 18 * H + 4 * M), ev("gym", "exit", 19 * H)], fixes, ...DAY, now: 21 * H });
    expect(stays.map((s) => [s.start, s.end])).toEqual([[18 * H, 19 * H]]);
  });

  it("keeps the current stay open while fixes are recent", () => {
    const fixes = [at(home, 20 * H), at(home, 20 * H + 20 * M)];
    const stays = detectStays({ places, events: [], fixes, ...DAY, now: 20 * H + 35 * M });
    expect(stays[0]).toMatchObject({ placeId: "home", end: 20 * H + 35 * M, open: true });
  });

  it("splits a stale home span around a gym visit", () => {
    const events = [ev("home", "enter", 0)];
    const fixes = [at(gym, 7 * H), at(gym, 8 * H), at(home, 8 * H + 15 * M)];
    const stays = detectStays({ places, events, fixes, ...DAY, now: 10 * H });
    expect(stays.map((s) => [s.placeId, s.start, s.end])).toEqual([
      ["home", 0, 7 * H],
      ["gym", 7 * H, 8 * H],
      // The fix back inside home keeps the arrival's visit going: home again after the gym, still open.
      ["home", 8 * H, 10 * H],
    ]);
  });

  it("clips to the local day, so a night at home splits at midnight", () => {
    const events = [ev("home", "enter", 20 * H), ev("home", "exit", 31 * H)];
    const first = detectStays({ places, events, fixes: [], from: 0, to: 24 * H, now: 40 * H });
    const second = detectStays({ places, events, fixes: [], from: 24 * H, to: 48 * H, now: 40 * H });
    expect(first.map((s) => [s.start, s.end])).toEqual([[20 * H, 24 * H]]);
    expect(second.map((s) => [s.start, s.end])).toEqual([[24 * H, 31 * H]]);
  });
});

describe("applyOverrides", () => {
  const base = detectStays({ places, events: [ev("home", "enter", 0), ev("home", "exit", 7 * H), ev("gym", "enter", 7 * H + 10 * M), ev("gym", "exit", 8 * H)], fixes: [], ...DAY, now: 12 * H });
  const o = (x: Partial<TimelineOverride>): TimelineOverride => ({ id: "o", kind: "stay", start: 0, end: 0, placeId: null, label: null, latitude: null, longitude: null, createdAt: 1, ...x });

  it("moves a stay's times: the old span cleared, the new one put in", () => {
    const out = applyOverrides(base, [o({ id: "c", kind: "clear", start: 7 * H + 10 * M, end: 8 * H }), o({ id: "s", start: 7 * H, end: 8 * H + 15 * M, placeId: "gym" })], 0, 24 * H);
    expect(out.map((s) => [s.placeId, s.start, s.end, s.overrideId])).toEqual([
      ["home", 0, 7 * H, null],
      ["gym", 7 * H, 8 * H + 15 * M, "s"],
    ]);
  });

  it("deletes a visit", () => {
    const out = applyOverrides(base, [o({ kind: "clear", start: 7 * H + 10 * M, end: 8 * H })], 0, 24 * H);
    expect(out.map((s) => s.placeId)).toEqual(["home"]);
  });

  it("applies edits in the order they were made", () => {
    const out = applyOverrides(base, [o({ id: "b", start: H, end: 2 * H, placeId: "gym", createdAt: 5 }), o({ id: "a", start: 0, end: 3 * H, label: "Friend's", createdAt: 2 })], 0, 24 * H);
    expect(out.map((s) => [s.placeId ?? s.label, s.start, s.end])).toEqual([
      ["Friend's", 0, H],
      ["gym", H, 2 * H],
      ["Friend's", 2 * H, 3 * H],
      ["home", 3 * H, 7 * H],
      ["gym", 7 * H + 10 * M, 8 * H],
    ]);
  });
});

describe("entriesOf and weekTotals", () => {
  const events = [ev("home", "enter", 0), ev("home", "exit", 7 * H), ev("gym", "enter", 7 * H + 10 * M), ev("gym", "exit", 8 * H), ev("home", "enter", 8 * H + 10 * M)];
  const stays = detectStays({ places, events, fixes: [], ...DAY, now: 12 * H });

  it("puts trips between stays, with the straight line when no fixes were taken", () => {
    const entries = entriesOf(stays, 0, 12 * H, []);
    expect(entries.map((e) => e.kind)).toEqual(["stay", "trip", "stay", "trip", "stay"]);
    const trip = entries[1];
    expect(trip.kind === "trip" && [trip.fromPlaceId, trip.toPlaceId, trip.approx, Math.round((trip.metres ?? 0) / 10)]).toEqual(["home", "gym", true, 60]);
  });

  it("uses the fixes' path when it is longer than the straight line", () => {
    const fixes = [at(home, 7 * H), fix(7 * H + 4 * M, 12.972, 77.595, 10), at(gym, 7 * H + 9 * M)];
    const buckets = movementOf(fixes);
    const trip = entriesOf(stays, 0, 12 * H, buckets)[1];
    expect(trip.kind === "trip" && !trip.approx && (trip.metres ?? 0) > 900).toBe(true);
  });

  it("shows a long unexplained gap as no location, not as a trip", () => {
    const morning = detectStays({ places, events: [ev("home", "enter", 0), ev("home", "exit", 2 * H)], fixes: [], ...DAY, now: 23 * H });
    const entries = entriesOf(morning, 0, 23 * H, []);
    expect(entries.map((e) => e.kind)).toEqual(["stay", "gap"]);
  });

  it("totals time and arrivals per place, not counting a stay carried over midnight as an arrival", () => {
    const entries = entriesOf(stays, 0, 12 * H, []);
    const totals = weekTotals([{ dayStart: 0, entries }]);
    expect(totals.places).toEqual([
      { placeId: "home", minutes: 7 * 60 + 230, visits: 1 },
      { placeId: "gym", minutes: 50, visits: 1 },
    ]);
    expect(totals.trips.count).toBe(2);
    expect(totals.trips.minutes).toBe(20);
  });
});
