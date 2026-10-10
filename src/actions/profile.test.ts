// The profile action: validation as pulse's saveProfileAction, onboarding's default behaviours, and the recompute mark.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Store } from "../data/repos";
import { testStore } from "../data/testing";
import { getProfile } from "../profile";
import { saveProfileAction, type ProfileFields } from "./profile";

const h = vi.hoisted(() => ({ changed: vi.fn() }));
vi.mock("../screens/useScreen", () => ({ dataChanged: h.changed }));

let store: Store;
const form: ProfileFields = { birthDate: "1990-01-01", sex: "male", maxHr: "", heightCm: "", timeZone: "Asia/Kolkata" };

beforeEach(() => {
  h.changed.mockClear();
  store = testStore();
});

describe("saveProfileAction", () => {
  it("saves the profile (blank optional fields are null: max HR is then estimated) and tells the screens", async () => {
    expect(await saveProfileAction(store, form)).toEqual({ ok: true });
    expect(await getProfile(store, "2026-10-10")).toMatchObject({ birthDate: "1990-01-01", sex: "male", maxHr: 183, maxHrSource: "estimated", heightCm: null, timeZone: "Asia/Kolkata" });
    expect(h.changed).toHaveBeenCalledOnce();
    expect(await saveProfileAction(store, { ...form, maxHr: " 190 ", heightCm: "178.5" })).toEqual({ ok: true });
    expect(await getProfile(store, "2026-10-10")).toMatchObject({ maxHr: 190, maxHrSource: "set", heightCm: 178.5 });
  });

  it("marks every day with data for recompute only when something changed", async () => {
    await store.daily.upsertDailyMetrics([{ day: "2026-10-01", source: "google", hrvMs: 50 }]);
    await saveProfileAction(store, form);
    expect(await store.scores.dirtyDays()).toEqual(["2026-10-01"]);
    await store.scores.clearDirty();
    await saveProfileAction(store, form);
    expect(await store.scores.dirtyDays()).toEqual([]);
    await saveProfileAction(store, { ...form, sex: "female" });
    expect(await store.scores.dirtyDays()).toEqual(["2026-10-01"]);
  });

  it("says which fields are wrong, with pulse's wording, and writes nothing", async () => {
    const r = await saveProfileAction(store, { birthDate: "", sex: null, maxHr: "300", heightCm: "50", timeZone: "Mars/Base" });
    expect(r).toEqual({
      ok: false,
      fields: { birthDate: "Enter your birth date", sex: "Choose one", maxHr: "Between 100 and 240", heightCm: "Between 100 and 250 cm", timeZone: "Choose a time zone" },
    });
    expect(await store.profile.getProfileRow()).toBeNull();
    expect(h.changed).not.toHaveBeenCalled();
    const young = await saveProfileAction(store, { ...form, birthDate: "2025-01-01" });
    expect(young).toMatchObject({ ok: false, fields: { birthDate: "Enter a birth date between 13 and 100 years ago" } });
  });

  it("onboarding also creates the Journal's default behaviours, once; Settings does not", async () => {
    await saveProfileAction(store, form);
    expect(await store.journal.tags()).toEqual([]);
    await saveProfileAction(store, form, { onboarding: true });
    expect((await store.journal.tags()).map((t) => t.tag)).toEqual(["alcohol", "late_caffeine", "late_meal", "screen_in_bed", "meditation", "stretching", "sauna", "travel", "illness"]);
    await saveProfileAction(store, form, { onboarding: true });
    expect(await store.journal.tags()).toHaveLength(9);
  });
});
