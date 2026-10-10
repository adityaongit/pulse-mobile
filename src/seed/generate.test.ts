// Ported from pulse src/server/sources/seed/generate.test.ts. The generator's assertions read the same tables through
// SQLite (the raw better-sqlite3 handle for rows, the samples repository for heart rate and steps). Pulse's tests of
// incremental pulls, other users and ensureDemoUser have no counterpart here: one fresh seed per install, no accounts.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "../data/testing";
import { generateDay, localMidnight, writeDays } from "./generate";
import { DEFAULT_JOURNAL_TAGS, SCENARIO, SEED_DAYS } from "./scenario";

vi.mock("../screens/useScreen", () => ({ dataChanged: vi.fn() }));

const TZ = "Asia/Kolkata"; // no DST, so day i starts at ANCHOR_START + i * DAY
const MAX_HR = 183;
const HOUR = 3600;
const DAY = 86_400;
/** Friday 14:00, after wake. The seeded range then starts on Monday 2026-04-06. */
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const TODAY = "2026-10-02";
const ANCHOR = "2026-04-06";
const ANCHOR_START = localMidnight(ANCHOR, TZ);
const TODAY_I = SEED_DAYS - 1;
const dayAt = (i: number) => new Date(Date.parse(ANCHOR) + i * DAY * 1000).toISOString().slice(0, 10);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k);
const FAR = 4_000_000_000;

/** The generator and its writer, without the pipeline: what pulse's `seedPull` did (and the dirty marks stay). */
async function seed() {
  const t = testDb();
  await t.store.journal.ensureDefaultTags([...DEFAULT_JOURNAL_TAGS]);
  const ctx = { anchor: ANCHOR, timeZone: TZ, maxHr: MAX_HR };
  for (let i = 0; i < SEED_DAYS; i += 30) {
    await writeDays(t.store, Array.from({ length: Math.min(30, SEED_DAYS - i) }, (_, k) => generateDay(ctx, i + k)), NOW);
  }
  return t;
}

let sqlite: ReturnType<typeof testDb>["sqlite"];
let store: ReturnType<typeof testDb>["store"];
const rows = <T>(q: string, ...args: unknown[]) => sqlite.prepare(q).all(...args) as T[];
const row = (q: string, ...args: unknown[]) => sqlite.prepare(q).get(...args) as Record<string, unknown> | undefined;
const value = <T>(q: string, ...args: unknown[]) => Object.values(row(q, ...args) ?? {})[0] as T;

const indexOf = (day: string) => Math.round((Date.parse(day) - Date.parse(ANCHOR)) / DAY / 1000);
const clampZone = (z: number) => Math.min(5, Math.max(0, z));

/** sha256 of every table's rows in column order. */
function checksums(db: typeof sqlite) {
  const tables = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_%' escape '\\' order by name").all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => {
      const h = createHash("sha256");
      for (const r of db.prepare(`select * from "${name}" order by ${Array.from({ length: db.prepare(`select * from "${name}"`).columns().length }, (_, k) => k + 1)}`).iterate()) h.update(JSON.stringify(r));
      return [name, h.digest("hex")];
    }),
  );
}

type Metrics = { day: string; hrv_ms: number | null; rhr_bpm: number | null; resp_bpm: number | null; nightly_temp_c: number | null; spo2_pct: number | null; steps: number | null };
type Session = { id: string; day: string; start_ts: number; end_ts: number; is_main: number; stages_status: string | null; asleep_min: number; awake_min: number; deep_min: number; light_min: number; rem_min: number };
const METRICS = "select day, hrv_ms, rhr_bpm, resp_bpm, nightly_temp_c, spo2_pct, steps from daily_metrics";
const SESSIONS = "select id, day, start_ts, end_ts, is_main, stages_status, asleep_min, awake_min, deep_min, light_min, rem_min from sleep_sessions";

let seedSeconds = 0;
let metrics: Map<number, Metrics>;
let mainSleep: Map<number, Session>;
let hr: { ts: number; v: number }[];
const hrIn = (i: number) => hr.filter((s) => s.ts >= ANCHOR_START + i * DAY && s.ts < ANCHOR_START + (i + 1) * DAY);
const hrCount = (i: number) => hrIn(i).length;
beforeAll(async () => {
  const t0 = performance.now();
  ({ sqlite, store } = await seed());
  seedSeconds = (performance.now() - t0) / 1000;
  hr = await store.samples.readSamples("hr", 0, FAR);
  metrics = new Map(rows<Metrics>(METRICS).map((m) => [indexOf(m.day), m]));
  mainSleep = new Map(rows<Session>(`${SESSIONS} where is_main`).map((s) => [indexOf(s.day), s]));
}, 60_000);

describe("a fresh seed", () => {
  it(`fills ${SEED_DAYS} local days ending today, within a few seconds`, () => {
    expect([...metrics.keys()].sort((a, b) => a - b)).toEqual(range(0, TODAY_I));
    expect(metrics.get(TODAY_I)!.day).toBe(TODAY);
    expect(seedSeconds).toBeLessThan(20);
  });

  it("writes HR every 15 s on the local-day grid, a full day being 5760 readings", () => {
    expect(hr.filter((s) => s.ts % 15 !== 0)).toHaveLength(0);
    expect(hrCount(100)).toBe(5760);
    expect(hr.at(-1)!.ts).toBeLessThan(NOW);
    expect(hr.every((s) => s.v >= 38 && s.v <= MAX_HR)).toBe(true);
  });

  it("marks every day with HR or steps intraday_dirty", () => {
    const dirty = rows<{ day: string }>("select day from intraday_dirty order by day").map((r) => indexOf(r.day));
    expect(dirty).toEqual(range(0, TODAY_I).filter((i) => i !== 156));
  });

  it("seeds the default journal tags and a check-in on most past days, none today", () => {
    expect(rows("select tag, label, is_default as d from journal_tags order by tag")).toEqual(
      DEFAULT_JOURNAL_TAGS.map(({ tag, label }) => ({ tag, label, d: 1 })).sort((a, b) => (a.tag < b.tag ? -1 : 1)),
    );
    const perDay = rows<{ day: string; n: number }>("select day, count(*) n from journal_entries group by day");
    expect(perDay.every((d) => d.n === DEFAULT_JOURNAL_TAGS.length)).toBe(true);
    expect(perDay.some((d) => d.day === TODAY)).toBe(false);
    expect(perDay.length).toBeGreaterThan(0.85 * TODAY_I);
    expect(perDay.length).toBeLessThan(TODAY_I);
  });

});

describe("reason coverage", () => {
  const staged = (i: number) => mainSleep.get(i)?.stages_status === "SUCCEEDED";

  it("calibrating: valid nights from day 0, so days 0–6 have fewer than 7 prior nights", () => {
    for (const i of range(0, SCENARIO.calibratingDays)) {
      expect(staged(i), `day ${i}`).toBe(true);
      expect(metrics.get(i)!.hrv_ms, `day ${i}`).not.toBeNull();
    }
  });

  it("no_hrv_last_night: exactly one staged night without HRV", () => {
    expect(range(0, TODAY_I).filter((i) => staged(i) && metrics.get(i)!.hrv_ms === null)).toEqual([SCENARIO.noHrvNight]);
  });

  it("band_not_worn: two past days without sleep, one of them without any HR", () => {
    expect(range(0, TODAY_I).filter((i) => !mainSleep.has(i))).toEqual([156, 157]);
    expect(hrCount(156)).toBe(0);
    expect(metrics.get(156)!.steps).toBeNull();
  });

  it("insufficient_hr_data: the band goes back on minutes before midnight (under 600 readings spanning under 600 s)", () => {
    const ts = hrIn(157).map((s) => s.ts);
    const n = ts.length;
    const spanS = ts.at(-1)! - ts[0];
    expect(n).toBeGreaterThanOrEqual(20);
    expect(n).toBeLessThan(600);
    expect(spanS).toBeLessThan(600);
  });

  it("stale_baseline: skin temperature is missing for the first 3 nights and 15 nights in a row later", () => {
    const missing = range(0, TODAY_I).filter((i) => mainSleep.has(i) && metrics.get(i)!.nightly_temp_c === null);
    expect(missing).toEqual([...range(0, 2), ...range(SCENARIO.skinTempGap.start, SCENARIO.skinTempGap.end)]);
  });
});

describe("scenario", () => {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const field = (k: keyof Metrics, days: number[]) => days.map((i) => metrics.get(i)![k] as number).filter((v) => v !== null);

  it("illness week: HRV down, RHR, respiration and temperature up, SpO2 under 95 at the peak", () => {
    const before = range(104, 117);
    const peak = range(119, 121);
    expect(mean(field("hrv_ms", peak)) / mean(field("hrv_ms", before))).toBeLessThan(0.85);
    expect(mean(field("rhr_bpm", peak)) - mean(field("rhr_bpm", before))).toBeGreaterThan(4);
    expect(mean(field("resp_bpm", peak)) - mean(field("resp_bpm", before))).toBeGreaterThan(1);
    expect(mean(field("nightly_temp_c", peak)) - mean(field("nightly_temp_c", before))).toBeGreaterThan(0.4);
    expect(Math.max(...field("spo2_pct", peak))).toBeLessThan(95);
    const ill = (rows<{ day: string }>("select day from journal_entries where tag = 'illness' and value = 1")).map((r) => indexOf(r.day));
    expect(ill.every((i) => i >= SCENARIO.illness.start && i <= SCENARIO.illness.end)).toBe(true);
    expect(value("select count(*) from exercises where day between ? and ?", dayAt(118), dayAt(125))).toBe(0);
  });

  it("training block: Edwards-effort ACWR (7 / 28 days) rises above 1.3, and not before", () => {
    const trimp = new Array<number>(SEED_DAYS).fill(0);
    for (const { ts, v: bpm } of hr) {
      const i = Math.floor((ts - ANCHOR_START) / DAY);
      const rhr = metrics.get(i)!.rhr_bpm ?? 56;
      trimp[i] += (clampZone(Math.floor((10 * (bpm - rhr)) / (MAX_HR - rhr)) - 4) * 15) / 60;
    }
    const effort = trimp.map((t) => (100 * Math.log(t + 1)) / Math.log(7201));
    const avg = (from: number, to: number) => mean(effort.slice(from, to + 1));
    const acwr = (i: number) => avg(i - 6, i) / avg(i - 27, i);
    expect(Math.max(...range(SCENARIO.trainingBlock.start, SCENARIO.trainingBlock.end).map(acwr))).toBeGreaterThan(1.3);
    expect(Math.max(...range(28, SCENARIO.trainingBlock.start - 1).map(acwr))).toBeLessThan(1.3);
  });

  it("sleep debt: five nights under 6 h asleep after a normal fortnight", () => {
    const asleepH = (i: number) => mainSleep.get(i)!.asleep_min / 60;
    expect(range(SCENARIO.shortSleep.start, SCENARIO.shortSleep.end).every((i) => asleepH(i) < 6)).toBe(true);
    expect(mean(range(154, 167).filter((i) => mainSleep.has(i)).map(asleepH))).toBeGreaterThan(7);
  });

  it("alcohol lowers next-night HRV by about 12%", () => {
    const alcohol = new Set((rows<{ day: string }>("select day from journal_entries where tag = 'alcohol' and value = 1")).map((r) => indexOf(r.day)));
    const recorded = new Set((rows<{ day: string }>("select distinct day from journal_entries")).map((r) => indexOf(r.day)));
    const nextHrv = (yes: boolean) => [...recorded].filter((i) => alcohol.has(i) === yes).flatMap((i) => field("hrv_ms", [i + 1]));
    expect(alcohol.size).toBeGreaterThan(20);
    const ratio = mean(nextHrv(true)) / mean(nextHrv(false));
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(0.95);
  });

  it("workouts mix runs, rides and strength, with run VO2max, weekly daily VO2max and monthly weigh-ins", () => {
    const types = rows<{ type: string; n: number }>("select type, count(*) n from exercises group by type");
    expect(Object.fromEntries(types.map((t) => [t.type, t.n > 10]))).toMatchObject({ RUNNING: true, BIKING: true, STRENGTH_TRAINING: true });
    expect(value("select count(*) from daily_metrics where vo2max_run is not null")).toBe(value("select count(distinct day) from exercises where type = 'RUNNING'"));
    expect(value("select count(*) from daily_metrics where vo2max_daily is not null")).toBeGreaterThanOrEqual(24);
    expect(value("select count(*) from daily_metrics where weight_kg is not null and body_fat_pct is not null")).toBe(6);
  });

  it("naps: unstaged side sessions, more of them when ill or short on sleep", () => {
    const naps = (rows<Session>(`${SESSIONS} where not is_main`)).map((s) => ({ ...s, i: indexOf(s.day) }));
    expect(naps.length).toBeGreaterThan(5);
    expect(naps.every((s) => s.stages_status === null && s.asleep_min > 0)).toBe(true);
    expect(value("select count(*) from sleep_segments where session_id like 'seed-nap-%'")).toBe(0);
    expect(naps.filter((s) => (s.i >= 118 && s.i <= 124) || (s.i >= 168 && s.i <= 172)).length).toBeGreaterThanOrEqual(5);
  });

  it("sleep sessions and workouts never overlap", () => {
    const spans = rows<{ s: number; e: number }>("select start_ts s, end_ts e from sleep_sessions union all select start_ts, end_ts from exercises order by 1");
    for (let k = 1; k < spans.length; k++) expect(spans[k].s).toBeGreaterThanOrEqual(spans[k - 1].e);
  });
});

describe("plausibility", () => {
  it("nightly metrics stay in physiological ranges", () => {
    const all = [...metrics.values()];
    const within = (k: keyof Metrics, lo: number, hi: number) =>
      expect(all.filter((m) => m[k] !== null && ((m[k] as number) < lo || (m[k] as number) > hi)), k).toEqual([]);
    within("hrv_ms", 20, 120);
    within("rhr_bpm", 45, 75);
    within("resp_bpm", 10, 22);
    within("spo2_pct", 90, 100);
    within("nightly_temp_c", 32, 37);
  });

  it("main sleeps last 4–10 h with stage shares in physiological ranges", () => {
    for (const s of mainSleep.values()) {
      const inBedH = (s.end_ts - s.start_ts) / HOUR;
      expect(inBedH, s.day).toBeGreaterThanOrEqual(4);
      expect(inBedH, s.day).toBeLessThanOrEqual(10);
      expect(s.asleep_min / 60, s.day).toBeGreaterThanOrEqual(4);
      expect(s.asleep_min + s.awake_min).toBe((s.end_ts - s.start_ts) / 60);
      expect(s.deep_min / s.asleep_min, `${s.day} deep`).toBeGreaterThan(0.1);
      expect(s.deep_min / s.asleep_min, `${s.day} deep`).toBeLessThan(0.3);
      expect(s.rem_min / s.asleep_min, `${s.day} rem`).toBeGreaterThan(0.12);
      expect(s.rem_min / s.asleep_min, `${s.day} rem`).toBeLessThan(0.32);
      expect(s.awake_min / (s.asleep_min + s.awake_min), `${s.day} awake`).toBeLessThan(0.2);
    }
  });

  it("segments tile each main sleep exactly", () => {
    const segs = rows<{ session_id: string; start_ts: number; end_ts: number }>("select * from sleep_segments order by session_id, start_ts");
    const bySession = Map.groupBy(segs, (g) => g.session_id);
    for (const s of mainSleep.values()) {
      const list = bySession.get(s.id)!;
      expect(list[0].start_ts).toBe(s.start_ts);
      expect(list.at(-1)!.end_ts).toBe(s.end_ts);
      for (let k = 1; k < list.length; k++) expect(list[k].start_ts).toBe(list[k - 1].end_ts);
    }
  });

  it("full worn days have 1k–30k steps (sick days are the low end)", () => {
    const full = [...metrics.entries()].filter(([i]) => i < TODAY_I && i !== 155 && i !== 156 && i !== 157);
    expect(full.filter(([, m]) => m.steps! < 1000 || m.steps! > 30_000).map(([i, m]) => [i, m.steps])).toEqual([]);
  });

  it("daily extras: activity roll-ups every worn day in Fitbit-like ranges, no nutrition, none on the band-off day", () => {
    const extras = new Map<string, Record<string, number>>();
    for (const r of rows<{ day: string; key: string; value: number }>("select day, key, value from daily_values")) extras.set(r.day, { ...extras.get(r.day), [r.key]: r.value });
    expect(extras.has(dayAt(156))).toBe(false);
    expect(value("select count(*) from daily_values where key in ('water', 'calories_in', 'protein', 'glucose', 'core_temp')")).toBe(0);
    for (const [i, m] of metrics) {
      const x = extras.get(dayAt(i))!;
      if (i === TODAY_I || (i >= 155 && i <= 157)) continue;
      const day = dayAt(i);
      // About 0.7-1.1 m a step, a Fitbit day's minutes add up to the waking day, and elevation follows floors.
      expect(x.distance / m.steps!, day).toBeGreaterThan(0.0007);
      expect(x.distance / m.steps!, day).toBeLessThan(0.0011);
      expect(x.floors, day).toBeLessThanOrEqual(30);
      expect(x.elevation, day).toBe(Math.round(x.floors * 3.05));
      expect(x.active_minutes + x.light_minutes + x.sedentary_minutes, day).toBeLessThanOrEqual(24 * 60);
      expect(x.sedentary_minutes, day).toBeGreaterThan(x.active_minutes);
      expect(x.azm, day).toBeGreaterThanOrEqual(0);
      expect(x.avg_hr, day).toBeGreaterThan(45);
      expect(x.avg_hr, day).toBeLessThan(100);
    }
    // Workout days earn Active Zone Minutes; rest days a few at most.
    const run = value<string>("select day from exercises where type = 'RUNNING' limit 1");
    expect(extras.get(run)!.azm).toBeGreaterThan(20);
  });
});

describe("HRV spread", () => {
  it("has a fitted EWMA spread above noop's 5 ms floor and reaches both tails", () => {
    const hrv = [...metrics.values()].sort((a, b) => a.day.localeCompare(b.day)).flatMap((m) => (m.hrv_ms === null ? [] : [m.hrv_ms]));
    const centreAlpha = 1 - 2 ** (-1 / 14);
    const spreadAlpha = 1 - 2 ** (-1 / 21);
    let centre = hrv[0];
    let spread = 5;
    const fitted: { spread: number; z: number }[] = [];
    for (const x of hrv.slice(1)) {
      fitted.push({ spread, z: (x - centre) / (1.253 * spread) });
      spread += spreadAlpha * (Math.abs(x - centre) - spread);
      centre += centreAlpha * (x - centre);
    }
    const settled = fitted.slice(30);
    const median = settled.map((f) => f.spread).sort((a, b) => a - b)[settled.length >> 1];
    expect(median).toBeGreaterThan(5);
    // Recovery is green above z ≈ +0.25 and red below z ≈ −0.65: both need real days.
    expect(settled.filter((f) => f.z > 0.5).length / settled.length).toBeGreaterThan(0.1);
    expect(settled.filter((f) => f.z < -0.8).length / settled.length).toBeGreaterThan(0.1);
  });
});


const ctx = { anchor: ANCHOR, timeZone: TZ, maxHr: MAX_HR };

describe("determinism", () => {
  it("generates a day identically twice, and different days differently", () => {
    expect(generateDay(ctx, 120)).toEqual(generateDay(ctx, 120));
    expect(generateDay(ctx, 121).bpm).not.toEqual(generateDay(ctx, 120).bpm);
  });

  it("seeds the full range identically twice", async () => {
    const again = await seed();
    expect(checksums(again.sqlite)).toEqual(checksums(sqlite));
  }, 60_000);

  it("cuts at `now`: an earlier now writes no HR, step or finished-night row after it", async () => {
    const fiveAm = Date.parse(`${TODAY}T05:00:00+05:30`) / 1000;
    const early = testDb();
    for (let i = 0; i < SEED_DAYS; i += 30) {
      await writeDays(early.store, Array.from({ length: Math.min(30, SEED_DAYS - i) }, (_, k) => generateDay(ctx, i + k)), fiveAm);
    }
    const last = (await early.store.samples.readSamples("hr", 0, FAR)).at(-1)!;
    expect(last.ts).toBe(fiveAm - 15);
    const today = early.sqlite.prepare("select hrv_ms, nightly_temp_c from daily_metrics where day = ?").get(TODAY);
    expect(today).toEqual({ hrv_ms: null, nightly_temp_c: null });
  });
});
