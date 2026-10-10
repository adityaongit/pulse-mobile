// Ported from pulse src/server/profile.test.ts. One person per install, so pulse's other-user case is gone; the seeded
// database is a few daily rows rather than the 180-day demo (the dirty-mark count is what matters).
import { describe, expect, it } from "vitest";
import { testDb, testStore } from "./data/testing";
import { getProfile, ProfileInput, saveProfile } from "./profile";
import { wholeYears } from "./time";

const input = { birthDate: "1990-06-15", sex: "female", maxHr: null, heightCm: 165, timeZone: "Asia/Kolkata" } as const;

describe("profile", () => {
  it("is null before onboarding", async () => {
    expect(await getProfile(testStore())).toBeNull();
  });

  it("estimates max HR from age (Tanaka) unless measured", async () => {
    const store = testStore();
    await saveProfile(store, input);
    // Age 36 on 2026-10-02: 208 - 0.7 * 36 = 182.8
    expect(await getProfile(store, "2026-10-02")).toEqual({ birthDate: "1990-06-15", sex: "female", maxHr: 183, maxHrSource: "estimated", heightCm: 165, timeZone: "Asia/Kolkata" });
    // Birthday not reached yet, age 35: 183.5
    expect((await getProfile(store, "2026-06-14"))!.maxHr).toBe(184);
    await saveProfile(store, { ...input, maxHr: 190 });
    expect(await getProfile(store)).toMatchObject({ maxHr: 190, maxHrSource: "set" });
  });

  it("without the user's own, max HR is Tanaka's estimate, never the top of Google's peak zone (a flat 220)", async () => {
    const store = testStore();
    await saveProfile(store, input);
    await store.daily.upsertDailyMetrics([
      { day: "2026-09-30", hrZones: [98, 118, 137, 157, 186], source: "google" },
      { day: "2026-10-01", hrZones: [30, 119, 145, 177, 220], source: "google" },
    ]);
    const age = wholeYears(input.birthDate, "2026-10-02");
    expect(await getProfile(store, "2026-10-02")).toMatchObject({ maxHr: Math.round(208 - 0.7 * age), maxHrSource: "estimated" });
    await saveProfile(store, { ...input, maxHr: 190 });
    expect(await getProfile(store)).toMatchObject({ maxHr: 190, maxHrSource: "set" });
  });

  it("falls back to Google's latest height when the user gave none", async () => {
    const store = testStore();
    await saveProfile(store, { ...input, heightCm: null });
    expect((await getProfile(store))!.heightCm).toBeNull();
    await store.daily.upsertDailyValues([{ day: "latest", key: "height_cm", value: 171 }]);
    expect((await getProfile(store))!.heightCm).toBe(171);
  });

  it("saving a change marks every day for recompute; saving the same values does nothing", async () => {
    const { store } = testDb();
    const days = ["2026-09-29", "2026-09-30", "2026-10-01"];
    await store.daily.upsertDailyMetrics(days.map((day) => ({ day, steps: 1000, source: "google" })));
    const dirty = async () => (await store.scores.dirtyDays()).length;
    expect(await dirty()).toBe(0);
    expect(await saveProfile(store, input)).toBe(true);
    expect(await dirty()).toBe(days.length);
    await store.scores.clearDirty();
    expect(await saveProfile(store, input)).toBe(false);
    expect(await dirty()).toBe(0);
    expect(await saveProfile(store, { ...input, timeZone: "UTC" })).toBe(true);
    expect(await dirty()).toBe(days.length);
  });

  it("validates input, coercing form strings", () => {
    expect(ProfileInput.parse({ birthDate: "1990-06-15", sex: "male", maxHr: "185", heightCm: "178.5", timeZone: "UTC" })).toEqual({
      birthDate: "1990-06-15",
      sex: "male",
      maxHr: 185,
      heightCm: 178.5,
      timeZone: "UTC",
    });
    for (const bad of [
      { ...input, birthDate: "15/06/1990" },
      { ...input, birthDate: new Date().toISOString().slice(0, 10) },
      { ...input, sex: "x" },
      { ...input, maxHr: 300 },
      { ...input, heightCm: 20 },
      { ...input, timeZone: "Mars/Olympus" },
    ])
      expect(ProfileInput.safeParse(bad).success).toBe(false);
  });
});
