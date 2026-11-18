import { describe, expect, it, vi } from "vitest";
import { deleteStay, editStay, removePlace, savePlace } from "@/actions/places";
import { MemoryStore } from "@/data/memory";
import type { Profile } from "@/data/types";
import { localMidnight } from "@/lib/time";
import type { QueryCtx } from "./ctx";
import { getTimelineCard, getTimelineDay, getTimelineWeek } from "./timeline";

vi.mock("@/lib/yield", () => ({ slice: async () => {} }));

const TZ = "Asia/Kolkata";
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: null, heightCm: null, timeZone: TZ };
const H = 3600;
const M = 60;
const DAY = "2026-11-18";
const T0 = localMidnight(DAY, TZ);
const sync = { lastSyncTs: null, firstDay: null, lastError: null };
const ctxAt = (store: MemoryStore, now: number, today = DAY): QueryCtx => ({ store, profile: PROFILE, timeZone: TZ, today, now, sync });

/** Home, a gym 600 m north, and a day of home → gym → home → office with a café stop, as the owner's. */
async function seeded(now = T0 + 20 * H) {
  const store = new MemoryStore();
  const add = async (name: string, icon: "home" | "gym" | "work", latitude: number) => {
    const r = await savePlace(store, { name, icon, latitude, longitude: 77.59, radiusM: 150 }, TZ, T0);
    if (!r.ok) throw new Error(r.error);
    return r.place;
  };
  const home = await add("Home", "home", 12.97);
  const gym = await add("Gym", "gym", 12.9754);
  const office = await add("Office", "work", 13.0);
  const ev = (placeId: string, kind: "enter" | "exit", ts: number) => store.addPlaceEvent({ id: `${placeId}-${kind}-${ts}`, placeId, kind, ts, day: DAY });
  await ev(home.id, "enter", T0 - 10 * H);
  await ev(home.id, "exit", T0 + 6 * H);
  await ev(gym.id, "enter", T0 + 6 * H + 8 * M);
  await ev(gym.id, "exit", T0 + 7 * H + 10 * M);
  await ev(home.id, "enter", T0 + 7 * H + 20 * M);
  await ev(home.id, "exit", T0 + 9 * H);
  await ev(office.id, "enter", T0 + 9 * H + 40 * M);
  await ev(office.id, "exit", T0 + 17 * H);
  // A café on the way back: 30 minutes of fixes at one spot far from every place.
  await store.addLocationFixes([0, 10, 20, 30].map((m) => ({ ts: T0 + 17 * H + 20 * M + m * M, latitude: 12.99, longitude: 77.62, accuracyM: 20 })));
  await ev(home.id, "enter", T0 + 18 * H + 30 * M);
  await store.putSteps([{ ts: T0 + 6 * H + 10 * M, v: 300 }, { ts: T0 + 6 * H + 20 * M, v: 500 }]);
  return { store, home, gym, office, now };
}

describe("getTimelineDay", () => {
  it("reads the day as stays and trips, oldest first, with steps and the unknown stop", async () => {
    const { store, now } = await seeded();
    const vm = await getTimelineDay(DAY, ctxAt(store, now));
    const line = vm.entries.map((e) => (e.kind === "stay" ? e.place.name ?? "?" : e.kind));
    expect(line).toEqual(["Home", "trip", "Gym", "trip", "Home", "trip", "Office", "trip", "?", "trip", "Home"]);
    const gymStay = vm.entries[2];
    expect(gymStay.kind === "stay" && [gymStay.minutes, gymStay.steps]).toEqual([62, 800]);
    const last = vm.entries[vm.entries.length - 1];
    expect(last.kind === "stay" && last.open).toBe(true);
    expect(vm.totals.unknown).toBe(30);
  });

  it("shows a hand edit and a deletion over the detected stays", async () => {
    const { store, now } = await seeded();
    const ctx = ctxAt(store, now);
    const before = await getTimelineDay(DAY, ctx);
    const gymStay = before.entries[2];
    if (gymStay.kind !== "stay") throw new Error("no gym stay");
    const ref = { start: gymStay.start / 1000, end: gymStay.end / 1000, overrideId: null };
    const r = await editStay(store, ref, { start: ref.start - 15 * M, end: ref.end, placeId: gymStay.place.id, label: null, latitude: null, longitude: null }, now);
    expect(r.ok).toBe(true);
    const edited = (await getTimelineDay(DAY, ctx)).entries.find((e) => e.kind === "stay" && e.place.name === "Gym");
    expect(edited?.kind === "stay" && [edited.minutes, !!edited.overrideId]).toEqual([77, true]);
    if (edited?.kind !== "stay") return;
    await deleteStay(store, { start: edited.start / 1000, end: edited.end / 1000, overrideId: edited.overrideId }, now);
    const after = await getTimelineDay(DAY, ctx);
    expect(after.entries.some((e) => e.kind === "stay" && e.place.name === "Gym")).toBe(false);
  });

  it("refuses an edit that ends in the future or before it starts", async () => {
    const store = new MemoryStore();
    const now = T0 + 10 * H;
    expect(await editStay(store, { start: T0, end: T0 + H, overrideId: null }, { start: T0, end: now + H, placeId: null, label: null, latitude: null, longitude: null }, now)).toEqual({ ok: false, error: "future" });
    expect(await editStay(store, { start: T0, end: T0 + H, overrideId: null }, { start: T0 + H, end: T0, placeId: null, label: null, latitude: null, longitude: null }, now)).toEqual({ ok: false, error: "times" });
  });

  it("names past stops of a removed place as unknown, and validates new places", async () => {
    const { store, gym, now } = await seeded();
    await removePlace(store, gym.id, TZ, now);
    const vm = await getTimelineDay(DAY, ctxAt(store, now));
    expect(vm.entries.some((e) => e.kind === "stay" && e.place.name === "Gym")).toBe(false);
    expect(await savePlace(store, { name: " ", icon: "home", latitude: 1, longitude: 1, radiusM: 150 }, TZ, now)).toEqual({ ok: false, error: "name" });
    expect(await savePlace(store, { name: "X", icon: "home", latitude: 100, longitude: 1, radiusM: 150 }, TZ, now)).toEqual({ ok: false, error: "location" });
    expect(await savePlace(store, { name: "X", icon: "home", latitude: 1, longitude: 1, radiusM: 7 }, TZ, now)).toEqual({ ok: false, error: "radius" });
  });
});

describe("freezing", () => {
  it("reads a frozen day as it read live, after its fixes are pruned", async () => {
    const { maintainTimeline } = await import("@/background/timeline");
    const { store } = await seeded();
    const later = T0 + 40 * 24 * H;
    const live = await getTimelineDay(DAY, ctxAt(store, T0 + 30 * H, "2026-11-19"));
    const frozen = await maintainTimeline(store, TZ, later);
    expect(frozen).toBeGreaterThan(30);
    expect(await store.locationFixes(0, later)).toEqual([]);
    const after = await getTimelineDay(DAY, ctxAt(store, later, "2026-12-28"));
    const shape = (vm: typeof live) => vm.entries.map((e) => [e.kind, e.start, e.end, e.kind === "trip" ? Math.round(e.metres ?? 0) : null]);
    expect(shape(after)).toEqual(shape(live));
  });
});

describe("getTimelineWeek and getTimelineCard", () => {
  it("totals the week per place and shows where you are", async () => {
    const { store, now } = await seeded();
    const ctx = ctxAt(store, now);
    const week = await getTimelineWeek(DAY, ctx);
    expect(week.from).toBe("2026-11-16");
    // Home holds the evening before too (Monday the 16th starts the week); its night across midnight is one arrival.
    expect(week.places.map((p) => [p.place.name, p.visits])).toEqual([
      ["Home", 3],
      ["Office", 1],
      ["Gym", 1],
    ]);
    expect(week.unknownStops).toBe(1);
    const card = await getTimelineCard(ctx);
    expect(card.now).toMatchObject({ kind: "stay", place: { name: "Home" } });
    expect(card.stays.map((s) => s.place.name ?? "?")).toEqual(["Home", "Gym", "Home", "Office", "?", "Home"]);
  });

  it("is empty with no places", async () => {
    expect(await getTimelineCard(ctxAt(new MemoryStore(), T0))).toEqual({ places: 0, now: null, stays: [] });
  });
});
