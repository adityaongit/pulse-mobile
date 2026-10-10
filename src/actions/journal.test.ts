// Ported from pulse src/server/actions/journal.test.ts: the check-in's writes, the check-in load, and notes. Select
// Behaviors' Save is Settings'; "signed out" and "per user" have no counterpart (one person per install).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { needsRecompute } from "../pipeline";
import { seededCtx } from "../queries/testing";
import type { Store } from "../data/repos";
import { addCustomTag, loadCheckIn, saveCheckIn, saveJournalEntry, saveJournalNote } from "./journal";
import { MAX_TAGS, tagKey } from "../journalTags";

const h = vi.hoisted(() => ({ changed: vi.fn() }));
vi.mock("../screens/useScreen", () => ({ dataChanged: h.changed }));

const TAGS = [
  { tag: "alcohol", label: "Alcohol" },
  { tag: "late_caffeine", label: "Late caffeine" },
  { tag: "meditation", label: "Meditation" },
  { tag: "sauna", label: "Sauna" },
  { tag: "illness", label: "Illness" },
];
let store: Store;
// The seed's own answers stay: tests write days after it (the seed ends 2026-10-02).
const answers = async (from: string, to: string) => (await store.journal.entriesBetween(from, to)).map(({ day, tag, value }) => ({ day, tag, value }));

beforeAll(async () => {
  store = (await seededCtx()).store;
  await store.journal.ensureDefaultTags(TAGS);
  // 20:00 UTC on Oct 2 is 01:30 on Oct 3 in Kolkata.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-02T20:00:00Z") });
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  for (const d of ["2026-10-03", "2026-09-01"]) for (const t of TAGS) await store.journal.deleteEntry(d, t.tag);
  await store.scores.clearDirty();
  h.changed.mockClear();
});

describe("saveJournalEntry", () => {
  it("saves today in the person's time zone, and past days, and tells the screens", async () => {
    expect(await saveJournalEntry(store, { day: "2026-10-03", tag: "alcohol", value: true })).toEqual({ ok: true, data: undefined });
    expect(await saveJournalEntry(store, { day: "2026-09-01", tag: "alcohol", value: 2 })).toMatchObject({ ok: true });
    expect(await answers("2026-09-01", "2026-09-01")).toContainEqual({ day: "2026-09-01", tag: "alcohol", value: 2 });
    expect(await answers("2026-10-03", "2026-10-03")).toEqual([{ day: "2026-10-03", tag: "alcohol", value: 1 }]);
    expect(h.changed).toHaveBeenCalledTimes(2);
  });

  it("marks the day dirty so a recompute is needed", async () => {
    expect(await needsRecompute(store)).toBe(false);
    await saveJournalEntry(store, { day: "2026-09-30", tag: "alcohol", value: true });
    await saveJournalEntry(store, { day: "2026-09-30", tag: "alcohol", value: null });
    expect(await store.scores.dirtyDays()).toEqual(["2026-09-30"]);
    expect(await needsRecompute(store)).toBe(true);
  });

  it("rejects a future day", async () => {
    expect(await saveJournalEntry(store, { day: "2026-10-04", tag: "alcohol", value: true })).toEqual({ ok: false, error: "Can’t log a future day" });
    expect(await answers("2026-10-04", "2026-10-04")).toEqual([]);
    expect(h.changed).not.toHaveBeenCalled();
    expect(await store.scores.dirtyDays()).toEqual([]);
  });

  it("rejects an unknown tag and malformed input", async () => {
    expect(await saveJournalEntry(store, { day: "2026-10-01", tag: "nope", value: true })).toEqual({ ok: false, error: "Unknown tag: nope" });
    expect((await saveJournalEntry(store, { day: "2026-13-01", tag: "alcohol", value: true })).ok).toBe(false);
    expect((await saveJournalEntry(store, { day: "2026-10-01", tag: "alcohol", value: -1 })).ok).toBe(false);
    expect((await saveJournalEntry(store, { day: "2026-10-01", tag: "alcohol", value: 1.5 })).ok).toBe(false);
    expect(h.changed).not.toHaveBeenCalled();
  });

  it("a repeat submit is idempotent; a changed answer updates the row", async () => {
    const e = { day: "2026-10-03", tag: "meditation", value: true };
    await saveJournalEntry(store, e);
    await saveJournalEntry(store, e);
    expect(await answers("2026-10-03", "2026-10-03")).toEqual([{ day: "2026-10-03", tag: "meditation", value: 1 }]);
    await saveJournalEntry(store, { ...e, value: false });
    expect(await answers("2026-10-03", "2026-10-03")).toEqual([{ day: "2026-10-03", tag: "meditation", value: 0 }]);
  });

  it("null clears a saved answer back to unanswered, and is idempotent", async () => {
    await saveJournalEntry(store, { day: "2026-10-03", tag: "alcohol", value: true });
    await saveJournalEntry(store, { day: "2026-10-03", tag: "sauna", value: false });
    expect(await saveJournalEntry(store, { day: "2026-10-03", tag: "alcohol", value: null })).toEqual({ ok: true, data: undefined });
    expect(await saveJournalEntry(store, { day: "2026-10-03", tag: "alcohol", value: null })).toMatchObject({ ok: true });
    expect(await answers("2026-10-03", "2026-10-03")).toEqual([{ day: "2026-10-03", tag: "sauna", value: 0 }]);
    expect(await saveJournalEntry(store, { day: "2026-10-04", tag: "alcohol", value: null })).toMatchObject({ ok: false });
  });

  it("keeps a follow-up answer only with a yes", async () => {
    await saveJournalEntry(store, { day: "2026-10-03", tag: "alcohol", value: true, detail: 3 });
    await saveJournalEntry(store, { day: "2026-09-01", tag: "alcohol", value: false, detail: 3 });
    const detail = async (day: string) => (await store.journal.entriesBetween(day, day)).find((e) => e.tag === "alcohol")?.detail;
    expect(await detail("2026-10-03")).toBe(3);
    expect(await detail("2026-09-01")).toBeNull();
    expect(await saveJournalEntry(store, { day: "2026-10-03", tag: "alcohol", value: true, detail: 2000 })).toMatchObject({ ok: false });
    const r = await loadCheckIn(store, "2026-10-03");
    expect(r.ok && r.data.checkIn.details).toEqual({ alcohol: 3 });
  });
});

describe("saveCheckIn", () => {
  it("writes every answer and the note, and tells the screens once", async () => {
    const r = await saveCheckIn(store, "2026-10-03", [{ tag: "alcohol", value: true, detail: 2 }, { tag: "sauna", value: false }], "  Late night ");
    expect(r).toEqual({ ok: true, data: undefined });
    expect(await answers("2026-10-03", "2026-10-03")).toEqual([{ day: "2026-10-03", tag: "alcohol", value: 1 }, { day: "2026-10-03", tag: "sauna", value: 0 }]);
    expect(await store.journal.noteOn("2026-10-03")).toBe("Late night");
    expect(h.changed).toHaveBeenCalledTimes(1);
    await saveCheckIn(store, "2026-10-03", [], "");
    expect(await store.journal.noteOn("2026-10-03")).toBeNull();
  });

  it("stops at the first answer that fails, keeps what was written, and still tells the screens", async () => {
    const r = await saveCheckIn(store, "2026-10-03", [{ tag: "alcohol", value: true }, { tag: "nope", value: true }, { tag: "sauna", value: true }], "A note");
    expect(r).toEqual({ ok: false, error: "Unknown tag: nope" });
    expect(await answers("2026-10-03", "2026-10-03")).toEqual([{ day: "2026-10-03", tag: "alcohol", value: 1 }]);
    expect(await store.journal.noteOn("2026-10-03")).toBeNull();
    expect(h.changed).toHaveBeenCalledTimes(1);
  });

  it("with nothing to write it writes and announces nothing", async () => {
    expect(await saveCheckIn(store, "2026-10-03", [], null)).toEqual({ ok: true, data: undefined });
    expect(h.changed).not.toHaveBeenCalled();
  });
});

describe("loadCheckIn", () => {
  it("returns the shown behaviours and the day's answers; refuses a future day and a bad day", async () => {
    await saveJournalEntry(store, { day: "2026-10-03", tag: "alcohol", value: true });
    const r = await loadCheckIn(store, "2026-10-03");
    expect(r.ok && r.data.checkIn).toMatchObject({ done: true, entries: { alcohol: 1 } });
    expect(r.ok && r.data.tags.some((t) => t.tag === "alcohol")).toBe(true);
    expect(r.ok && r.data.strip.at(-1)).toEqual({ day: "2026-10-03", done: true });
    expect(await loadCheckIn(store, "2026-10-04")).toMatchObject({ ok: false });
    expect(await loadCheckIn(store, "nope")).toMatchObject({ ok: false });
    // Too far back: the sheet's day strip would run from that day to today.
    expect(await loadCheckIn(store, "2010-01-01")).toMatchObject({ ok: false });
  });
});

describe("saveJournalNote", () => {
  it("saves, replaces and clears a day's note, never for a future day", async () => {
    expect(await saveJournalNote(store, { day: "2026-10-03", text: "  Slept at a friend's  " })).toEqual({ ok: true, data: undefined });
    await saveJournalNote(store, { day: "2026-10-03", text: "Slept badly" });
    expect(await store.journal.noteOn("2026-10-03")).toBe("Slept badly");
    const r = await loadCheckIn(store, "2026-10-03");
    expect(r.ok && r.data.checkIn.note).toBe("Slept badly");
    expect(await saveJournalNote(store, { day: "2026-10-04", text: "Later" })).toMatchObject({ ok: false });
    expect((await saveJournalNote(store, { day: "2026-10-03", text: "x".repeat(2001) })).ok).toBe(false);
    await saveJournalNote(store, { day: "2026-10-03", text: "   " });
    expect(await store.journal.noteOn("2026-10-03")).toBeNull();
  });
});

describe("addCustomTag", () => {
  it("validates the label and rejects duplicates", async () => {
    expect(await addCustomTag(store, { label: "  Late  Workout! " })).toEqual({ ok: true, data: { tag: "late_workout" } });
    expect(await addCustomTag(store, { label: "late workout" })).toEqual({ ok: false, error: "Tag already exists: late_workout" });
    expect(await addCustomTag(store, { label: "Alcohol" })).toMatchObject({ ok: false });
    expect((await addCustomTag(store, { label: "   " })).ok).toBe(false);
    expect((await addCustomTag(store, { label: "!!!" })).ok).toBe(false);
    expect((await addCustomTag(store, { label: "x".repeat(41) })).ok).toBe(false);
    expect(await saveJournalEntry(store, { day: "2026-10-03", tag: "late_workout", value: true })).toMatchObject({ ok: true });
  });

  it("puts a new behaviour after every existing one", async () => {
    const before = (await store.journal.tags()).filter((t) => !t.isDefault).map((t) => t.tag);
    await addCustomTag(store, { label: "Nap" });
    expect((await store.journal.tags()).filter((t) => !t.isDefault).map((t) => t.tag)).toEqual([...before, "nap"]);
  });

  it("stops at MAX_TAGS, so insights work per recompute stays bounded", async () => {
    const have = (await store.journal.tags()).length;
    for (let i = have; i < MAX_TAGS; i++) expect((await addCustomTag(store, { label: `Cap ${i}` })).ok).toBe(true);
    expect(await addCustomTag(store, { label: "One more" })).toEqual({ ok: false, error: `Too many behaviours: the limit is ${MAX_TAGS}` });
  });

  it("tagKey turns a label into snake_case", () => {
    expect(tagKey("Cold plunge")).toBe("cold_plunge");
    expect(tagKey("  --Hi!! ")).toBe("hi");
    expect(tagKey("???")).toBe("");
  });
});
