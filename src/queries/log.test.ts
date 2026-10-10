// Ported from pulse src/server/queries/log.test.ts onto the F2 seed. The seed holds no logged entries, no water or food
// totals, and weigh-ins on 2026-09-05 (77.3 kg) and 2026-08-06 (77.6 kg); the test adds what each case needs.
import { beforeAll, describe, expect, it } from "vitest";
import type { NewLoggedEntry } from "../data/repos/log";
import { scopeUrl } from "@/lib/log";
import type { QueryCtx } from "./common";
import { getLog, getLogEntries } from "./log";
import { seededCtx } from "./testing";

const DAY = "2026-10-02"; // `now` is 14:00 local on this day
const at = (hhmm: string, day = DAY) => Date.parse(`${day}T${hhmm}:00+05:30`) / 1000;
const NOW = 1790929800;

let ctx: QueryCtx;
const female = (c: QueryCtx): QueryCtx => ({ ...c, profile: { ...c.profile, sex: "female" } });

beforeAll(async () => {
  ctx = await seededCtx();
  const { log, daily, settings } = ctx.store;
  const entry = (id: string, type: string, ts: number, data: unknown, o: { day?: string; source?: "pulse" | "google"; app?: string | null } = {}): NewLoggedEntry => ({
    id,
    type,
    ts,
    day: o.day ?? DAY,
    data,
    googleName: `users/me/dataTypes/${type}/dataPoints/${id}`,
    source: o.source ?? "pulse",
    app: o.app ?? null,
    createdAt: NOW - 86_400,
  });
  for (const e of [
    entry("w1", "hydration-log", at("07:40"), { ml: 250 }),
    entry("w2", "hydration-log", at("10:15"), { ml: 500 }, { source: "google", app: "FITBIT" }),
    entry("f1", "nutrition-log", at("08:10"), { name: "Poha", meal: "BREAKFAST", kcal: 320, protein: 8, carbs: 58, fat: 7 }, { source: "google", app: "FITBIT" }),
    entry("f2", "nutrition-log", at("13:20"), { name: "Dal", meal: "LUNCH", kcal: 640, protein: 22, carbs: 92, fat: 18 }),
    entry("kg", "weight", at("07:22"), { kg: 70.6 }, { source: "google", app: "FITBIT" }),
    entry("bf", "body-fat", at("07:22"), { pct: 23.5 }, { source: "google", app: "FITBIT" }),
    entry("m1", "moods", at("11:30"), { moods: ["CALM"], valence: "PLEASANT" }),
    entry("old", "hydration-log", at("09:00", "2026-10-01"), { ml: 900 }, { day: "2026-10-01" }),
    entry("p1", "menstrual-period", at("00:00", "2026-09-30"), { start: "2026-09-30", end: "2026-10-03", flow: null }, { day: "2026-09-30" }),
  ])
    await log.insertEntry(e);
  await daily.upsertDailyValues([
    { day: DAY, key: "water", value: 1100 },
    { day: DAY, key: "calories_in", value: 960 },
    { day: DAY, key: "protein", value: 30 },
    { day: DAY, key: "carbs", value: 150 },
    { day: DAY, key: "fat", value: 25 },
    { day: "2026-10-01", key: "water", value: 900 },
  ]);
  // The seed's only sync row is "seed": no hydration or food sync has run, so Pulse's own entries are still pending.
  expect(await settings.getSyncState("hydration-log")).toBeNull();
});

describe("getLog", () => {
  it("groups the selected day's entries: drinks, food by meal, weigh-ins, mood, with where each came from", async () => {
    const vm = await getLog(ctx, DAY);
    expect(vm.water.entries.map((e) => [e.detail, e.app])).toEqual([["250 ml", "Pulse"], ["500 ml", "Fitbit"]]);
    expect(vm.food.meals.map((m) => [m.meal, m.kcal, m.entries.map((e) => e.id)])).toEqual([
      ["BREAKFAST", 320, ["f1"]],
      ["LUNCH", 640, ["f2"]],
      ["DINNER", 0, []],
      ["SNACK", 0, []],
    ]);
    expect(vm.body.weighins).toMatchObject([{ kg: 70.6, pct: 23.5, entries: [{ id: "kg" }, { id: "bf" }] }]);
    expect(vm.body.latest).toEqual({ kg: 70.6, day: DAY });
    expect(vm.body.change).toEqual({ kg: -6.7, since: "2026-09-05" });
    expect(vm.moods.map((e) => e.id)).toEqual(["m1"]);
    expect(vm.water.entries.map((e) => [e.atGoogle, e.fromApp])).toEqual([[true, false], [true, true]]);
  });

  it("totals come from Google's roll-up plus Pulse entries the sync has not seen", async () => {
    const vm = await getLog(ctx, DAY);
    expect(vm.water.total).toBe(1100 + 250); // no sync row for hydration, so Pulse's own drink is still pending
    expect(vm.food.total).toEqual({ kcal: 960 + 640, protein: 52, carbs: 242, fat: 43 });
    expect(vm.week.map((w) => w.water)).toEqual([null, null, null, null, null, 900 + 900, 1350]);
  });

  it("another day shows only its own entries; the weight tile falls back to the last weigh-in", async () => {
    const vm = await getLog(ctx, "2026-10-01");
    expect(vm.water.entries.map((e) => e.id)).toEqual(["old"]);
    expect(vm.food.meals.every((m) => !m.entries.length)).toBe(true);
    expect(vm.body).toMatchObject({ latest: { kg: 77.3, day: "2026-09-05" }, change: { kg: -0.3, since: "2026-08-06" }, weighins: [] });
  });

  it("weight and body fat a moment apart are one weigh-in; a cycle symptom never shows on a male profile", async () => {
    const day = "2026-09-25";
    const { log } = ctx.store;
    const base = { day, googleName: null, createdAt: NOW, source: "pulse" as const, app: null };
    await log.insertEntry({ ...base, id: "a", type: "weight", ts: at("07:22", day), data: { kg: 70 } });
    await log.insertEntry({ ...base, id: "b", type: "body-fat", ts: at("07:22", day) + 30, data: { pct: 23 } });
    await log.insertEntry({ ...base, id: "c", type: "weight", ts: at("19:00", day), data: { kg: 70.4 } });
    await log.insertEntry({ ...base, id: "s", type: "symptoms", ts: at("09:00", day), data: { symptoms: ["CRAMPS"] } });
    const vm = await getLog(ctx, day);
    expect(vm.body.weighins.map((w) => [w.kg, w.pct, w.entries.map((e) => e.id)])).toEqual([[70, 23, ["a", "b"]], [70.4, null, ["c"]]]);
    expect(vm.body.latest).toEqual({ kg: 70.4, day });
    expect(vm.symptoms).toEqual([]);
    expect((await getLog(female(ctx), day)).symptoms.map((e) => e.id)).toEqual(["s"]);
  });

  it("a weight older than 90 days is not the latest; a day past the import window is not listed", async () => {
    const vm = await getLog({ ...ctx, now: Date.parse("2027-01-10T12:00:00+05:30") / 1000 }, "2027-01-10");
    expect(vm.body.latest).toBeNull();
    expect((await getLog(ctx, "2026-09-01")).listed).toBe(false);
    expect((await getLog(ctx, DAY)).listed).toBe(true);
  });

  it("a period running through the day shows on a female profile only", async () => {
    expect((await getLog(ctx, DAY)).cycle).toEqual([]);
    const vm = await getLog(female(ctx), DAY);
    expect(vm.cycle.map((e) => e.id)).toEqual(["p1"]);
    expect(vm.kinds).toContain("period");
    expect((await getLog(ctx, DAY)).kinds).not.toContain("period");
    expect((await getLog(female(ctx), "2026-10-04")).cycle).toEqual([]); // ended the day before
  });

  it("access: with no Google grant every sheet is not_connected; a grant without a scope asks to reconnect that sheet", async () => {
    expect(Object.values((await getLog(ctx, DAY)).access).every((a) => a === "not_connected")).toBe(true);
    await ctx.store.settings.set("google.grant", { scope: scopeUrl("hydration-log"), revokedAt: null, updatedAt: NOW });
    const a = (await getLog(female(ctx), DAY)).access;
    expect(a).toMatchObject({ water: "ok", food: "ok", mood: "reconnect", weight: "reconnect", period: "reconnect" });
    await ctx.store.settings.remove("google.grant");
  });
});

describe("getLogEntries", () => {
  it("loads the entries behind a row by id, in the order asked, leaving out ones already deleted", async () => {
    const r = await getLogEntries(ctx, ["bf", "kg", "gone"], DAY);
    expect(r.entries.map((e) => [e.id, e.title, e.detail])).toEqual([["bf", "Body fat", "23.5%"], ["kg", "Weight", "70.6 kg"]]);
    expect(r).toMatchObject({ day: DAY, today: DAY, timeZone: "Asia/Kolkata" });
  });
});
