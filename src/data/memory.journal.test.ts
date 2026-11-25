// The Store's journal-tag and logged-entry methods, on the in-memory store (db.ts mirrors them in SQL).
import { describe, expect, it } from "vitest";
import { openMemoryStore } from "./memory";
import type { JournalTagRow, LoggedEntryRow } from "./store";

const tag = (t: string, o: Partial<JournalTagRow> = {}): JournalTagRow => ({ tag: t, label: t, isDefault: false, hidden: false, removed: false, position: 0, ...o });
const entry = (id: string, ts: number, createdAt = ts, o: Partial<LoggedEntryRow> = {}): LoggedEntryRow => ({
  id,
  type: "hydration-log",
  ts,
  day: "2026-10-02",
  data: { ml: 250 },
  createdAt,
  source: "pulse",
  ...o,
});

describe("journal tags", () => {
  it("inserts new tags only, and lists them by position then insertion order", async () => {
    const s = openMemoryStore();
    expect(await s.insertJournalTags([tag("b"), tag("a"), tag("c", { position: 2 })])).toEqual(["b", "a", "c"]);
    // An existing key is left alone, label and all.
    expect(await s.insertJournalTags([tag("a", { label: "Changed" }), tag("d", { position: 1 })])).toEqual(["d"]);
    const rows = await s.journalTags();
    expect(rows.map((r) => r.tag)).toEqual(["b", "a", "d", "c"]);
    expect(rows.find((r) => r.tag === "a")).toEqual(tag("a"));
  });

  it("updates hidden and position, skipping unknown tags", async () => {
    const s = openMemoryStore();
    await s.insertJournalTags([tag("a"), tag("b"), tag("c")]);
    await s.updateJournalTags([{ tag: "c", position: 0 }, { tag: "a", position: 1 }, { tag: "b", position: 2, hidden: true }, { tag: "nope", hidden: true }]);
    const rows = await s.journalTags();
    expect(rows.map((r) => [r.tag, r.position, r.hidden])).toEqual([
      ["c", 0, false],
      ["a", 1, false],
      ["b", 2, true],
    ]);
  });

  it("returns copies, and clearAll drops them", async () => {
    const s = openMemoryStore();
    await s.insertJournalTags([tag("a")]);
    (await s.journalTags())[0].hidden = true;
    expect((await s.journalTags())[0].hidden).toBe(false);
    await s.clearAll();
    expect(await s.journalTags()).toEqual([]);
  });
});

describe("logged entries", () => {
  it("lists entries from a time, newest first (ts, then created), up to a limit", async () => {
    const s = openMemoryStore();
    await s.addLoggedEntries([entry("a", 100), entry("b", 200, 200), entry("c", 200, 300), entry("d", 50)]);
    expect((await s.loggedEntries(100)).map((e) => e.id)).toEqual(["c", "b", "a"]);
    expect((await s.loggedEntries(0, 2)).map((e) => e.id)).toEqual(["c", "b"]);
    expect((await s.loggedEntries(0))[0]).toEqual(entry("c", 200, 300));
  });

  it("deletes one entry and returns it; an unknown id returns null", async () => {
    const s = openMemoryStore();
    await s.addLoggedEntries([entry("a", 100, 100, { type: "moods", data: { moods: ["CALM"], valence: null } })]);
    expect(await s.deleteLoggedEntry("a")).toMatchObject({ id: "a", type: "moods", data: { moods: ["CALM"], valence: null } });
    expect(await s.deleteLoggedEntry("a")).toBeNull();
    expect(await s.loggedEntries(0)).toEqual([]);
  });

  it("clearAll drops them", async () => {
    const s = openMemoryStore();
    await s.addLoggedEntries([entry("a", 100)]);
    await s.clearAll();
    expect(await s.loggedEntries(0)).toEqual([]);
  });

  it("replaces the Health Connect entries of a day range, leaving Pulse's own and other days' alone", async () => {
    const s = openMemoryStore();
    const hc = (id: string, ts: number, day: string) => entry(id, ts, ts, { day, source: "health_connect" });
    await s.addLoggedEntries([entry("mine", 100)]);
    await s.replaceExternalEntries({ from: "2026-10-01", to: "2026-10-02" }, [hc("x", 200, "2026-10-02"), hc("old", 10, "2026-09-30")]);
    expect((await s.loggedEntries(0)).map((e) => [e.id, e.source])).toEqual([
      ["x", "health_connect"],
      ["mine", "pulse"],
      ["old", "health_connect"],
    ]);
    // A re-read of the range: x is gone from the source, y arrived; the row outside the range stays.
    await s.replaceExternalEntries({ from: "2026-10-01", to: "2026-10-02" }, [hc("y", 300, "2026-10-01")]);
    expect((await s.loggedEntries(0)).map((e) => e.id)).toEqual(["y", "mine", "old"]);
    // Whatever a row says, what the sync writes is from Health Connect.
    await s.replaceExternalEntries({ from: "2026-10-01", to: "2026-10-02" }, [entry("z", 400, 400, { day: "2026-10-01" })]);
    expect((await s.loggedEntries(0)).map((e) => [e.id, e.source])).toEqual([
      ["z", "health_connect"],
      ["mine", "pulse"],
      ["old", "health_connect"],
    ]);
  });
});
