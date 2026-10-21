/// <reference types="node" />
// The ported pipeline on the in-memory Store, over the same 180-day demo seed the web app's tests pin
// (src/server/testing.ts: NOW = Friday 2026-10-02 14:00 IST, Asia/Kolkata, max HR 183, height 178 cm).
import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { DEMO_PROFILE, SCENARIO, seedDemo } from "@/data/seed";
import type { ScoreRow, SeriesKind } from "@/data/store";
import type { Profile } from "@/data/types";
import {
  type HealthMonitorRow,
  type JournalImpactRow,
  lastRun,
  type RecoveryRow,
  resolveMaxHr,
  runPipeline,
  SCORING_VERSION,
  type SleepRow,
  STAGE2_COLUMNS,
  type Stage1Day,
  type StrainTargetRow,
  type TrainingLoadRow,
} from "@/pipeline";
import { dayRestingHr } from "./restingHr";
import snapshot from "./__parity__/sqlite-scores.json";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-02";
const ANCHOR = "2026-04-06";
const DAY_S = 86_400;
/** Friday 14:00, after wake; the seeded range then starts on Monday 2026-04-06 (day index 0). */
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: TZ };
const dayAt = (i: number) => new Date(Date.parse(ANCHOR) + i * DAY_S * 1000).toISOString().slice(0, 10);
const SERIES: SeriesKind[] = ["hr", "still_hr", "stress", "energy_bank"];

/** A store that counts the pipeline's writes, so a no-op run can be shown to write nothing. */
class CountingStore extends MemoryStore {
  writes = 0;
  override putScores(row: ScoreRow) {
    this.writes++;
    return super.putScores(row);
  }
  override putSeries(day: string, kind: SeriesKind, data: (number | null)[]) {
    this.writes++;
    return super.putSeries(day, kind, data);
  }
}

async function seeded() {
  const store = new CountingStore();
  await seedDemo(store, { today: TODAY, timeZone: TZ, now: NOW });
  return store;
}
const run = (store: CountingStore) => runPipeline(store, PROFILE, { today: TODAY });
const allRows = (store: CountingStore) => store.scoresIn({ from: "0000-00-00", to: "9999-99-99" });
const dump = async (store: CountingStore, before?: string) =>
  JSON.stringify((await allRows(store)).filter((r) => !before || r.day < before));

let store: CountingStore;
let rows: Map<string, ScoreRow>;
let allDays: string[];
let result: { days: number; stage1Reran: number };
const col = <K extends keyof ScoreRow>(day: string, k: K): NonNullable<ScoreRow[K]> => {
  const v = rows.get(day)?.[k];
  if (v == null) throw new Error(`${day}.${k} is null`);
  return v;
};
beforeAll(async () => {
  store = await seeded();
  result = await run(store);
  rows = new Map((await allRows(store)).map((r) => [r.day, r]));
  allDays = [...rows.keys()].sort();
});

describe("runPipeline on the 180-day seed", () => {
  it("scores every day once, under the current scoring version, with stage 1 run for all of them", () => {
    expect(result).toEqual({ days: 180, stage1Reran: 180 });
    expect(allDays).toHaveLength(180);
    expect(allDays[0]).toBe(ANCHOR);
    expect(allDays.at(-1)).toBe(TODAY);
    expect(new Set([...rows.values()].map((r) => r.scoringVersion))).toEqual(new Set([SCORING_VERSION]));
    for (const r of rows.values()) for (const k of STAGE2_COLUMNS) expect(r[k], `${r.day}.${k}`).not.toBeNull();
  });

  it("feeds Pulse Age the days' step counts, the totals the Steps screen shows", async () => {
    const steps = new Map((await store.allMetrics()).map((m) => [m.day, m.steps]));
    const sunday = allDays.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0).at(-1)!;
    const window = allDays.filter((d) => d > dayAt(allDays.indexOf(sunday) - 28) && d <= sunday);
    const counts = window.flatMap((d) => (steps.get(d) == null ? [] : [steps.get(d)!]));
    const age = col(sunday, "healthspan");
    if (age.reason !== null) throw new Error(`no Pulse Age on ${sunday}: ${age.reason}`);
    const factor = age.contributions.find((c) => c.key === "steps")!;
    expect(factor.value).toBeCloseTo(counts.reduce((a, b) => a + b, 0) / counts.length, 1);
  });

  it("feeds Pulse Age Fitbit's VO2 max, and Pulse's own estimate only when the 28 days have none", async () => {
    const sunday = allDays.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0).at(-1)!;
    const measured = col(sunday, "healthspan");
    if (measured.reason !== null) throw new Error(`no Pulse Age on ${sunday}: ${measured.reason}`);
    expect(measured.vo2maxSource).not.toBe("estimate");

    // The same history with every Fitbit VO2 max removed.
    const bare = await seeded();
    await bare.upsertMetrics((await bare.allMetrics()).map((m) => ({ ...m, vo2maxRun: null, vo2maxDaily: null })));
    await run(bare);
    const bareRows = new Map((await allRows(bare)).map((r) => [r.day, r]));
    const age = bareRows.get(sunday)!.healthspan!;
    if (age.reason !== null) throw new Error(`no Pulse Age on ${sunday}: ${age.reason}`);
    expect(age.vo2maxSource).toBe("estimate");
    const window = allDays.filter((d) => d > dayAt(allDays.indexOf(sunday) - 28) && d <= sunday);
    const estimates = window.flatMap((d) => {
      const v = bareRows.get(d)?.healthspan?.fitnessEstimate?.vo2max;
      return v == null ? [] : [v];
    });
    expect(estimates.length).toBeGreaterThan(0);
    const factor = age.contributions.find((c) => c.key === "vo2max")!;
    expect(factor.value).toBeCloseTo(estimates.reduce((a, b) => a + b, 0) / estimates.length, 1);
  });

  it("resolves the demo profile's max HR to Tanaka's 183", () => {
    expect(resolveMaxHr({ ...DEMO_PROFILE }, TODAY)).toBe(183);
    expect(col(dayAt(120), "strain").maxHr).toBe(183);
  });
});

describe("parity with the web app", () => {
  // The scores mobile still computes the web's way. Strain left it at version 15: WHOOP's 2024 zones and a Banister load
  // through a log map fitted to WHOOP's published averages, in place of the web's Edwards zones from 50 % of the reserve
  // (src/core/scoring/strain.ts; docs/research/whoop-garmin.md C1–C3). Sleep Performance left it at version 16 (WHOOP's
  // 2025 four parts against the night's full need, src/core/scoring/sleep.ts; C4, C5), and so Recovery, which reads it.
  const MATCHED = [] as const;
  it("covers the same seeded days as the web build (__parity__/sqlite-scores.json)", () => {
    const expected = snapshot as { day: string; recovery: number | null; strain: number | null; sleep: number | null }[];
    expect(allDays).toEqual(expected.map((d) => d.day));
    for (const e of expected) {
      const actual = {
        recovery: col(e.day, "recovery").value,
        sleep: col(e.day, "sleep").performance,
      };
      for (const k of MATCHED as readonly ("recovery" | "sleep")[]) {
        if (e[k] == null) expect(actual[k], `${e.day} ${k}`).toBeNull();
        else expect(Math.abs(actual[k]! - e[k]!), `${e.day} ${k}: ${actual[k]} vs ${e[k]}`).toBeLessThan(1e-6);
      }
    }
  });

  // The web's golden.test.ts fingerprints for SCORING_VERSION 9, computed the same way: numbers to 10 significant
  // digits, object keys sorted, one row per line with its values tab-separated, sha256 truncated to 16 hex characters.
  // `strain` and `journal_impact` carry a memo key (sha1 on the web, FNV-1a here), so those two are compared with the
  // key removed against the web's rows instead of its hash. Mobile is at SCORING_VERSION 12 (src/pipeline/types.ts);
  // the lines that differ from the web say why. Recovery, sleep, Strain's effort (the parity test above), stress, Energy
  // Bank and every series still match the web exactly.
  const GOLDEN_9: Record<string, string> = {
    // Mobile's SCORING_VERSION is 15 (the web's 9 hashed to "06731b2819e3281d", mobile's 10 to "bfc634c893f9c22c", 11 to
    // "16e50b07b414d86c", 12 to "939826e567133b72", 13 to "d458be542084860d", 14 to "d9daea29ed5fa736"): every row carries
    // the new number. 14: Pulse Age's sleep consistency pools pairs of nights (below). 11: the Pulse Age rebuild
    // (WHOOP-parity model, bout zone minutes, Fitness Age). 12: its refinements after checking the sources (step curves by
    // age, brisk minutes twice). 13: Fitness Age's real zone minutes and clock-time wake minutes on DST days (below).
    // 15: WHOOP's 2024 zones and the recalibrated Strain (strain.ts; the lines below say what each change moved).
    // 16: Sleep Performance on WHOOP's 2025 parts and the patent's sleep need (sleep.ts, sleepPlanner.ts). Version 15's
    // value was "fab0c4eee005f38d". 17: Recovery on WHOOP's 2026 inputs (recovery.ts). Version 16's value was
    // "3b88f4ed65deb34e". 18: Garmin's training load, the 24-hour Energy Bank and Halo Age's WHOOP definitions. Version
    // 17's value was "a95ad63c44f235eb". 19: HRV Status and Garmin-style training (two new columns, below). Version 18's
    // value was "c4a73691987f16d1". 20: the Pulse engine's Sleep and Recovery (src/pipeline/engine.ts); every column that
    // reads Recovery, the Sleep Score or the need moved with them (Energy Bank, Health Monitor, Pulse Age, HRV Status,
    // the planner, Strain Target, training, training load, reports). Version 19's value was "769c3cb7fe6c5606". 21: Daily
    // Strain as a percent and Cardio Load (Phase 4): each activity gains its engine units, TRIMP, EPOC and heart-rate
    // recovery, Target Strain moves to the percent scale, and the sleep need reads the new strain. Version 20's value was
    // "f0df0ca35661e535". 22: Stress on 0–100 and the engine's Energy Bank (Phase 5); both columns and both series
    // moved, nothing else. Version 21's value was "416071272e0e6e64". 23: Pulse Age on the engine's nine factors
    // (Phase 6); only healthspan moved. Version 22's value was "1be75842de2b2bd1". 24: Health Monitor's ±1 SD band over
    // 30 nights and the engine's journal t-test (Phase 7); Health Monitor and the reports moved. Version 23's value was
    // "e5852ab4c03c2755". The reports also carry each day's strain as the engine's percent (recordOutcomes). 25: the engine's zones on 220 − age and Pulse Age's weekly sums,
    // as the study. Version 24's value was "eca080343200e2aa".
    // 26: Pulse Age on Sundays and Health Monitor without SpO2. Version 25's value was "cd0c930a0a7e70db".
    // 27: workouts' engine zones and the reports' training balance on Training Load. Version 26's value was "56420b3a0a69eda6".
    // 28: Pulse Age's steps are the day's count. Version 27's value was "bfc30f8718e6d5cb".
    // Version 29: Fitbit's HRV and resting HR are every vital's source of truth. Version 28's value was "32eeb5d9e23357a3".
    // 30: Pulse Age's VO2 max falls back to the estimate (the seed has Fitbit's, so only the version moves). Version 29's value was "22839852f7ee4661".
    "daily_scores.scoring_version": "25a36d10947fc464",
    // Version 15: Activity Strain is the session's Banister TRIMP plus its muscular load through 5.05 · ln(1 + 0.09 · T)
    // (a seeded 45-minute strength session goes from 8.2 to 9.9 on 0–21), each activity stores its `cardioTrimp` and
    // `muscularTrimp`, and its zone seconds count Zone 1 from 40 % of the reserve. Version 14's value was "cb2d75373aaf4d20".
    // Version 19: each activity also stores its peak EPOC, the VO2max it was read on and its time by % of max HR (Training
    // Effect's inputs); every earlier field is unchanged. Version 18's value was "ea888703b987b5a2".
    "daily_scores.activities": "630ee2607f93bac5",
    "daily_scores.session_rhr_bpm": "2f808b51bd7a0bc8",
    // Version 15: only the forecast moved (it reads today's and the last 14 days' Effort); every Recovery score, input,
    // baseline and driver is unchanged. Version 14's value was "f30d80524db0f63f".
    // Version 16: its sleep-performance input is the new Sleep Performance, so scores move a little (at most 4 points,
    // 0.8 on average; today's 79.4 → 78.3). Version 15's value was "dcd477800b359ce2".
    // Version 17: HRV is scored as ln(RMSSD) against a 21-night-half-life ln baseline (`hrvZ` follows), the weights are
    // 0.58 / 0.22 / 0.20, respiratory rate only ever lowers the score (and has a driver row only then), and skin
    // temperature is out of the score, terms and drivers (still in `inputs`, `baselines` and `stale` for Health Monitor).
    // Scores move 2.1 points on average, 7.4 at most (today's 78.3 → 79.0); over the seed the mean is 59.3 with 15 % red
    // and 41 % green (was 58.6, 14 %, 37 %). Version 16's value was "238d071f788df5f8".
    // Version 29: HRV and resting HR are Fitbit's nightly HRV and the day's resting HR (dayRestingHr), baselines pooled from them. Version 28's value was "b3aa02f4aeed76aa".
    "daily_scores.recovery": "d3b2d626013150ba",
    // Version 16: Sleep Performance is WHOOP's 2025 four parts (hours against the night's full need, WHOOP-style 4-day
    // consistency, efficiency against 95 %, 100 − Sleep Stress) with restorative sleep left out; rows gain `parts`,
    // `needMin`, `stressPct` and the night's `latencyMin`, `consistency` is the 4-day measure (SRI stays in `sri`), and debt
    // looks back 28 nights. Today’s 89.83 → 86.46 (7 h 13 min asleep against an 8 h 53 min need). Version 15's value was
    // "ccb090c5c5766471".
    "daily_scores.sleep": "f145dca5e4ad925d",
    // A worn day too short of heart rate for an Effort is missing, not 0 (src/pipeline/scores.ts scoreTrainingLoad): the
    // band-back day 2026-09-10 (32 samples) no longer pulls the acute load down, so from that day on the ACWR differs
    // (0.82 there, was 0.73) and the run of days restarts one day later. The web's value was "c6a22d117dfa06bc".
    // Version 15: the ACWR, monotony and CTL/ATL/TSB read the recalibrated daily Effort (mean Day Strain 8.1 → 9.7 on
    // 0–21, rest days no longer near 0). Version 14's value was "53d7d0530a447dfa".
    // Version 18: Garmin's model on the linear daily TRIMP: a 10-day decaying acute load normalised to 7 days, a chronic
    // load that is the 28-day mean of it, rows gain `acute` and `chronic`, monotony and CTL/ATL/TSB read the TRIMP too. The
    // ratio is livelier (0.47–1.92 over the seed, was 0.64–1.29; today's 1.02 → 0.99), and on Garmin's 0.8 / 1.5 / 2.0
    // bands 17 days read building fast where none did. Version 17's value was "2f0b3f43cfc8014c".
    // Version 29: follows the Recovery and HRV it reads. Version 28's value was "2ef71bc826258214".
    "daily_scores.training_load": "cb6a9f40c045d6ab",
    // Follows the ACWR above (the target reads the day before's): 2026-09-11 to 09-14 are no longer "lifted" for a
    // ramping-down load. The web's value was "bfcfd859e9c7dd75". Version 15: the target's base is the 28-day mean of the
    // recalibrated Strain (today's range 6.8–8.8 → 9.2–11.4). Version 14's value was "75e4cf7d163079e5".
    // Version 16: the Recovery band moved on two days with the new Sleep Performance (2026-05-25 67.0 → 67.3, now green;
    // 2026-08-02 33.7 → 36.5, now yellow), so their ranges follow. Version 15's value was "389030ae255dd95f".
    // Version 17: nine days change Recovery band with the new Recovery inputs (2026-05-06 36.6 → 30.4 red, 2026-05-23
    // 66.2 → 70.8 green, …), and their ranges follow. Version 16's value was "98e74b2f34c069cd".
    // Version 18: the cap reads Garmin's ratio, from 1.5 (was 1.3), and the lift under 0.8 fires on the livelier ratio:
    // 42 days' ranges move (today's 9.2–11.4 is unchanged). Version 17's value was "58d9671c01a08352".
    // Version 29: follows Recovery. Version 28's value was "a2f03bec24de4bfb".
    "daily_scores.strain_target": "1c4d8fff1ac51dd9",
    // Version 15: the planner's strain term reads the recalibrated Effort against its 28-day mean (2026-10-01's need 506 →
    // 502 minutes). Version 14's value was "bf57a92ddfecd8e0".
    // Version 16: need = baseline + WHOOP's patented strain sigmoid + half the debt (at most an hour) − naps, in 6.5–11 h,
    // and bedtimes leave the typical minutes to fall asleep (tonight's need 492 → 515 minutes; the seed's average need is
    // now 514, WHOOP's published member average is 8 h 34 min). Version 15's value was "b1b372539fa00d58".
    "daily_scores.sleep_planner": "21ded9d9241c7d3c",
    // Version 16: each morning starts from 0.6 × Recovery + 0.4 × Sleep Performance, both moved by the new Sleep
    // Performance (today's start 83.6 → 81.6). Version 15's value was "f822e67fed343673".
    // Version 17: its start follows the new Recovery (today's 81.6 → 82.0). Version 16's value was "6e4699097a6c6d00".
    // Version 18: a 24-hour Body Battery-style reserve on 5–100: each day carries on from midnight at the level the day
    // before ended (the first day starts at wake from Recovery and sleep), sleep charges it by stage and night quality,
    // and awake minutes pay sleep pressure, TRIMP and stress. Rows gain `from`, `fromLevel` and `band`. The level at wake
    // averages 90 (was 71) and the day's last level 36 (was 28); today's wake 82.0 → 99.8, now 61.0 → 70.3. Version 17's
    // value was "ab6a00f26829217a".
    "daily_scores.energy_bank": "e6d497db013e414c",
    "daily_scores.stress": "d367480fb07ee9c7",
    // The illness signal's SD is floored at half the baselines' σ floor (src/core/scoring/illness.ts illnessSdFloor),
    // which tempers a few days' scores (the seeded illness's 2026-08-03 scores 51 where it scored 69). The web's
    // value was "3a2163c7f92d4dab".
    // Version 29: HRV and resting HR are Fitbit's, the values every screen shows. Version 28's value was "47289fc792ec11ef".
    "daily_scores.health_monitor": "4d132dadfd15bf77",
    // Mobile rebuilds Pulse Age on WHOOP's Healthspan method (src/core/algorithms/healthspan.ts): 6.0 years per ln HR
    // (WHOOP's 10 × an overlap factor of 0.6) with no 9/n rescaling (a missing term counts 0), WHOOP's references and
    // curves (sleep from 7 h, Arem and Ahmadi zone curves, strength flat after 40 min, lean mass as body fat %), zone time
    // only inside workouts or in 10-minute bouts (stage 1's `boutZoneSeconds`), steps, zones and strength only on days
    // with 12 h of heart rate, Pace = 1 + (Δ30 − Δ180) / 0.5 shown from 21 of 30 days, and the day's Fitness Age
    // estimate (`fitnessEstimate`). Today's Pulse Age goes from +1.32 to −3.95 (the seed is a fit 36-year-old: VO2 max
    // 44 against WHOOP's 41, 10,200 steps, 236 bouted moderate minutes a week). The web's value was "683be47b969df06b".
    // Version 12, after checking the sources: Paluch's age-specific step curves, a minute at 60–80 % of the reserve
    // counting twice in zones 1–3 (moderate-equivalent minutes, Arem's dose), and the overlap factor refit to 4.77.
    // Version 13: the doubled minutes are Pulse Age's dose only. Fitness Age's activity index (`fitnessEstimate`) had read
    // them as real minutes, so more days counted as active, active days ran longer and the vigorous share shrank; it reads
    // each minute once now. Today's index goes from 5 to 3.75 and Fitness Age from 32.0 to 33.0; Pulse Age itself is
    // unchanged (the seed has a measured VO2max). Version 12's value was "02d38912d1963795".
    // Version 14: the sleep-consistency term pools the window's pairs of nights, each pair once (sriPair), instead of
    // averaging the daily 7-day SRIs, which counted the first nights up to six times. Version 13's value was
    // "a4776422744c7a4f".
    // Version 18 (WHOOP's Healthspan definitions): zone 1–3 minutes count once (today's 365 → 236 a week, −1.02 → −0.64
    // years), yoga, Pilates and boot camp count as strength (the seed has none), and Pace of Aging is published on Mondays
    // once 21 of the last 31 days have a Recovery (`paceDaily` keeps the day's own, `paceAsOf` names the Monday): today
    // shows Monday 2026-09-28's 1.70, its own daily value being 1.42 (version 17 showed a daily 1.61). Today's Halo Age
    // 33.41 → 33.78. Version
    // 17's value was "2fdf2c34ba15be9c". Version 28: Pulse Age's steps are the day's count, not Strain's awake steps.
    // Version 27's value was "a85973629b8558d7".
    // Version 29: its resting HR is the day's (dayRestingHr). Version 28's value was "441bbc0fac119709".
    "daily_scores.healthspan": "7ed55edf8a4ceebb",
    // Version 19: the VO2 max categories use Garmin's percentile cut-offs, 40 / 60 / 80 / 95 (were 20 / 40 / 60 / 80), so
    // today's 45.3 at the 61st percentile reads Good, not Excellent; percentiles are unchanged. Version 18's value was
    // "cfad8d1954c878ed".
    "daily_scores.fitness": "acc03af566eaa295",
    // New at version 19 (hrvStatus.ts): HRV Status from the 7-night average of ln HRV against the 60 nights before; the
    // seed reads building for its first 27 days, then Balanced on 148 days and Unbalanced on 5.
    // Version 29: reads Fitbit's nightly HRV. Version 28's value was "9ac04f611f5dad6d".
    "daily_scores.hrv_status": "027b836ad9f6714d",
    // New at version 19 (scores.ts scoreTraining): each workout's Aerobic Training Effect (walks about 1.5, strength 2.3,
    // easy runs 3.3, tempo runs 4.3, intervals 5.0 on the seed), Recovery Time, Training Readiness at wake and now, and
    // Training Status (productive 58 days, maintaining 77, recovery 26, no status 19).
    // Version 29: Training Readiness follows Recovery and HRV. Version 28's value was "bd09a22c06111df2".
    "daily_scores.training": "b366c75557cc378a",
    // Version 16: the curve follows its start level (above). Version 15's value was "237320b091a7a358".
    // Version 17: likewise. Version 16's value was "081d84cb00f2d1a6". Version 18: the curve runs from midnight (the night's
    // recharge included) on the new rates. Version 17's value was "ea5921ebc2c6e657".
    "intraday_series.energy_bank": "8ccf48581238829f",
    "intraday_series.hr": "5ca83bb68dad9033",
    "intraday_series.still_hr": "c0bf14266ee71abd",
    "intraday_series.stress": "34660dca062d2b00",
    // Each report's training balance is the period's last ACWR, so it follows training_load. The web's was "7c7cfdf8c1583777".
    // Version 15: its Strain averages and training balance follow the recalibrated Strain. Version 14's was "1354f14bbf246252".
    // Version 16: Sleep Performance, Recovery and sleep-consistency averages follow the new sleep scoring. Version 15's
    // was "dac817e185f4f75f". Version 17: Recovery averages follow the new Recovery. Version 16's was "1043e130fde0738d".
    // Version 18: the training balance is the period's last Garmin ratio, banded at 0.8 / 1.5 / 2.0. Version 17's was
    // "60efbad5a80cb17c".
    // Version 29: HRV, resting HR and Recovery averages follow Fitbit's vitals. Version 28's value was "1d3f0b8d953960c6".
    reports: "f8047bb194a9f3e4",
  };
  const canon = (v: unknown): unknown =>
    typeof v === "number"
      ? +v.toPrecision(10)
      : Array.isArray(v)
        ? v.map(canon)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
            )
          : v;
  const hash = (rs: unknown[][]) =>
    crypto
      .createHash("sha256")
      .update(rs.map((r) => r.map((v) => JSON.stringify(canon(v))).join("\t")).join("\n"))
      .digest("hex")
      .slice(0, 16);
  const COLUMNS: Record<string, keyof ScoreRow> = {
    scoring_version: "scoringVersion",
    activities: "activities",
    session_rhr_bpm: "sessionRhrBpm",
    recovery: "recovery",
    sleep: "sleep",
    training_load: "training_load",
    strain_target: "strain_target",
    sleep_planner: "sleep_planner",
    energy_bank: "energy_bank",
    stress: "stress",
    health_monitor: "health_monitor",
    healthspan: "healthspan",
    fitness: "fitness",
    hrv_status: "hrv_status",
    training: "training",
  };

  it("matches the web's pinned fingerprints for every score column, series and report", async () => {
    const actual: Record<string, string> = {};
    for (const [name, key] of Object.entries(COLUMNS)) actual[`daily_scores.${name}`] = hash(allDays.map((d) => [d, rows.get(d)![key]]));
    for (const kind of SERIES) {
      const series: unknown[][] = [];
      for (const d of allDays) {
        const s = await store.getSeries(d, kind);
        if (s) series.push([d, s]);
      }
      actual[`intraday_series.${kind}`] = hash(series);
    }
    actual.reports = hash((await store.getReports()).map((r) => [r.period, r.data]));
    expect(actual).toEqual(GOLDEN_9);
  });
});

describe("the last 30 days", () => {
  const last30 = () => Array.from({ length: 30 }, (_, k) => dayAt(150 + k));
  const { bandOff, noHrvNight } = SCENARIO;
  const bandOffNights = [bandOff.day + 1, bandOff.untilDay].map(dayAt); // 156, 157

  it("have a Recovery score, except the band-off nights and the night without HRV", () => {
    for (const d of last30()) {
      const r = col(d, "recovery");
      if (bandOffNights.includes(d)) expect(r, d).toMatchObject({ value: null, reason: "band_not_worn" });
      else if (d === dayAt(noHrvNight)) expect(r, d).toMatchObject({ value: null, reason: "no_hrv_last_night" });
      else {
        expect(r.value, d).toBeTypeOf("number");
        expect(r.value!, d).toBeGreaterThanOrEqual(0);
        expect(r.value!, d).toBeLessThanOrEqual(100);
        expect(r.provisional, d).toBe(false);
      }
    }
  });

  it("have sleep performance on every night the band was worn, with a plausible need", () => {
    for (const d of last30()) {
      const s = col(d, "sleep");
      if (bandOffNights.includes(d)) {
        expect(s.performance, d).toBeNull();
        expect(s.reason, d).toBe("band_not_worn");
        continue;
      }
      expect(s.performance, d).toBeTypeOf("number");
      expect(s.performance!, d).toBeGreaterThan(30);
      expect(s.performance!, d).toBeLessThanOrEqual(100);
      expect(s.needHours, d).toBeGreaterThan(6);
      expect(s.needHours, d).toBeLessThan(10);
    }
    // The short-sleep week builds debt.
    expect(col(dayAt(SCENARIO.shortSleep.end), "sleep").debtMin).toBeGreaterThan(col(dayAt(SCENARIO.shortSleep.start - 1), "sleep").debtMin);
  });

  it("have Strain's effort on 0–100 whenever the band was on", () => {
    const efforts: number[] = [];
    for (const d of last30()) {
      const s1 = col(d, "strain");
      if (d === dayAt(bandOff.day + 1)) {
        expect(s1.hrCount, d).toBe(0);
        expect(s1.effort, d).toBeNull();
        continue;
      }
      if (d === dayAt(bandOff.untilDay)) continue; // eight minutes of HR before midnight: too little to score
      expect(s1.effort, d).toBeTypeOf("number");
      efforts.push(s1.effort!);
    }
    expect(Math.max(...efforts)).toBeLessThanOrEqual(100);
    expect(Math.max(...efforts)).toBeGreaterThan(21); // a training day's Effort is above the 0–21 axis
    expect(Math.min(...efforts)).toBeGreaterThanOrEqual(0); // a rest day can sit at 0
  });

  it("have Health Monitor's four vitals on every night with data (no SpO2: Health Connect has none)", () => {
    for (const d of last30()) {
      const hm = col(d, "health_monitor");
      if (bandOffNights.includes(d)) {
        expect(hm.reason, d).toBe("band_not_worn");
        continue;
      }
      if (hm.reason !== null) throw new Error(`${d}: ${hm.reason}`);
      expect(hm.vitals.map((v) => v.key).sort()).toEqual(["hrv", "resp", "restingHr", "skinTempDev"]);
    }
  });

  it("have a Strain Target on the percent scale every day: low 20–120, high 40–120, low under high", () => {
    for (const d of last30()) {
      const t: StrainTargetRow = col(d, "strain_target");
      if (t.reason !== null) throw new Error(`${d}: no target`);
      expect(t.low, d).toBeGreaterThanOrEqual(20);
      expect(t.high, d).toBeLessThanOrEqual(120);
      expect(t.high, d).toBeGreaterThan(t.low);
    }
  });
});

describe("numbers checked by hand", () => {
  it("Recovery's sleepPerf is sleep performance / 100 on [0, 1]", () => {
    let checked = 0;
    for (const d of allDays) {
      const rec: RecoveryRow = col(d, "recovery");
      const sleep: SleepRow = col(d, "sleep");
      if (rec.inputs.sleepPerf == null) continue;
      expect(rec.inputs.sleepPerf).toBeGreaterThanOrEqual(0);
      expect(rec.inputs.sleepPerf).toBeLessThanOrEqual(1);
      if (sleep.performance != null) {
        expect(rec.inputs.sleepPerf).toBeCloseTo(sleep.performance / 100, 12);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("zones are five on heart-rate reserve from the day's resting HR; Recovery and Strain read the daily resting HR", async () => {
    const metrics = new Map((await store.allMetrics()).map((m) => [m.day, m]));
    for (const d of [dayAt(120), dayAt(157)]) {
      const s1: Stage1Day = col(d, "strain");
      const reserve = s1.maxHr - s1.restingHr;
      expect(s1.zoneLower).toEqual([0.4, 0.6, 0.7, 0.8, 0.9].map((e) => Math.round((s1.restingHr + e * reserve) * 10) / 10));
      expect(s1.zoneSeconds).toHaveLength(5);
    }
    const d = dayAt(120);
    const m = metrics.get(d)!;
    // Version 29: Recovery's resting HR is the day's (dayRestingHr), Fitbit's daily value, the one every screen shows.
    expect(col(d, "recovery").inputs.rhr).toBe(m.rhrBpm);
    expect(col(d, "strain")).toMatchObject({ restingHr: m.rhrBpm, restingHrSource: "daily" });
    // Skin temperature: nightly − Health Connect's baseline (fix 10). Health Monitor (version 24): each vital's normal band
    // is ±1 SD of the last 30 nights, this one included, and the status follows it.
    expect(col(d, "recovery").inputs.skinTempDev).toBeCloseTo(Math.round((m.nightlyTempC! - m.tempBaselineC!) * 100) / 100, 9);
    const hm: HealthMonitorRow = col(d, "health_monitor");
    if (hm.reason !== null) throw new Error("no health monitor");
    for (const v of hm.vitals) {
      expect(v.rangeSource, v.key).toBe("pulse");
      if (v.value == null || !v.range) continue;
      const inside = v.value >= v.range.low - 0.01 && v.value <= v.range.high + 0.01;
      if (v.status === "in_range") expect(inside, v.key).toBe(true);
      else expect(v.status === "low" ? v.value < v.range.low + 0.01 : v.value > v.range.high - 0.01, v.key).toBe(true);
    }
  });

  it("Recovery and Health Monitor judge Fitbit's HRV and resting HR on every day, the values the screens show", async () => {
    const metrics = new Map((await store.allMetrics()).map((m) => [m.day, m]));
    for (const d of allDays) {
      const m = metrics.get(d);
      const rhr = dayRestingHr(m?.rhrBpm, rows.get(d)?.sessionRhrBpm);
      const rec = rows.get(d)?.recovery;
      if (rec) expect(rec.inputs, d).toMatchObject({ hrv: m?.hrvMs ?? null, rhr });
      const hm = rows.get(d)?.health_monitor;
      if (!hm || hm.reason !== null) continue;
      expect(hm.vitals.find((v) => v.key === "hrv")?.value ?? null, d).toBe(m?.hrvMs ?? null);
      expect(hm.vitals.find((v) => v.key === "restingHr")?.value ?? null, d).toBe(rhr);
    }
  });

  it("the first night has no baseline; Recovery shows from the second, provisional until 60 days span its data (fix 17)", () => {
    expect(col(dayAt(0), "recovery")).toMatchObject({ value: null, reason: "calibrating", nightsLeft: 1 });
    const first = col(dayAt(1), "recovery");
    expect(first.value).toBeTypeOf("number");
    expect(first.provisional).toBe(true);
    expect(col(dayAt(59), "recovery").provisional).toBe(true);
    expect(col(dayAt(70), "recovery").provisional).toBe(false);
  });

  it("skin temperature only ever lowers Recovery; nights without it have no temperature term", () => {
    for (const d of allDays) {
      const r = col(d, "recovery");
      const t = r.drivers.find((x) => x.label === "SKIN_TEMPERATURE");
      if (t) expect(t.deltaPoints, d).toBeLessThanOrEqual(0);
      if (r.inputs.skinTempDev == null) expect(r.terms, d).not.toContain("skinTemp");
    }
    expect(col(dayAt(101), "recovery").inputs.skinTempDev).toBeTypeOf("number");
  });

  it("band-off days without Fitbit's resting HR carry the last one forward instead of 60 bpm (mobile)", async () => {
    const metrics = new Map((await store.allMetrics()).map((m) => [m.day, m]));
    const before = metrics.get(dayAt(SCENARIO.bandOff.day))!.rhrBpm!;
    for (const d of [dayAt(SCENARIO.bandOff.day + 1), dayAt(SCENARIO.bandOff.untilDay)]) {
      expect(metrics.get(d)?.rhrBpm ?? null, d).toBeNull();
      expect(col(d, "strain"), d).toMatchObject({ restingHr: before, restingHrSource: "carried" });
    }
    const sources = new Set(allDays.map((d) => col(d, "strain").restingHrSource));
    expect(sources).toEqual(new Set(["daily", "carried"]));
  });

  it("Training load counts one row per calendar day: the band-off days break the run", () => {
    for (const d of allDays) {
      const tl: TrainingLoadRow = col(d, "training_load");
      if (col(d, "strain").hrCount === 0) expect(tl.contiguousDays, d).toBe(0);
    }
    expect(col(dayAt(158), "training_load").contiguousDays).toBeLessThan(5);
    expect(col(dayAt(150), "training_load").contiguousDays).toBe(151);
  });

  it("Energy Bank carries on overnight: each day starts at midnight where the day before ended, within 1–100", async () => {
    let carried = 0;
    for (let i = 1; i < allDays.length - 1; i++) {
      const prev = rows.get(allDays[i - 1])!.energy_bank!;
      const eb = rows.get(allDays[i])!.energy_bank!;
      if (eb.value == null || prev.value == null) continue;
      expect(eb.fromLevel, allDays[i]).toBe(prev.value);
      expect(eb.from, allDays[i]).toBe(Date.parse(`${allDays[i]}T00:00:00+05:30`) / 1000);
      // The night's sleep charges it: the level at wake is above the level at midnight.
      expect(eb.startLevel, allDays[i]).toBeGreaterThan(eb.fromLevel!);
      expect(eb.value).toBeGreaterThanOrEqual(1);
      expect(eb.value).toBeLessThanOrEqual(100);
      carried++;
    }
    expect(carried).toBeGreaterThan(150);
    // The machine never resets (fix 3 warms it up once): after the band-off nights it carries on from midnight.
    const back = col(dayAt(158), "energy_bank");
    if (back.value == null) throw new Error("no Energy Bank on day 158");
    expect(back.from).toBe(Date.parse(`${dayAt(158)}T00:00:00+05:30`) / 1000);
  });

  it("Energy Bank warms up for 7 days before it shows (fix 3)", () => {
    for (let i = 0; i < 7; i++) expect(col(dayAt(i), "energy_bank"), dayAt(i)).toMatchObject({ value: null, reason: "calibrating" });
    expect(col(dayAt(7), "energy_bank").value).toBeTypeOf("number");
  });

  it("Energy Bank has a curve on scored days and none on a band-off day", async () => {
    expect(await store.getSeries(dayAt(120), "energy_bank")).not.toBeNull();
    expect(col(dayAt(120), "energy_bank").value).toBeTypeOf("number");
    expect(await store.getSeries(dayAt(156), "energy_bank")).toBeNull();
    expect(col(dayAt(156), "energy_bank")).toMatchObject({ value: null, reason: "band_not_worn" });
  });

  it("reports cover each ISO week and month, the current ones partial", async () => {
    const reports = new Map((await store.getReports()).map((r) => [r.period, r.data]));
    expect(reports.get("2026-W40")).toMatchObject({ kind: "week", partial: true, start: "2026-09-28" });
    expect(reports.get("2026-10")).toMatchObject({ kind: "month", partial: true, days: 2 });
    expect(reports.get("2026-09")).toMatchObject({ kind: "month", partial: false, days: 30 });
    expect(reports.get("2026-W39")?.averages.recovery).toBeTypeOf("number");
  });
});

describe("incremental runs", () => {
  it("is deterministic: a second run reruns no day, writes nothing and leaves every row identical", async () => {
    const before = await dump(store);
    store.writes = 0;
    expect(await run(store)).toEqual({ days: 180, stage1Reran: 0 });
    expect(store.writes).toBe(0);
    expect(await dump(store)).toBe(before);
  });

  it("a scoring-version change reruns stage 1 for that day, and every day when all rows carry it", async () => {
    const other = await seeded();
    await run(other);
    const reference = await dump(other);
    await other.putScores({ ...(await other.getScores(dayAt(100)))!, scoringVersion: SCORING_VERSION - 1 });
    expect((await run(other)).stage1Reran).toBe(1);
    expect(lastRun.stage1Days).toEqual([dayAt(100)]);
    expect(await dump(other)).toBe(reference);
    for (const r of await allRows(other)) await other.putScores({ ...r, scoringVersion: SCORING_VERSION - 1 });
    expect((await run(other)).stage1Reran).toBe(180);
    expect(await dump(other)).toBe(reference);
  });

  it("compacting old heart rate to minutes reruns no day and changes no row, and only a stage-1 rerun reads the minutes", async () => {
    const other = await seeded();
    await run(other);
    const reference = await dump(other);
    const raw = (await other.readHr(0, Infinity)).length;
    const cut = Date.parse(`${dayAt(150)}T00:00:00Z`) / 1000;
    expect(await other.compactHr(cut)).toBeGreaterThan(0);
    expect((await other.readHr(0, Infinity)).length).toBeLessThan(raw);
    expect(await run(other)).toEqual({ days: 180, stage1Reran: 0 });
    expect(await dump(other)).toBe(reference);
  });

  it("a dirty day reruns stage 1 for it and the next day, whose night starts before midnight", async () => {
    const other = await seeded();
    await run(other);
    const reference = await dump(other);
    await other.markIntradayDirty([dayAt(100)]);
    await run(other);
    expect(lastRun.stage1Days).toEqual([dayAt(100), dayAt(101)]);
    expect(await other.takeIntradayDirty()).toEqual([]);
    expect(await dump(other)).toBe(reference);
  });

  it("a check-in's dirty mark refreshes journal impact, causally and deterministically", async () => {
    const logged = await seeded();
    await run(logged);
    const reference = await dump(logged, dayAt(171));
    await logged.setJournal({ day: dayAt(170), tag: "cold_plunge", value: 1 });
    await logged.markIntradayDirty([dayAt(170)]);
    await run(logged);
    expect(lastRun.stage1Days).toEqual([dayAt(170)]);
    const tags = async (day: string) => ((await logged.getScores(day))!.journal_impact as JournalImpactRow).impacts.map((i) => i.tag);
    expect(await tags(dayAt(179))).toContain("cold_plunge");
    expect(await tags(dayAt(170))).not.toContain("cold_plunge"); // a day's impact reads only earlier check-ins
    expect(await dump(logged, dayAt(171))).toBe(reference);
    const after = await dump(logged);
    await run(logged);
    expect(await dump(logged)).toBe(after);
  });

  it("is causal: seeding a day later leaves every earlier day unchanged, and today's Recovery too", async () => {
    const later = await seeded();
    await run(later);
    const before = await dump(later, dayAt(179));
    // Today's Recovery is the morning's; its forecast for tomorrow reads today's Strain so far, which the rest of the day's
    // heart rate legitimately raises (since version 15 an evening walk under Zone 1 counts too), so it is left out.
    const morning = (r: RecoveryRow) => JSON.stringify({ ...r, forecast: null });
    const todayRecovery = morning((await later.getScores(dayAt(179)))!.recovery!);
    await seedDemo(later, { today: dayAt(180), timeZone: TZ, now: NOW + DAY_S, days: 181 });
    expect(await run(later)).toMatchObject({ days: 181 });
    expect(await dump(later, dayAt(179))).toBe(before);
    expect(morning((await later.getScores(dayAt(179)))!.recovery!)).toBe(todayRecovery);
  });

  it("an empty store runs to nothing", async () => {
    expect(await runPipeline(new MemoryStore(), PROFILE, { today: TODAY })).toEqual({ days: 0, stage1Reran: 0 });
  });
});
