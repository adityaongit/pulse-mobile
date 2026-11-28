// halo's src/screens/journal/actions.test.ts (ported from pulse's journal and log action tests) on Pulse's actions:
// the journal and log parts, plus Select Behaviors' save. There is one person per phone and no Google write.
import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryStore } from "@/data/memory";
import type { Store } from "@/data/store";
import type { Profile } from "@/data/types";
import { DEFAULT_JOURNAL_TAGS, ensureDefaultTags, getBehaviours, getJournal, MAX_TAG_ROWS, MAX_TAGS } from "@/queries/journal";
import { getMore, journalTable } from "@/queries/settings";
import type { QueryCtx } from "@/queries/ctx";
import { addCustomTag, loadCheckIn, saveBehaviors, saveCheckIn, saveJournalEntry, type ActionCtx } from "./journal";
import { deleteLogEntry, logEntry, logFoods, setFoodSeparate, updateFoodEntry } from "./log";

const TZ = "Asia/Kolkata";
// 20:00 UTC on Oct 2 is 01:30 on Oct 3 in Kolkata.
const NIGHT = Date.parse("2026-10-02T20:00:00Z") / 1000;
// 06:00 UTC on Oct 2 is 11:30 in Kolkata.
const MORNING = Date.parse("2026-10-02T06:00:00Z") / 1000;

let store: Store;
let now = NIGHT;
let sex: Profile["sex"] = "male";
const c = (): ActionCtx => ({ store, profile: { birthDate: "1990-01-01", sex, maxHr: null, heightCm: null, timeZone: TZ }, timeZone: TZ, nowS: () => now });
const q = (today: string): QueryCtx => ({ ...c(), today, now, sync: { lastSyncTs: null, firstDay: null, lastError: null } });
const entries = async () => (await store.allJournal()).map(({ day, tag, value }) => ({ day, tag, value }));
const order = async (keep: (t: { tag: string; isDefault: boolean }) => boolean) => (await store.journalTags()).filter(keep).map((t) => t.tag);

beforeEach(async () => {
  store = openMemoryStore();
  now = NIGHT;
  sex = "male";
  await ensureDefaultTags(store);
});

describe("ensureDefaultTags", () => {
  it("is idempotent and keeps custom tags", async () => {
    expect(await ensureDefaultTags(store)).toBe(0);
    await addCustomTag(c(), { label: "Cold plunge" });
    expect(await ensureDefaultTags(store)).toBe(0);
    const tags = await store.journalTags();
    expect(tags.filter((t) => t.isDefault)).toHaveLength(DEFAULT_JOURNAL_TAGS.length);
    expect(tags.find((t) => t.tag === "cold_plunge")).toMatchObject({ tag: "cold_plunge", label: "Cold plunge", isDefault: false, hidden: false });
  });

  it("an empty store gets the defaults the first time the tags are read", async () => {
    store = openMemoryStore();
    expect(await saveJournalEntry(c(), { day: "2026-10-01", tag: "alcohol", value: true })).toMatchObject({ ok: true });
    expect((await store.journalTags()).map((t) => t.tag)).toEqual(DEFAULT_JOURNAL_TAGS.map((t) => t.tag));
  });
});

describe("saveJournalEntry", () => {
  it("saves today in the person's time zone, and past days", async () => {
    expect(await saveJournalEntry(c(), { day: "2026-10-03", tag: "alcohol", value: true })).toEqual({ ok: true, data: undefined });
    expect(await saveJournalEntry(c(), { day: "2026-09-01", tag: "alcohol", value: 2 })).toMatchObject({ ok: true });
    expect(await entries()).toEqual([
      { day: "2026-10-03", tag: "alcohol", value: 1 },
      { day: "2026-09-01", tag: "alcohol", value: 2 },
    ]);
  });

  it("marks the day for a recompute", async () => {
    await saveJournalEntry(c(), { day: "2026-09-30", tag: "alcohol", value: true });
    await saveJournalEntry(c(), { day: "2026-09-30", tag: "alcohol", value: null });
    expect(await store.takeIntradayDirty()).toEqual(["2026-09-30"]);
  });

  it("rejects a future day", async () => {
    expect(await saveJournalEntry(c(), { day: "2026-10-04", tag: "alcohol", value: true })).toEqual({ ok: false, error: "Can’t log a future day" });
    expect(await entries()).toEqual([]);
    expect(await store.takeIntradayDirty()).toEqual([]);
  });

  it("rejects an unknown tag and malformed input", async () => {
    expect(await saveJournalEntry(c(), { day: "2026-10-01", tag: "nope", value: true })).toEqual({ ok: false, error: "Unknown tag: nope" });
    expect((await saveJournalEntry(c(), { day: "2026-13-01", tag: "alcohol", value: true })).ok).toBe(false);
    expect((await saveJournalEntry(c(), { day: "2026-02-31", tag: "alcohol", value: true })).ok).toBe(false);
    expect((await saveJournalEntry(c(), { day: "2026-10-01", tag: "alcohol", value: -1 })).ok).toBe(false);
    expect((await saveJournalEntry(c(), { day: "2026-10-01", tag: "alcohol", value: 1.5 })).ok).toBe(false);
    expect(await entries()).toEqual([]);
  });

  it("a repeat submit is idempotent; a changed answer updates the row", async () => {
    const e = { day: "2026-10-01", tag: "meditation", value: true };
    await saveJournalEntry(c(), e);
    await saveJournalEntry(c(), e);
    expect(await entries()).toEqual([{ day: "2026-10-01", tag: "meditation", value: 1 }]);
    await saveJournalEntry(c(), { ...e, value: false });
    expect(await entries()).toEqual([{ day: "2026-10-01", tag: "meditation", value: 0 }]);
  });

  it("null clears a saved answer back to unanswered, and is idempotent", async () => {
    await saveJournalEntry(c(), { day: "2026-10-01", tag: "alcohol", value: true });
    await saveJournalEntry(c(), { day: "2026-10-01", tag: "sauna", value: false });
    expect(await saveJournalEntry(c(), { day: "2026-10-01", tag: "alcohol", value: null })).toEqual({ ok: true, data: undefined });
    expect(await saveJournalEntry(c(), { day: "2026-10-01", tag: "alcohol", value: null })).toMatchObject({ ok: true });
    expect(await entries()).toEqual([{ day: "2026-10-01", tag: "sauna", value: 0 }]);
    expect(await saveJournalEntry(c(), { day: "2026-10-04", tag: "alcohol", value: null })).toMatchObject({ ok: false });
  });
});

describe("loadCheckIn", () => {
  it("returns the shown behaviours and the day's answers; refuses a future, malformed or too-old day", async () => {
    await saveJournalEntry(c(), { day: "2026-10-01", tag: "alcohol", value: true });
    const r = await loadCheckIn(q("2026-10-03"), "2026-10-01");
    expect(r.ok && r.data.checkIn).toMatchObject({ done: true, entries: { alcohol: 1 } });
    expect(r.ok && r.data.tags.some((t) => t.tag === "alcohol")).toBe(true);
    expect(await loadCheckIn(q("2026-10-03"), "2026-10-04")).toMatchObject({ ok: false });
    expect(await loadCheckIn(q("2026-10-03"), "nope")).toMatchObject({ ok: false });
    // Too far back: the sheet's day strip would run from that day to today.
    expect(await loadCheckIn(q("2026-10-03"), "2010-01-01")).toMatchObject({ ok: false });
  });
});

describe("addCustomTag", () => {
  it("stops at MAX_TAGS, so insights work per recompute stays bounded", async () => {
    const have = (await store.journalTags()).length;
    for (let i = have; i < MAX_TAGS; i++) expect((await addCustomTag(c(), { label: `Cap ${i}` })).ok).toBe(true);
    expect(await addCustomTag(c(), { label: "One more" })).toEqual({ ok: false, error: `Too many behaviours: the limit is ${MAX_TAGS}` });
  });

  it("validates the label and rejects duplicates", async () => {
    expect(await addCustomTag(c(), { label: "  Late  Workout! " })).toEqual({ ok: true, data: { tag: "late_workout" } });
    expect(await addCustomTag(c(), { label: "late workout" })).toEqual({ ok: false, error: "Tag already exists: late_workout" });
    expect(await addCustomTag(c(), { label: "Alcohol" })).toMatchObject({ ok: false });
    expect((await addCustomTag(c(), { label: "   " })).ok).toBe(false);
    expect((await addCustomTag(c(), { label: "!!!" })).ok).toBe(false);
    expect((await addCustomTag(c(), { label: "x".repeat(41) })).ok).toBe(false);
    expect(await saveJournalEntry(c(), { day: "2026-10-02", tag: "late_workout", value: true })).toMatchObject({ ok: true });
  });

  it("puts a new behaviour after every existing one", async () => {
    await addCustomTag(c(), { label: "Cold plunge" });
    await addCustomTag(c(), { label: "Late workout" });
    await addCustomTag(c(), { label: "Nap" });
    expect(await order((t) => !t.isDefault)).toEqual(["cold_plunge", "late_workout", "nap"]);
  });
});

describe("saveCheckIn", () => {
  it("saves each answer and stops at the first failure", async () => {
    expect(await saveCheckIn(c(), "2026-10-01", [{ tag: "alcohol", value: 2 }, { tag: "sauna", value: false }])).toEqual({ ok: true, data: undefined });
    expect(await saveCheckIn(c(), "2026-10-01", [{ tag: "nope", value: true }, { tag: "meditation", value: true }])).toEqual({ ok: false, error: "Unknown tag: nope" });
    expect(await entries()).toEqual([
      { day: "2026-10-01", tag: "alcohol", value: 2 },
      { day: "2026-10-01", tag: "sauna", value: 0 },
    ]);
  });
});

describe("saveBehaviors", () => {
  it("removes a custom, default and never-selected catalogue behaviour while keeping past answers and labels", async () => {
    const day = "2026-10-01";
    const ctx = q("2026-10-03");
    const remove = ["cold_plunge", "sauna", "camping"];
    await addCustomTag(c(), { label: "Cold Plunge!" });
    await saveCheckIn(c(), day, [{ tag: "cold_plunge", value: true }, { tag: "sauna", value: false }]);
    expect((await saveBehaviors(c(), { tags: ["alcohol"], remove })).ok).toBe(true);
    await ensureDefaultTags(store);
    // An older selection cannot restore a behaviour just removed in the picker.
    await saveBehaviors(c(), { tags: ["alcohol", "sauna"] });
    const picker = await getBehaviours(ctx);
    expect(picker.tags.filter((t) => t.removed).map((t) => t.tag).sort()).toEqual([...remove].sort());
    expect(picker.tags.find((t) => t.tag === "travel")).toMatchObject({ hidden: true, removed: false });
    const journal = await getJournal(day, ctx);
    expect(journal.tags.map((t) => t.tag)).toEqual(["alcohol"]);
    expect(journal.history).toContainEqual({ day, yes: ["Cold Plunge!"] });
    expect((await journalTable(ctx)).rows).toEqual([[day, "cold_plunge", "Cold Plunge!", 1], [day, "sauna", "Sauna", 0]]);
    expect((await getMore(ctx)).behaviours).toEqual({ shown: 1, total: DEFAULT_JOURNAL_TAGS.length - 1 });
    expect((await saveJournalEntry(c(), { day, tag: "sauna", value: true })).ok).toBe(false);
    expect((await saveBehaviors(c(), { tags: ["alcohol"], restore: ["sauna"] })).ok).toBe(true);
    expect((await store.journalTags()).find((t) => t.tag === "sauna")).toMatchObject({ hidden: true, removed: false, isDefault: true });
    expect((await addCustomTag(c(), { label: "Cold Plunge!" })).ok).toBe(true);
    expect((await getJournal(day, ctx)).tags.map((t) => t.tag)).toContain("cold_plunge");
  });

  it("frees a place at the tag limit and leaves the whole selection alone when a restore exceeds it", async () => {
    for (let i = DEFAULT_JOURNAL_TAGS.length; i < MAX_TAGS; i++) await addCustomTag(c(), { label: `Cap ${i}` });
    expect((await saveBehaviors(c(), { tags: ["caffeine"], remove: ["travel"] })).ok).toBe(true);
    const before = await store.journalTags();
    expect((await saveBehaviors(c(), { tags: ["sauna"], restore: ["travel"] })).ok).toBe(false);
    expect(await store.journalTags()).toEqual(before);
    expect((await saveBehaviors(c(), { tags: [], remove: ["unknown"] })).ok).toBe(false);
    expect(await store.journalTags()).toEqual(before);
    await saveBehaviors(c(), { tags: [], remove: ["caffeine"] });
    const competing = await Promise.all([
      saveBehaviors(c(), { tags: [], restore: ["travel"] }),
      addCustomTag(c(), { label: "One more" }),
    ]);
    expect(competing.filter((r) => r.ok)).toHaveLength(1);
    expect((await store.journalTags()).filter((t) => !t.removed)).toHaveLength(MAX_TAGS);
  });

  it("caps tag rows, removed ones included, so insights work stays bounded", async () => {
    let n = 0;
    while ((await store.journalTags()).length < MAX_TAG_ROWS) {
      const { ok, data } = (await addCustomTag(c(), { label: `Row ${n++}` })) as { ok: boolean; data: { tag: string } };
      expect(ok).toBe(true);
      expect((await saveBehaviors(c(), { tags: [], remove: [data.tag] })).ok).toBe(true);
    }
    expect((await addCustomTag(c(), { label: "One more" })).ok).toBe(false);
    expect((await saveBehaviors(c(), { tags: ["acupuncture"] })).ok).toBe(false);
    expect((await addCustomTag(c(), { label: "Row 0" })).ok).toBe(true);
  });

  it("adds catalogue behaviours, hides the rest and keeps their answers", async () => {
    await saveJournalEntry(c(), { day: "2026-10-01", tag: "sauna", value: true });
    expect(await saveBehaviors(c(), { tags: ["alcohol", "caffeine"] })).toEqual({ ok: true, data: undefined });
    const tags = await store.journalTags();
    expect(tags.filter((t) => !t.hidden).map((t) => t.tag)).toEqual(["alcohol", "caffeine"]);
    expect(tags.find((t) => t.tag === "caffeine")).toMatchObject({ label: "Caffeine", isDefault: false });
    expect(await entries()).toEqual([{ day: "2026-10-01", tag: "sauna", value: 1 }]);
    const vm = await getBehaviours(q("2026-10-03"));
    expect(vm.tags.find((t) => t.tag === "sauna")).toMatchObject({ hidden: true, answers: 1 });
    expect(await saveBehaviors(c(), { tags: ["not_a_behaviour"] })).toEqual({ ok: false, error: "Unknown behaviour" });
  });
});

describe("logEntry", () => {
  beforeEach(() => {
    now = MORNING;
  });
  const rows = () => store.loggedEntries(0);

  it("stores locally", async () => {
    expect(await logEntry(c(), { kind: "water", ml: 250 })).toEqual({ ok: true, data: undefined });
    expect(await rows()).toMatchObject([{ type: "hydration-log", day: "2026-10-02", data: { ml: 250 } }]);
  });

  it("validates input, the time, and writes weight and body fat as two points", async () => {
    expect(await logEntry(c(), { kind: "water", ml: 0 })).toEqual({ ok: false, error: "At least 10 ml" });
    expect(await logEntry(c(), { kind: "mood", moods: [], valence: null })).toEqual({ ok: false, error: "Choose how you feel" });
    expect(await logEntry(c(), { kind: "weight", kg: 72.44, fatPct: null, at: "2026-10-02T12:00" })).toEqual({ ok: false, error: "Can’t log the future" });
    expect(await logEntry(c(), { kind: "weight", kg: 72.44, fatPct: null, at: "2026-10-02 08:00" })).toEqual({ ok: false, error: "Choose a time" });
    expect(await logEntry(c(), { kind: "weight", kg: 72.44, fatPct: null, at: "2026-10-02T25:00" })).toEqual({ ok: false, error: "Choose a time" });
    expect(await logEntry(c(), { kind: "weight", kg: 72.44, fatPct: 18.26, at: "2026-10-02T08:00" })).toMatchObject({ ok: true });
    expect((await rows()).map((r) => [r.type, r.data, r.ts])).toEqual([
      ["weight", { kg: 72.4 }, Date.parse("2026-10-02T02:30:00Z") / 1000],
      ["body-fat", { pct: 18.3 }, Date.parse("2026-10-02T02:30:00Z") / 1000],
    ]);
  });

  it("refuses cycle logging and cycle symptoms on a male profile, allows them on a female one", async () => {
    const period = { kind: "period", start: "2026-09-29", end: "2026-10-01", flow: "LIGHT" } as const;
    expect(await logEntry(c(), period)).toEqual({ ok: false, error: "Not available for this profile" });
    expect(await logEntry(c(), { kind: "ovulation", result: "POSITIVE" })).toMatchObject({ ok: false });
    expect(await logEntry(c(), { kind: "symptoms", symptoms: ["CRAMPS"] })).toMatchObject({ ok: false });
    expect(await rows()).toEqual([]);
    sex = "female";
    expect(await logEntry(c(), period)).toMatchObject({ ok: true });
    expect(await logEntry(c(), { kind: "period", start: "2026-10-01", end: "2026-09-30", flow: null })).toEqual({ ok: false, error: "The last day is before the first" });
    expect(await logEntry(c(), { kind: "period", start: "2026-09-01", end: "2026-09-20", flow: null })).toEqual({ ok: false, error: "A period is 15 days at most" });
    expect((await rows()).map((r) => r.type)).toEqual(["menstrual-period"]);
  });

  it("logs blood oxygen as a percentage between 70 and 100", async () => {
    expect(await logEntry(c(), { kind: "spo2", pct: 101 })).toEqual({ ok: false, error: "Between 70 and 100%" });
    expect(await logEntry(c(), { kind: "spo2", pct: 95.44, at: "2026-10-02T08:00" })).toMatchObject({ ok: true });
    expect((await rows()).map((r) => [r.type, r.data])).toEqual([["oxygen-saturation", { pct: 95.4 }]]);
  });

  it("food keeps a blank name as null", async () => {
    expect(await logEntry(c(), { kind: "food", name: "  ", meal: "LUNCH", kcal: 600, protein: 20, carbs: null, fat: null })).toMatchObject({ ok: true });
    expect((await rows())[0].data).toEqual({ name: null, meal: "LUNCH", kcal: 600, protein: 20, carbs: null, fat: null });
    expect(await logEntry(c(), { kind: "food", name: "x", meal: "LUNCH", kcal: 20_000, protein: null, carbs: null, fat: null })).toEqual({ ok: false, error: "At most 10,000 kcal" });
  });
});

describe("deleteLogEntry", () => {
  it("needs a valid id, then deletes", async () => {
    now = MORNING;
    await logEntry(c(), { kind: "water", ml: 250 });
    const { id } = (await store.loggedEntries(0))[0];
    expect(await deleteLogEntry(c(), { id: "nope" })).toMatchObject({ ok: false });
    expect(await deleteLogEntry(c(), { id })).toEqual({ ok: true, data: undefined });
    expect(await store.loggedEntries(0)).toEqual([]);
  });
});


describe("logFoods and updateFoodEntry", () => {
  beforeEach(() => {
    now = MORNING;
  });
  const rows = () => store.loggedEntries(0);
  const eggs = { name: "Scrambled eggs", portion: "2 large eggs (100 g)", kcal: 182, protein: 12.6, carbs: 1.6, fat: 13.9, fiber: 0 };
  const toast = { name: "Toast", kcal: 80, protein: 4, carbs: 13.8, fat: 1.1, fiber: null };

  it("saves a photo estimate's foods at one meal and time, with portion, fiber and how it was made", async () => {
    expect(await logFoods(c(), { meal: "BREAKFAST", via: "photo", at: "2026-10-02T08:30", items: [eggs, toast] })).toEqual({ ok: true, data: { count: 2 } });
    const saved = await rows();
    expect(saved.map((r) => [r.type, r.day, r.ts, r.source])).toEqual([
      ["nutrition-log", "2026-10-02", Date.parse("2026-10-02T03:00:00Z") / 1000, "pulse"],
      ["nutrition-log", "2026-10-02", Date.parse("2026-10-02T03:00:00Z") / 1000, "pulse"],
    ]);
    expect(saved.map((r) => r.data)).toEqual([
      { name: "Scrambled eggs", meal: "BREAKFAST", kcal: 182, protein: 12.6, carbs: 1.6, fat: 13.9, portion: "2 large eggs (100 g)", fiber: 0, via: "photo" },
      { name: "Toast", meal: "BREAKFAST", kcal: 80, protein: 4, carbs: 13.8, fat: 1.1, via: "photo" },
    ]);
  });

  it("checks every food before saving any", async () => {
    expect(await logFoods(c(), { meal: "LUNCH", via: "photo", items: [] })).toEqual({ ok: false, error: "Add a food to save." });
    expect(await logFoods(c(), { meal: "LUNCH", via: "photo", items: [eggs, { ...toast, kcal: 80.5 }] })).toEqual({ ok: false, error: "Toast: Enter calories as a whole number." });
    expect(await logFoods(c(), { meal: "LUNCH", via: "manual", items: [{ ...toast, fiber: 5000 }] })).toEqual({ ok: false, error: "Macros are grams, between 0 and 1,000." });
    expect(await logFoods(c(), { meal: "LUNCH", via: "manual", items: [{ ...toast, portion: "x".repeat(61) }] })).toMatchObject({ ok: false });
    expect(await logFoods(c(), { meal: "BRUNCH" as never, via: "manual", items: [toast] })).toEqual({ ok: false, error: "Invalid option" });
    expect(await logFoods(c(), { meal: "LUNCH", via: "manual", at: "2026-10-02T23:00", items: [toast] })).toEqual({ ok: false, error: "Can’t log the future" });
    expect(await logFoods(c(), { meal: "LUNCH", via: "manual", items: Array(21).fill(toast) })).toMatchObject({ ok: false });
    expect(await rows()).toEqual([]);
  });

  it("edits a Pulse entry in place, keeping its id and how it was made", async () => {
    await logFoods(c(), { meal: "BREAKFAST", via: "photo", at: "2026-10-02T08:30", items: [eggs] });
    const [before] = await rows();
    const r = await updateFoodEntry(c(), { id: before.id, ts: before.ts, meal: "LUNCH", at: "2026-10-02T11:00", item: { name: "Egg bhurji", kcal: 240, protein: 14, carbs: 4, fat: 18 } });
    expect(r).toEqual({ ok: true, data: undefined });
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before.id, createdAt: before.createdAt, ts: Date.parse("2026-10-02T05:30:00Z") / 1000, day: "2026-10-02", source: "pulse" });
    expect(after[0].data).toEqual({ name: "Egg bhurji", meal: "LUNCH", kcal: 240, protein: 14, carbs: 4, fat: 18, via: "photo" });
  });

  it("never edits Fitbit's entries, or one that is gone", async () => {
    const ts = Date.parse("2026-10-02T03:00:00Z") / 1000;
    await store.replaceExternalEntries({ from: "2026-10-02", to: "2026-10-02" }, [
      { id: "hc-food-1", type: "nutrition-log", ts, day: "2026-10-02", data: { name: "Poha", meal: "BREAKFAST", kcal: 350, protein: 7, carbs: null, fat: null }, createdAt: ts, source: "health_connect" },
    ]);
    const item = { name: "Poha", kcal: 300, protein: 7, carbs: null, fat: null };
    expect(await updateFoodEntry(c(), { id: "hc-food-1", ts, meal: "BREAKFAST", item })).toEqual({ ok: false, error: "Food logged in Fitbit is changed in Fitbit." });
    expect(await updateFoodEntry(c(), { id: "missing", ts, meal: "BREAKFAST", item })).toEqual({ ok: false, error: "This food is no longer in your log." });
    expect((await rows())[0].data).toMatchObject({ kcal: 350 });
  });

  it("marks a food as its own (\"Count it too\") and back, keeping the mark through an edit", async () => {
    await logFoods(c(), { meal: "LUNCH", via: "photo", at: "2026-10-02T11:00", items: [toast] });
    const [row] = await rows();
    expect(await setFoodSeparate(c(), { id: row.id, ts: row.ts, separate: true })).toEqual({ ok: true, data: undefined });
    expect((await rows())[0].data).toMatchObject({ name: "Toast", separate: true, via: "photo" });
    await updateFoodEntry(c(), { id: row.id, ts: row.ts, meal: "LUNCH", item: { ...toast, kcal: 90 } });
    expect((await rows())[0].data).toMatchObject({ kcal: 90, separate: true });
    expect(await setFoodSeparate(c(), { id: row.id, ts: row.ts, separate: false })).toMatchObject({ ok: true });
    expect((await rows())[0].data).not.toHaveProperty("separate");
    expect(await setFoodSeparate(c(), { id: "gone", ts: row.ts, separate: true })).toEqual({ ok: false, error: "This food is no longer in your log." });
  });
});
