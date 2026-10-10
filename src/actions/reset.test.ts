// Disconnect Google: the grant and everything Google synced go, in one transaction; what the person wrote stays.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testDb } from "../data/testing";
import { saveProfile } from "../profile";
import { disconnectGoogle } from "./reset";

const h = vi.hoisted(() => ({ changed: vi.fn() }));
vi.mock("../screens/useScreen", () => ({ dataChanged: h.changed }));

let t: ReturnType<typeof testDb>;
const count = (table: string) => (t.sqlite.prepare(`select count(*) n from ${table}`).get() as { n: number }).n;

beforeEach(async () => {
  h.changed.mockClear();
  t = testDb();
  const { store } = t;
  await saveProfile(store, { birthDate: "1990-01-01", sex: "male", maxHr: null, heightCm: null, timeZone: "Asia/Kolkata" });
  await store.settings.set("google.grant", { scope: "s", revokedAt: null, updatedAt: 1 });
  await store.settings.set("theme", "dark");
  await store.settings.setSyncState("heart-rate", { lastSuccessAt: 5 });
  await store.daily.upsertDailyMetrics([{ day: "2026-10-01", source: "google", hrvMs: 50 }]);
  await store.samples.mergeSamples("hr", { start: 1_790_000_000, end: 1_790_000_100 }, new Map([[1_790_000_000, 60]]), "replace");
  await store.journal.ensureDefaultTags([{ tag: "alcohol", label: "Alcohol" }]);
  await store.journal.saveEntry({ day: "2026-10-01", tag: "alcohol", value: 1, detail: null });
  await store.scores.markDirty(["2026-10-01"]);
});

describe("disconnectGoogle", () => {
  it("clears the grant, the sync cursors and the synced rows; keeps the profile, the journal and the preferences", async () => {
    let forgotten = 0;
    expect(await disconnectGoogle(t.store, async () => void forgotten++)).toEqual({ ok: true, data: undefined });
    expect(forgotten).toBe(1);
    expect(await t.store.settings.get("google.grant")).toBeNull();
    expect(await t.store.settings.readSyncState()).toEqual([]);
    expect(count("daily_metrics")).toBe(0);
    expect(count("hr_days")).toBe(0);
    expect(count("intraday_dirty")).toBe(0);
    expect(await t.store.profile.getProfileRow()).not.toBeNull();
    expect(await t.store.settings.get("theme")).toBe("dark");
    expect(count("journal_entries")).toBe(1);
    expect(h.changed).toHaveBeenCalledOnce();
  });

  it("rolls everything back when a step fails, and says so", async () => {
    const boom = vi.spyOn(t.store.sessions, "clearSynced");
    boom.mockRejectedValueOnce(new Error("disk"));
    // The store's own repositories are what `transaction` hands out, so the failure lands inside the transaction.
    expect(await disconnectGoogle(t.store)).toEqual({ ok: false, error: "Couldn’t disconnect. Try again." });
    expect(await t.store.settings.get("google.grant")).not.toBeNull();
    expect(count("daily_metrics")).toBe(1);
    expect(count("hr_days")).toBe(1);
    expect(h.changed).not.toHaveBeenCalled();
  });
});
