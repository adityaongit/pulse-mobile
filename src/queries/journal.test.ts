// Ported from pulse src/server/queries/home.test.ts (the Journal Insights case) and isolation.test.ts (getJournal on a
// spread of days), onto the F2 seed scored on SQLite.
import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "../time";
import { todayOf, type QueryCtx } from "./common";
import { getBehaviours, getJournal, getJournalInsights } from "./journal";
import { seededCtx } from "./testing";

// The seed loads answers but not the behaviours' rows: the nine defaults the F2 answers use.
const TAGS = [
  { tag: "alcohol", label: "Alcohol" },
  { tag: "late_caffeine", label: "Late caffeine" },
  { tag: "late_meal", label: "Late meal" },
  { tag: "screen_in_bed", label: "Screen in bed" },
  { tag: "meditation", label: "Meditation" },
  { tag: "stretching", label: "Stretching" },
  { tag: "sauna", label: "Sauna" },
  { tag: "travel", label: "Travel" },
  { tag: "illness", label: "Illness" },
];

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
  await ctx.store.journal.ensureDefaultTags(TAGS);
});

describe("getJournal", () => {
  it("builds the 30-day strip ending today, the day's answers and its labelled yes list", async () => {
    const today = todayOf(ctx);
    const vm = await getJournal(ctx, today);
    expect(vm.day).toBe(today);
    expect(vm.strip).toHaveLength(30);
    expect(vm.strip[0].day).toBe(addDays(today, -29));
    expect(vm.strip.at(-1)!.day).toBe(today);
    const answers = await ctx.store.journal.entriesBetween(addDays(today, -29), today);
    expect(vm.strip.map((s) => s.done)).toEqual(vm.strip.map((s) => answers.some((a) => a.day === s.day)));
    const mine = answers.filter((a) => a.day === today);
    expect(vm.checkIn.done).toBe(mine.length > 0);
    expect(vm.checkIn.entries).toEqual(Object.fromEntries(mine.map((a) => [a.tag, a.value])));
    expect(vm.checkIn.yes.map((y) => y.tag).sort()).toEqual(mine.filter((a) => a.value > 0).map((a) => a.tag).sort());
    expect(vm.tags.map((t) => t.tag)).toEqual(TAGS.map((t) => t.tag));
    expect(vm.tags.find((t) => t.tag === "alcohol")).toMatchObject({ question: "Had any alcohol?", section: "nighttime", isDefault: true, hidden: false });
  });

  it("history lists the days with answers, newest first, each with its yes labels", async () => {
    const today = todayOf(ctx);
    const vm = await getJournal(ctx, today);
    expect(vm.history.length).toBeGreaterThan(0);
    expect(vm.history.map((h) => h.day)).toEqual([...vm.history.map((h) => h.day)].sort().reverse());
    const day = vm.history[0].day;
    const yes = (await ctx.store.journal.entriesBetween(day, day)).filter((a) => a.value > 0).map((a) => TAGS.find((t) => t.tag === a.tag)!.label);
    expect(vm.history[0].yes).toEqual(yes);
  });

  it("a day further back than the strip's 30 days extends the strip to reach it", async () => {
    const today = todayOf(ctx);
    const vm = await getJournal(ctx, "2026-07-01");
    expect(vm.strip[0].day).toBe("2026-07-01");
    expect(vm.strip.at(-1)!.day).toBe(today);
    expect(vm.history.every((h) => h.day >= addDays(today, -29))).toBe(true);
  });

  it("the teaser names the strongest effect on next-day Recovery", async () => {
    const vm = await getJournal(ctx, todayOf(ctx));
    expect(vm.teaser.ready).toBe(true);
    expect(vm.teaser.text).toMatch(/^Your strongest effect so far: .+ (lowers|raises) next-day Recovery by \d+%\.$/);
  });

  it("a hidden behaviour leaves the check-in but its answers still label History; the day's note is returned", async () => {
    const day = "2026-09-20";
    await ctx.store.journal.saveEntry({ day, tag: "sauna", value: 1, detail: null });
    await ctx.store.journal.showOnly(TAGS.map((t) => t.tag).filter((t) => t !== "sauna"));
    await ctx.store.journal.saveNote(day, "Slept at a friend's");
    const vm = await getJournal(ctx, day);
    expect(vm.tags.some((t) => t.tag === "sauna")).toBe(false);
    expect(vm.checkIn.note).toBe("Slept at a friend's");
    expect(vm.checkIn.yes.map((y) => y.label)).toContain("Sauna");
    expect((await getBehaviours(ctx)).tags.find((t) => t.tag === "sauna")).toMatchObject({ hidden: true, section: "daytime" });
    await ctx.store.journal.showOnly(TAGS.map((t) => t.tag));
  });

  it("a custom behaviour sits under custom, its label asked as a question", async () => {
    expect(await ctx.store.journal.addTag("cold_plunge", "Cold plunge", 60)).toBe("added");
    const tag = (await getJournal(ctx, todayOf(ctx))).tags.find((t) => t.tag === "cold_plunge");
    expect(tag).toMatchObject({ section: "custom", question: "Cold plunge?", isDefault: false });
  });
});

describe("getJournalInsights", () => {
  it("shows the seeded alcohol effect as negative, with days with and without", async () => {
    const vm = await getJournalInsights(ctx, "recovery");
    expect(vm.unit).toBe("%");
    const alcohol = vm.items.find((x) => x.key === "alcohol");
    expect(alcohol?.effect).toBe("negative");
    expect(alcohol!.avgWith!).toBeLessThan(alcohol!.avgWithout!);
    expect(alcohol!.yes).toBeGreaterThan(0);
    expect(alcohol!.no).toBeGreaterThan(0);
  });

  it("ranks by the size of the effect, and HRV is in SD", async () => {
    for (const m of ["recovery", "hrv", "sleep"] as const) {
      const vm = await getJournalInsights(ctx, m);
      expect(vm.metric).toBe(m);
      const sizes = vm.items.map((i) => Math.abs(i.delta));
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
      for (const i of vm.items) expect(Number.isFinite(i.delta) && i.ci!.every(Number.isFinite)).toBe(true);
    }
    expect((await getJournalInsights(ctx, "hrv")).unit).toBe("SD");
  });

  it("a behaviour without 5 days with and 5 without waits under needsMore, labelled", async () => {
    const vm = await getJournalInsights(ctx, "recovery");
    for (const n of vm.needsMore) expect(Math.min(n.yes, n.no)).toBeLessThan(5);
    const all = [...vm.items.map((i) => i.key), ...vm.needsMore.map((n) => n.key)];
    expect(new Set(all).size).toBe(all.length);
  });
});
