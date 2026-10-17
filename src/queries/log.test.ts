// Ported from Pulse's src/server/log.test.ts: the Google writer cases have no counterpart (nothing leaves the phone).
import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryStore } from "@/data/memory";
import type { Store } from "@/data/store";
import type { Profile } from "@/data/types";
import { deleteEntry, describeEntry, getLog, LOG_KINDS, recentEntries, saveEntries, waterOn } from "./log";
import type { QueryCtx } from "./ctx";

const TZ = "Asia/Kolkata";
const T = Date.parse("2026-10-02T06:00:00Z") / 1000; // Oct 2, 11:30 local

let store: Store;
beforeEach(() => {
  store = openMemoryStore();
});

const ctxOf = (sex: Profile["sex"]): QueryCtx => ({
  store,
  profile: { birthDate: "1990-01-01", sex, maxHr: null, heightCm: null, timeZone: TZ },
  timeZone: TZ,
  today: "2026-10-02",
  now: T,
  sync: { lastSyncTs: null, firstDay: null, lastError: null },
});

describe("saveEntries / deleteEntry", () => {
  it("stores entries locally with their local day, and deletes them", async () => {
    expect(await saveEntries(store, [{ type: "moods", ts: T, data: { moods: ["CALM"], valence: "PLEASANT" } }], { tz: TZ, now: T })).toEqual({ ok: true });
    const [row] = await store.loggedEntries(0);
    expect(row).toMatchObject({ type: "moods", ts: T, day: "2026-10-02", data: { moods: ["CALM"], valence: "PLEASANT" }, createdAt: T });
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await deleteEntry(store, row.id)).toEqual({ ok: true, type: "moods" });
    expect(await store.loggedEntries(0)).toEqual([]);
    expect(await deleteEntry(store, row.id)).toEqual({ ok: true });
  });

  it("an entry late in the evening belongs to that local day", async () => {
    await saveEntries(store, [{ type: "hydration-log", ts: Date.parse("2026-10-02T19:00:00Z") / 1000, data: { ml: 300 } }], { tz: TZ, now: T });
    expect((await store.loggedEntries(0))[0].day).toBe("2026-10-03"); // 00:30 in Kolkata
  });
});

describe("recentEntries", () => {
  it("describes each entry, newest first, never at Google", async () => {
    await saveEntries(store, [{ type: "symptoms", ts: T, data: { symptoms: ["HEADACHE"] } }], { tz: TZ, now: T });
    await saveEntries(store, [{ type: "hydration-log", ts: T + 60, data: { ml: 1250 } }], { tz: TZ, now: T + 60 });
    expect(await recentEntries(store, T - 60)).toMatchObject([
      { type: "hydration-log", title: "Water", detail: "1,250\u00a0ml", atGoogle: false, source: "pulse" },
      { type: "symptoms", title: "Symptoms", detail: "Headache", atGoogle: false, source: "pulse" },
    ]);
    expect(await recentEntries(store, T + 1)).toHaveLength(1);
  });

  it("lists what the sync read from Health Connect (logged in Fitbit) with its source", async () => {
    await saveEntries(store, [{ type: "hydration-log", ts: T, data: { ml: 250 } }], { tz: TZ, now: T });
    await store.replaceExternalEntries({ from: "2026-10-02", to: "2026-10-02" }, [
      { id: "hc-water-1", type: "hydration-log", ts: T + 60, day: "2026-10-02", data: { ml: 330 }, createdAt: T + 60, source: "health_connect" },
    ]);
    expect(await recentEntries(store, 0)).toMatchObject([
      { id: "hc-water-1", title: "Water", detail: "330\u00a0ml", source: "health_connect" },
      { title: "Water", detail: "250\u00a0ml", source: "pulse" },
    ]);
  });
});

describe("describeEntry", () => {
  it("writes one line per type", () => {
    expect(describeEntry("nutrition-log", { name: null, meal: "LUNCH", kcal: 1200, protein: 30, carbs: null, fat: 12.5 })).toEqual({
      title: "Lunch",
      detail: "1,200 kcal, 30 g protein, 12.5 g fat",
    });
    expect(describeEntry("moods", { moods: ["FATIGUED", "CALM"], valence: "BASELINE" })).toEqual({ title: "Mood", detail: "Neutral, Tired, Calm" });
    expect(describeEntry("menstrual-period", { start: "2026-09-29", end: "2026-10-01", flow: "LIGHT" })).toEqual({ title: "Period", detail: "3 days, light flow" });
    expect(describeEntry("menstrual-period", { start: "2026-10-01", end: "2026-10-01", flow: null })).toEqual({ title: "Period", detail: "1 day" });
    expect(describeEntry("body-fat", { pct: 18.3 })).toEqual({ title: "Body fat", detail: "18.3%" });
    expect(describeEntry("oxygen-saturation", { pct: 95 })).toEqual({ title: "Blood oxygen", detail: "95%" });
    expect(describeEntry("ovulation-test", { result: "LUTEINIZING_HORMONE_SURGE" })).toEqual({ title: "Ovulation test", detail: "LH surge" });
  });

  it("describes what Health Connect's shapes add: a food of unknown meal, and spotting", () => {
    expect(describeEntry("nutrition-log", { name: null, meal: "UNKNOWN", kcal: 120, protein: null, carbs: null, fat: null })).toEqual({ title: "Food", detail: "120 kcal" });
    expect(describeEntry("menstrual-period", { start: "2026-10-10", end: "2026-10-10", flow: "SPOTTING", spotting: true })).toEqual({ title: "Spotting", detail: "between periods" });
  });
});

describe("waterOn", () => {
  it("adds what Pulse logged that day to Health Connect's roll-up", async () => {
    await saveEntries(store, [{ type: "hydration-log", ts: T, data: { ml: 250 } }], { tz: TZ, now: T });
    expect(await waterOn(store, "2026-10-02", TZ)).toBe(250); // nothing synced
    await store.upsertDailyValues([{ day: "2026-10-02", key: "water", value: 1000 }]);
    expect(await waterOn(store, "2026-10-02", TZ)).toBe(1250);
    await saveEntries(store, [{ type: "hydration-log", ts: T + 120, data: { ml: 500 } }], { tz: TZ, now: T + 120 });
    expect(await waterOn(store, "2026-10-02", TZ)).toBe(1750);
    expect(await waterOn(store, "2026-10-01", TZ)).toBe(0);
  });

  it("counts water logged in Fitbit through the roll-up only, never again from its log entry", async () => {
    await store.upsertDailyValues([{ day: "2026-10-02", key: "water", value: 1000 }]); // the sync's sum, Fitbit's 330 ml in it
    await store.replaceExternalEntries({ from: "2026-10-02", to: "2026-10-02" }, [
      { id: "hc-water-1", type: "hydration-log", ts: T, day: "2026-10-02", data: { ml: 330 }, createdAt: T, source: "health_connect" },
    ]);
    expect(await waterOn(store, "2026-10-02", TZ)).toBe(1000);
    await saveEntries(store, [{ type: "hydration-log", ts: T + 60, data: { ml: 250 } }], { tz: TZ, now: T + 60 });
    expect(await waterOn(store, "2026-10-02", TZ)).toBe(1250);
  });
});

describe("getLog", () => {
  it("offers cycle sheets to a female profile only, and hides cycle entries from a male one", async () => {
    await saveEntries(store, [{ type: "menstrual-period", ts: T - 86_400, data: { start: "2026-10-01", end: "2026-10-02", flow: null } }], { tz: TZ, now: T });
    await saveEntries(store, [{ type: "hydration-log", ts: T, data: { ml: 500 } }], { tz: TZ, now: T });
    const male = await getLog(ctxOf("male"));
    expect(male.kinds).toEqual(["water", "food", "weight", "spo2", "mood", "symptoms"]);
    expect(male.recent.map((e) => e.type)).toEqual(["hydration-log"]);
    expect(male).toMatchObject({ waterToday: 500, today: "2026-10-02", timeZone: TZ, demo: false });
    const female = await getLog(ctxOf("female"), { demo: true });
    expect(female.kinds).toEqual([...LOG_KINDS]);
    expect(female.recent.map((e) => e.type)).toEqual(["hydration-log", "menstrual-period"]);
    expect(female.demo).toBe(true);
    // Everything is kept in Pulse: no sheet is blocked on a Google grant.
    expect(Object.values(female.access).every((a) => a === "demo")).toBe(true);
  });

  it("lists the last 14 days only", async () => {
    await saveEntries(store, [{ type: "hydration-log", ts: T - 14 * 86_400, data: { ml: 100 } }], { tz: TZ, now: T });
    await saveEntries(store, [{ type: "hydration-log", ts: T - 13 * 86_400, data: { ml: 200 } }], { tz: TZ, now: T });
    expect((await getLog(ctxOf("male"))).recent.map((e) => e.detail)).toEqual(["200\u00a0ml"]);
  });

  it("shows Fitbit's entries beside Pulse's, cycle ones to a female profile only", async () => {
    await store.replaceExternalEntries({ from: "2026-10-01", to: "2026-10-02" }, [
      { id: "hc-water-1", type: "hydration-log", ts: T - 60, day: "2026-10-02", data: { ml: 330 }, createdAt: T - 60, source: "health_connect" },
      { id: "hc-spotting-1", type: "menstrual-period", ts: T - 3600, day: "2026-10-02", data: { start: "2026-10-02", end: "2026-10-02", flow: "SPOTTING", spotting: true }, createdAt: T - 3600, source: "health_connect" },
    ]);
    await saveEntries(store, [{ type: "hydration-log", ts: T, data: { ml: 250 } }], { tz: TZ, now: T });
    expect((await getLog(ctxOf("male"))).recent.map((e) => [e.title, e.source])).toEqual([
      ["Water", "pulse"],
      ["Water", "health_connect"],
    ]);
    expect((await getLog(ctxOf("female"))).recent.map((e) => e.title)).toEqual(["Water", "Water", "Spotting"]);
  });
});
