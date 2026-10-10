// From pulse's (app)/journal/CheckIn.test.tsx: `changedEntries`, and the heading the sheet asks. The sheet itself
// (opening, saving, Dismiss journal?, moving between days) is the owner's check on the phone.
import { describe, expect, it } from "vitest";
import { changedEntries, heading } from "./checkin";

describe("changedEntries", () => {
  it("sends changed answers and follow-ups, and null for a cleared saved answer", () => {
    expect(changedEntries({ alcohol: undefined, sauna: 0, travel: 1, illness: 1, caffeine: 1 }, { caffeine: 600 }, { alcohol: 1, sauna: 1, illness: 1, caffeine: 1 }, {})).toEqual([
      { tag: "alcohol", value: null, detail: null },
      { tag: "sauna", value: false, detail: null },
      { tag: "travel", value: true, detail: null },
      { tag: "caffeine", value: true, detail: 600 },
    ]);
  });

  it("an unsaved pick cleared again sends nothing; a follow-up on a no is ignored", () => {
    expect(changedEntries({ alcohol: undefined }, {}, {}, {})).toEqual([]);
    expect(changedEntries({ alcohol: 0 }, { alcohol: 3 }, { alcohol: 0 }, {})).toEqual([]);
  });

  it("a moved follow-up on a saved yes is sent with it; an unchanged one is not", () => {
    expect(changedEntries({ alcohol: 1 }, { alcohol: 4 }, { alcohol: 1 }, { alcohol: 3 })).toEqual([{ tag: "alcohol", value: true, detail: 4 }]);
    expect(changedEntries({ alcohol: 1 }, { alcohol: 3 }, { alcohol: 1 }, { alcohol: 3 })).toEqual([]);
  });
});

describe("heading", () => {
  it("asks about today, or about a past day by its weekday", () => {
    expect(heading("2026-10-08", "2026-10-08")).toBe("What’s happening today, October 8?");
    expect(heading("2026-10-02", "2026-10-08")).toBe("What happened on Friday, October 2?");
  });
});
