import { beforeAll, expect, it } from "vitest";
import { testDb } from "../data/testing";
import { saveProfile } from "../profile";
import { loadCalendarMonth } from "./calendar";

const { store } = testDb();
beforeAll(() => saveProfile(store, { birthDate: "1990-01-01", sex: "male", maxHr: null, heightCm: null, timeZone: "Asia/Kolkata" }));

it("returns a month's days for the calendar panel, uncoloured on an empty database", async () => {
  const days = await loadCalendarMonth(store, "2026-09");
  expect(days).toHaveLength(30);
  expect(days[0]).toEqual({ day: "2026-09-01", recovery: null, strain: null, sleep: null });
});

it("rejects a malformed month", async () => {
  await expect(loadCalendarMonth(store, "2026-9")).rejects.toThrow("Bad month");
});
