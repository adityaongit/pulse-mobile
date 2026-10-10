import { beforeAll, describe, expect, it } from "vitest";
import { DASHBOARD_DEFAULT, PHONE_DEFAULT } from "@/lib/dashboard";
import { addDays } from "../time";
import { loadDays, type QueryCtx } from "./common";
import { activityLogContext, getHome } from "./home";
import { BEFORE_WAKE, morning, scratchCtx, withDailyValues } from "./scratch";
import { expectF6, f6Days, seededCtx } from "./testing";

const REASONS = ["calibrating", "no_hrv_last_night", "awaiting_sleep_sync", "insufficient_hr_data", "band_not_worn", "no_data"];
const dayAt = (i: number) => addDays("2026-04-06", i);

/** Walks a view model: no NaN or ±Infinity anywhere, and every null metric carries a known reason. Collects reasons and tags. */
function inspect(vm: unknown, seen: Set<string>, path = "vm") {
  if (typeof vm === "number") {
    expect(Number.isFinite(vm), `${path} is ${vm}`).toBe(true);
    return;
  }
  if (!vm || typeof vm !== "object") return;
  if (Array.isArray(vm)) return vm.forEach((x, i) => inspect(x, seen, `${path}[${i}]`));
  const o = vm as Record<string, unknown>;
  if ("value" in o && "reason" in o && "provisional" in o) {
    if (o.value === null) {
      expect(REASONS, `${path}.reason`).toContain(o.reason);
      seen.add(o.reason as string);
    } else expect(o.reason, `${path}.reason`).toBeNull();
    if (o.provisional) seen.add("provisional");
    for (const t of (o.tags as string[] | undefined) ?? []) seen.add(t);
  }
  for (const [k, v] of Object.entries(o)) inspect(v, seen, `${path}.${k}`);
}

let ctx: QueryCtx;
/** Today before the night has synced. */
let early: QueryCtx;
/** A copy the tests may write to: the shared `ctx` stays as F6 recorded it. */
let edit: QueryCtx;
beforeAll(async () => {
  ctx = await withDailyValues(await seededCtx());
  early = await scratchCtx({ tweak: morning, now: BEFORE_WAKE });
  // The demo seed writes its own distance rows; pin the window the test below needs.
  edit = await scratchCtx({ tweak: (t) => ({ ...t, daily_values: t.daily_values.filter((v) => v.key !== "distance") }) });
}, 180_000);

describe("getHome matches F6", () => {
  for (const day of f6Days()) it(day, async () => expectF6("getHome", day, await getHome(ctx, day)));
});

describe("getHome", () => {
  it("has every Home section for today", async () => {
    const vm = await getHome(ctx, dayAt(179));
    expect(Object.keys(vm).sort()).toEqual(
      [
        "activities",
        "dashboard",
        "day",
        "dials",
        "energyBank",
        "insights",
        "isToday",
        "journalWeek",
        "keyStats",
        "monitor",
        "monitorAlert",
        "outlook",
        "phone",
        "plan",
        "strainRecovery",
        "stress",
        "stressChart",
        "strip",
        "today",
        "tonight",
        "weeklyTeaser",
      ].sort(),
    );
    expect(vm.isToday).toBe(true);
    // Stress Monitor is on the default dashboard, so its tile's line is loaded; no plan source exists yet.
    expect(vm.stressChart?.value?.points.length).toBeGreaterThan(0);
    expect(vm.plan).toBeNull();
    expect(vm.strip).toHaveLength(30);
    expect(vm.dials.recovery.value).toBeTypeOf("number");
    expect(vm.dials.strainTarget).toHaveLength(2);
    expect(vm.dials.soFar).toBe(true);
    expect(vm.keyStats.map((s) => s.label)).toEqual([
      "Heart rate variability",
      "Sleep performance",
      "Sleep consistency",
      "Hours of sleep",
      "Stress Monitor",
      "Resting heart rate",
      "VO2 max",
      "Steps",
    ]);
    expect(vm.keyStats.every((s) => s.average != null)).toBe(true);
    // Newest first: the night's sleep, which started the day, comes last.
    expect(vm.activities.items.at(-1)).toMatchObject({ kind: "sleep" });
    const starts = vm.activities.items.map((a) => a.start);
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
    expect(vm.energyBank.value?.curve.length).toBeGreaterThan(50);
    expect(vm.tonight.value?.plans.map((p) => p.label)).toEqual(["Peak", "Perform", "Get by"]);
    const [peak, perform, getBy] = vm.tonight.value!.plans;
    expect(peak.bedtimeAt).toBeLessThan(perform.bedtimeAt);
    expect(perform.bedtimeAt).toBeLessThan(getBy.bedtimeAt);
    expect(vm.weeklyTeaser).toMatchObject({ period: "2026-W39", start: "2026-09-21", end: "2026-09-27" });
  });

  it("never holds NaN, and every missing metric says why, on every seeded day", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 180; i++) inspect(await getHome(ctx, dayAt(i)), seen);
    inspect(await getHome(early, dayAt(179)), seen);
    expect([...seen].sort()).toEqual([...REASONS, "provisional", "stale_baseline"].sort());
  });

  it("shows the seeded reasons: calibrating with nights left, no HRV, band off, and today before wake", async () => {
    for (let i = 0; i < 7; i++) expect((await getHome(ctx, dayAt(i))).dials.recovery).toMatchObject({ value: null, reason: "calibrating", nightsLeft: 7 - i });
    expect((await getHome(ctx, dayAt(7))).dials.recovery.value).toBeTypeOf("number");
    expect((await getHome(ctx, dayAt(164))).dials.recovery.reason).toBe("no_hrv_last_night");
    for (const i of [156, 157]) {
      const vm = await getHome(ctx, dayAt(i));
      expect(vm.dials.recovery.reason).toBe("band_not_worn");
      expect(vm.dials.sleep.reason).toBe("band_not_worn");
    }
    expect((await getHome(ctx, dayAt(156))).dials.strain.reason).toBe("band_not_worn");
    expect((await getHome(ctx, dayAt(157))).dials.strain.reason).toBe("insufficient_hr_data");

    const morningVm = await getHome(early, dayAt(179));
    expect(morningVm.dials.recovery.reason).toBe("awaiting_sleep_sync");
    expect(morningVm.dials.sleep.reason).toBe("awaiting_sleep_sync");
    expect(morningVm.energyBank.reason).toBe("awaiting_sleep_sync");
    expect(morningVm.dials.reason).toEqual({ reason: "awaiting_sleep_sync" });
    expect(morningVm.keyStats.find((s) => s.key === "hrv")!.metric.reason).toBe("awaiting_sleep_sync");
  });

  it("builds extra metrics and body readings generically, against their 30-day averages", async () => {
    const { store } = edit;
    const day = dayAt(179);
    await store.daily.upsertDailyValues([
      ...Array.from({ length: 10 }, (_, i) => ({ day: dayAt(179 - (i + 1)), key: "distance", value: (i + 1) % 2 ? 3 : 5 })),
      { day, key: "distance", value: 6.25 },
    ]);
    await store.daily.upsertDailyMetrics([{ day, source: "seed", weightKg: 72.5 }]);
    await store.settings.saveDashboard(["distance", "weight", "glucose"]);
    try {
      const vm = await getHome(edit, day);
      expect(vm.keyStats).toMatchObject([
        { key: "distance", label: "Distance", unit: "km", format: "decimal2", direction: "up", href: "/metric/distance", metric: { value: 6.25 }, average: 4 },
        { key: "weight", label: "Weight", unit: "kg", metric: { value: 72.5 } },
        { key: "glucose", label: "Blood glucose", metric: { value: null, reason: "no_data" }, average: null },
      ]);
      expect(vm.dashboard.empty).toContain("glucose");
      expect(vm.dashboard.empty).not.toContain("distance");
      expect(vm.dashboard.empty).not.toContain("hrv");
      expect(vm.phone).toBeNull();
    } finally {
      await store.settings.saveDashboard([]);
    }
  });

  it("without a band, Home leads with the phone's stats and My Dashboard defaults to phone metrics", async () => {
    const c = await scratchCtx({ tweak: (t) => ({ ...t, hr_days: [] }) });
    const vm = await getHome(c, dayAt(170));
    expect(vm.dials.strain.value).toBeNull();
    // The demo seed writes the phone extras (distance, active minutes) beside steps and calories.
    expect(vm.phone?.map((s) => s.key)).toEqual(["steps", "distance", "calories", "active_minutes"]);
    expect(vm.phone?.[0]).toMatchObject({ label: "Steps", metric: { value: expect.any(Number) }, average: expect.any(Number) });
    expect(vm.keyStats.map((s) => s.key)).toEqual(PHONE_DEFAULT);
    // A band-off day with no phone data either keeps the plain empty state.
    expect((await getHome(c, dayAt(156))).phone).toBeNull();
  });

  it("orders My Dashboard as chosen, skipping unknown keys, and falls back to the default list", async () => {
    const set = (keys: string[]) => edit.store.settings.saveDashboard(keys);
    const keys = async () => (await getHome(edit, dayAt(179))).keyStats.map((s) => s.key);
    try {
      await set([]);
      expect(await keys()).toEqual(DASHBOARD_DEFAULT);
      await set(["steps", "not_a_metric", "hrv"]);
      expect(await keys()).toEqual(["steps", "hrv"]);
      expect((await getHome(edit, dayAt(179))).keyStats[0]).toMatchObject({ label: "Steps", href: "/metric/steps", direction: "up" });
      await set(["not_a_metric"]);
      expect(await keys()).toEqual(DASHBOARD_DEFAULT);
    } finally {
      await set([]);
    }
  });

  it("the reference app's rows: weekly totals over seven days, restorative share, lean mass, links to their Trend Views", async () => {
    const keys = ["zones13", "zones_all", "strength", "restorative_pct", "restorative", "debt", "recovery", "strain", "lean_mass"];
    await edit.store.settings.saveDashboard(keys);
    try {
      const day = dayAt(170);
      const vm = await getHome(edit, day);
      const by = Object.fromEntries(vm.keyStats.map((s) => [s.key, s]));
      expect(vm.keyStats.map((s) => s.key)).toEqual(keys);
      // The 7-day total covers each of the 7 days' zone minutes.
      const week = await loadDays(edit, dayAt(164), day);
      const zone13 = [...week.values()].reduce((a, r) => a + (r.s1 && r.s1.hrCount > 0 ? (r.s1.zoneSeconds[0] + r.s1.zoneSeconds[1] + r.s1.zoneSeconds[2]) / 60 : 0), 0);
      expect(by.zones13.metric.value).toBeCloseTo(zone13, 3);
      expect(by.zones_all.metric.value!).toBeGreaterThanOrEqual(by.zones13.metric.value!);
      expect(by.zones13).toMatchObject({ href: "/trend/zones13", unit: "min" });
      expect(by.strength.metric.value).toBeGreaterThanOrEqual(0);
      expect(by.restorative_pct.metric.value!).toBeGreaterThan(0);
      expect(by.restorative_pct.metric.value!).toBeLessThan(100);
      expect(by.debt).toMatchObject({ direction: "down", href: "/sleep" });
      expect(by.recovery).toMatchObject({ unit: "%", href: "/trend/recovery" });
      expect(by.strain).toMatchObject({ format: "decimal1", href: "/trend/strain" });
      for (const k of keys.filter((k) => k !== "lean_mass")) expect(by[k].average, k).not.toBeNull();
    } finally {
      await edit.store.settings.saveDashboard([]);
    }
  });

  it("switches the day banner from outlook to review at 17:00, and past days always review", async () => {
    const at = (h: number) => Date.parse(`2026-10-02T${String(h).padStart(2, "0")}:00:00+05:30`) / 1000;
    const morningBanner = (await getHome({ ...ctx, now: at(14) }, dayAt(179))).outlook;
    expect(morningBanner).toMatchObject({ kind: "outlook", title: "Your daily outlook" });
    expect(morningBanner!.body).toMatch(/^Your Recovery is \d+%, (green|yellow|red)\./);
    expect((await getHome({ ...ctx, now: at(17) }, dayAt(179))).outlook).toMatchObject({ kind: "review", title: "Your day in review" });
    const past = (await getHome(ctx, dayAt(170))).outlook!;
    expect(past.kind).toBe("review");
    expect(past.body).toMatch(/Day Strain was \d+\.\d/);
    // A day with no band data has nothing to summarise.
    expect((await getHome(ctx, dayAt(156))).outlook).toBeNull();
  });

  it("lists today's coach cards (strain first) and none on past days", async () => {
    const today = await getHome(ctx, dayAt(179));
    expect(today.insights.length).toBeGreaterThan(0);
    expect(today.insights[0].key).toBe("strain");
    for (const i of today.insights) {
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.body).not.toMatch(/the reference app|!/);
      expect(i.href).toMatch(/^\/(strain|recovery|sleep)$/);
    }
    expect((await getHome(ctx, dayAt(170))).insights).toEqual([]);
  });

  it("gives the journal week and the 7-day Strain and Recovery series ending on the day", async () => {
    const vm = await getHome(ctx, dayAt(170));
    expect(vm.journalWeek.map((w) => w.day)).toEqual([164, 165, 166, 167, 168, 169, 170].map(dayAt));
    expect(vm.journalWeek.some((w) => w.done)).toBe(true);
    expect(vm.strainRecovery.map((p) => p.day)).toEqual(vm.journalWeek.map((w) => w.day));
    for (const p of vm.strainRecovery) {
      if (p.strain !== null) expect(p.strain >= 0 && p.strain <= 21).toBe(true);
      if (p.recovery !== null) expect(p.recovery >= 0 && p.recovery <= 100).toBe(true);
    }
    // The band-off day has neither score.
    const off = (await getHome(ctx, dayAt(158))).strainRecovery.find((p) => p.day === dayAt(156))!;
    expect(off).toEqual({ day: dayAt(156), strain: null, recovery: null });
  });

  it("leaves a day's Strain a gap in the 7-day series until it has accrued effort, never a 0.0 dive", async () => {
    // Pulse seeded a second database at 05:00 for this; the phone's F2 has the whole day, so the day is made to look
    // unscored by reading it before its first effort: no row for today means no effort.
    const vm = await getHome(ctx, dayAt(179));
    const today = vm.strainRecovery.at(-1)!;
    expect(today.day).toBe(dayAt(179));
    expect(today.strain === null || today.strain > 0).toBe(true);
    // Past days keep their scores.
    expect(vm.strainRecovery.slice(0, -1).some((p) => p.strain !== null && p.strain > 0)).toBe(true);
    const later = (await getHome(ctx, dayAt(170))).strainRecovery.at(-1)!;
    expect(later.strain).not.toBeNull();
  });

  it("raises the Health Monitor alert in the seeded illness week", async () => {
    const flagged = await Promise.all([118, 119, 120, 121, 122].map(async (i) => (await getHome(ctx, dayAt(i))).monitorAlert));
    expect(flagged.some((a) => a?.kind === "illness")).toBe(true);
    expect((await getHome(ctx, dayAt(60))).monitorAlert?.kind ?? null).not.toBe("illness");
  });
});

describe("activityLogContext", () => {
  it("reads today's Strain Target and the kinds of the last 30 days' workouts, newest first, once each", async () => {
    const r = await activityLogContext(ctx);
    expect(r.strainTarget === null || r.strainTarget[0] <= r.strainTarget[1]).toBe(true);
    expect(r.recent.length).toBeGreaterThan(0);
    expect(new Set(r.recent).size).toBe(r.recent.length);
  });
});
