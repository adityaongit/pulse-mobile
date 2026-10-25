// Mapping tests with plain record objects: no native module, no Health Connect.
import { describe, expect, it } from "vitest";

import { AWAKE_IN_BED, ExerciseType, exerciseTypeName, largestSourceSteps, mapExternalEntries, mapHr, mapRecords, mapSteps, MealType, MenstruationFlow, OvulationTestResult, SleepStageType, ts, Vo2MaxMeasurementMethod } from "./import";
import { localMidnight } from "@/lib/time";

const TZ = "Asia/Kolkata"; // UTC+05:30 year-round, so wall times are easy to reason about
const at = (day: string, time: string) => `${day}T${time}+05:30`;
const sec = (day: string, time: string) => ts(at(day, time));
const meta = (id: string, dataOrigin = "com.google.android.apps.fitness") => ({ id, dataOrigin });

const { AWAKE, LIGHT, DEEP, REM, SLEEPING } = SleepStageType;
const stage = (day: string, from: string, to: string, stage: number) => ({ startTime: at(day, from), endTime: at(day, to), stage });

describe("sleep", () => {
  it("maps a full hypnogram to segments and stage minutes on the wake day", () => {
    const { sessions, segments } = mapRecords(
      {
        SleepSession: [
          {
            metadata: meta("s1"),
            startTime: at("2026-10-01", "23:00:00"),
            endTime: at("2026-10-02", "06:00:00"),
            stages: [
              stage("2026-10-01", "23:00:00", "23:10:00", AWAKE),
              stage("2026-10-01", "23:10:00", "23:59:59", LIGHT), // seconds are kept, minutes rounded
              { startTime: at("2026-10-01", "23:59:59"), endTime: at("2026-10-02", "01:00:00"), stage: DEEP },
              stage("2026-10-02", "01:00:00", "06:00:00", REM),
            ],
          },
        ],
      },
      TZ,
    );
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s).toMatchObject({
      id: "s1",
      day: "2026-10-02",
      isMain: true,
      processed: true,
      stagesStatus: "SUCCEEDED",
      awakeMin: 10,
      lightMin: 50,
      deepMin: 60,
      remMin: 300,
      asleepMin: 410,
    });
    expect(s.startTs).toBe(sec("2026-10-01", "23:00:00"));
    expect(segments.map((g) => g.stage)).toEqual(["awake", "light", "deep", "rem"]);
    expect(segments.every((g) => g.sessionId === "s1")).toBe(true);
  });

  it("keeps a night staged when it has out-of-bed or awake-in-bed stages, counting them as awake", () => {
    const { sessions, segments } = mapRecords(
      {
        SleepSession: [
          {
            metadata: meta("fitbit"),
            startTime: at("2026-10-01", "23:00:00"),
            endTime: at("2026-10-02", "06:00:00"),
            stages: [
              stage("2026-10-01", "23:00:00", "23:20:00", AWAKE_IN_BED),
              { startTime: at("2026-10-01", "23:20:00"), endTime: at("2026-10-02", "03:00:00"), stage: LIGHT },
              stage("2026-10-02", "03:00:00", "03:05:00", SleepStageType.OUT_OF_BED),
              stage("2026-10-02", "03:05:00", "06:00:00", DEEP),
            ],
          },
        ],
      },
      TZ,
    );
    expect(sessions[0]).toMatchObject({ stagesStatus: "SUCCEEDED", awakeMin: 25, lightMin: 220, deepMin: 175, remMin: 0 });
    expect(segments.map((g) => g.stage)).toEqual(["awake", "light", "awake", "deep"]);
  });

  it("writes no segments for SLEEPING stages, counts non-awake stages as asleep, and uses the length without stages", () => {
    const { sessions, segments } = mapRecords(
      {
        SleepSession: [
          {
            metadata: meta("classic"),
            startTime: at("2026-10-01", "23:00:00"),
            endTime: at("2026-10-02", "05:00:00"),
            stages: [
              stage("2026-10-01", "23:00:00", "23:30:00", AWAKE),
              { startTime: at("2026-10-01", "23:30:00"), endTime: at("2026-10-02", "04:00:00"), stage: SLEEPING },
              stage("2026-10-02", "04:00:00", "05:00:00", LIGHT),
            ],
          },
          { metadata: meta("bare"), startTime: at("2026-10-03", "00:00:00"), endTime: at("2026-10-03", "07:30:00") },
        ],
      },
      TZ,
    );
    expect(segments).toEqual([]);
    expect(sessions[0]).toMatchObject({ id: "classic", stagesStatus: null, asleepMin: 330, awakeMin: 30, deepMin: null, lightMin: null, remMin: null });
    expect(sessions[1]).toMatchObject({ id: "bare", day: "2026-10-03", stagesStatus: null, asleepMin: 450, awakeMin: 0 });
  });

  it("keeps a staged night's stage minutes, without segments, when one stage is one Pulse can't place", () => {
    const { sessions, segments } = mapRecords(
      {
        SleepSession: [
          {
            metadata: meta("mixed"),
            startTime: at("2026-10-01", "23:00:00"),
            endTime: at("2026-10-02", "07:00:00"),
            stages: [
              { startTime: at("2026-10-01", "23:00:00"), endTime: at("2026-10-02", "00:00:00"), stage: LIGHT },
              stage("2026-10-02", "00:00:00", "01:30:00", DEEP),
              stage("2026-10-02", "01:30:00", "01:35:00", SleepStageType.UNKNOWN),
              stage("2026-10-02", "01:35:00", "05:00:00", LIGHT),
              stage("2026-10-02", "05:00:00", "06:50:00", REM),
              stage("2026-10-02", "06:50:00", "07:00:00", AWAKE),
            ],
          },
        ],
      },
      TZ,
    );
    expect(segments).toEqual([]);
    expect(sessions[0]).toMatchObject({ stagesStatus: "SUCCEEDED", asleepMin: 470, awakeMin: 10, lightMin: 265, deepMin: 90, remMin: 110 });
  });

  it("marks the longest session per wake day as main and drops sessions under 20 minutes", () => {
    const { sessions } = mapRecords(
      {
        SleepSession: [
          { metadata: meta("nap"), startTime: at("2026-10-02", "14:00:00"), endTime: at("2026-10-02", "14:45:00") },
          { metadata: meta("night"), startTime: at("2026-10-01", "23:30:00"), endTime: at("2026-10-02", "06:30:00") },
          { metadata: meta("blip"), startTime: at("2026-10-02", "16:00:00"), endTime: at("2026-10-02", "16:15:00") },
        ],
      },
      TZ,
    );
    expect(sessions.map((s) => [s.id, s.isMain])).toEqual([
      ["night", true],
      ["nap", false],
    ]);
  });
});

describe("heart rate", () => {
  it("floors to seconds, drops non-positive bpm, dedupes by second (last wins) and clips", () => {
    const records = [
      {
        metadata: meta("h1"),
        startTime: at("2026-10-02", "08:00:00"),
        endTime: at("2026-10-02", "08:01:00"),
        samples: [
          { time: "2026-10-02T02:30:00.400Z", beatsPerMinute: 60 },
          { time: "2026-10-02T02:30:00.900Z", beatsPerMinute: 62 },
          { time: "2026-10-02T02:30:05.000Z", beatsPerMinute: 0 },
          { time: "2026-10-02T02:30:10.000Z", beatsPerMinute: 64 },
        ],
      },
    ];
    const base = Date.parse("2026-10-02T02:30:00Z") / 1000;
    expect(mapHr(records)).toEqual([
      { ts: base, bpm: 62 },
      { ts: base + 10, bpm: 64 },
    ]);
    expect(mapHr(records, { startTs: base + 5, endTs: base + 60 })).toEqual([{ ts: base + 10, bpm: 64 }]);
  });
});

describe("steps", () => {
  const minute = (day: string, time: string) => sec(day, time);

  it("spreads a record evenly over the whole minutes it covers", () => {
    const steps = mapSteps([
      { metadata: meta("a"), startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "10:03:00"), count: 30 },
    ]);
    expect(steps).toEqual([
      { ts: minute("2026-10-02", "10:00:00"), v: 10 },
      { ts: minute("2026-10-02", "10:01:00"), v: 10 },
      { ts: minute("2026-10-02", "10:02:00"), v: 10 },
    ]);
  });

  it("takes the max across origins per minute but sums within one origin", () => {
    const steps = mapSteps([
      { metadata: meta("phone", "com.phone"), startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "10:01:00"), count: 40 },
      { metadata: meta("watch1", "com.watch"), startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "10:00:30"), count: 25 },
      { metadata: meta("watch2", "com.watch"), startTime: at("2026-10-02", "10:00:30"), endTime: at("2026-10-02", "10:01:00"), count: 25 },
      { metadata: meta("watch3", "com.watch"), startTime: at("2026-10-02", "10:01:00"), endTime: at("2026-10-02", "10:02:00"), count: 7 },
    ]);
    expect(steps).toEqual([
      { ts: minute("2026-10-02", "10:00:00"), v: 50 },
      { ts: minute("2026-10-02", "10:01:00"), v: 7 },
    ]);
  });

  it("takes the larger source's own total as the day's steps metric", () => {
    const { metrics } = mapRecords(
      {
        Steps: [
          { metadata: meta("p", "com.phone"), startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "10:02:00"), count: 100 },
          { metadata: meta("w", "com.watch"), startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "10:02:00"), count: 120 },
          // straddles local midnight: one minute each side
          { metadata: meta("m", "com.phone"), startTime: at("2026-10-02", "23:59:00"), endTime: at("2026-10-03", "00:01:00"), count: 10 },
        ],
      },
      TZ,
    );
    // 2026-10-02: phone 100 + 5, watch 120; 2026-10-03: phone 5.
    expect(metrics.map((m) => [m.day, m.steps])).toEqual([
      ["2026-10-02", 120],
      ["2026-10-03", 5],
    ]);
  });

  it("doesn't add a coarse source's spread-out steps to a fine source's (the per-minute maxima would read 1,150)", () => {
    // The band writes a 5-minute walk minute by minute (600 steps); the phone writes the same walk as one hourly record.
    const band = [0, 1, 2, 3, 4].map((i) => ({
      metadata: meta(`b${i}`, "com.band"),
      startTime: at("2026-10-02", `10:0${i}:00`),
      endTime: at("2026-10-02", `10:0${i + 1}:00`),
      count: 120,
    }));
    const phone = { metadata: meta("p", "com.phone"), startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "11:00:00"), count: 600 };
    const { metrics, steps } = mapRecords({ Steps: [...band, phone] }, TZ);
    expect(metrics.map((m) => [m.day, m.steps])).toEqual([["2026-10-02", 600]]);
    // The per-minute series (movement gating) still takes the max: 120 in the walk, the phone's 10 in the other 55.
    expect(steps).toHaveLength(60);
    expect(steps.reduce((a, s) => a + s.v, 0)).toBe(1150);
  });

  it("gives the derived minutes the largest source's minutes, so a coarse source can't spread steps into still minutes", () => {
    const band = [0, 1, 2, 3, 4].map((i) => ({
      metadata: meta(`b${i}`, "com.band"),
      startTime: at("2026-10-02", `10:0${i}:00`),
      endTime: at("2026-10-02", `10:0${i + 1}:00`),
      count: 120,
    }));
    const phone = { metadata: meta("p", "com.phone"), startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "11:00:00"), count: 590 };
    // The band (600) beats the phone (590): five minutes of 120, and the other 55 minutes stay still (the max across
    // sources gave each of them the phone's 9.8 steps, so all 60 minutes read as light).
    const mins = largestSourceSteps([...band, phone]);
    expect(mins).toEqual([0, 1, 2, 3, 4].map((i) => ({ ts: sec("2026-10-02", `10:0${i}:00`), v: 120 })));
    expect(mapSteps([...band, phone])).toHaveLength(60);
    // Clipped to a window, it is the source with the most steps inside it.
    expect(largestSourceSteps([...band, phone], { startTs: sec("2026-10-02", "10:30:00"), endTs: sec("2026-10-02", "11:00:00") })).toHaveLength(30);
    expect(largestSourceSteps([])).toEqual([]);
  });

  it("keeps an app's devices apart, as the web keys steps by device and package", () => {
    const device = (type: number) => ({ manufacturer: "Google", model: type === 2 ? "Pixel" : "Charge 6", type });
    const rec = (id: string, type: number, count: number) => ({
      metadata: { id, dataOrigin: "com.google.android.apps.fitness", device: device(type) },
      startTime: at("2026-10-02", "10:00:00"),
      endTime: at("2026-10-02", "10:10:00"),
      count,
    });
    const input = { Steps: [rec("phone", 2, 900), rec("band", 6, 1000)] };
    // One walk seen by the phone and the band: 1,000 steps, not 1,900.
    expect(mapRecords(input, TZ).metrics.map((m) => m.steps)).toEqual([1000]);
    expect(mapSteps(input.Steps).reduce((a, s) => a + s.v, 0)).toBe(1000);
  });
});

describe("metrics", () => {
  const night = {
    metadata: meta("night"),
    startTime: at("2026-10-01", "23:00:00"),
    endTime: at("2026-10-02", "06:00:00"),
    stages: [{ startTime: at("2026-10-01", "23:00:00"), endTime: at("2026-10-02", "06:00:00"), stage: SLEEPING }],
  };

  it("averages nightly readings inside the main sleep and takes the latest RHR / VO2max of the day", () => {
    const { metrics } = mapRecords(
      {
        SleepSession: [night],
        HeartRateVariabilityRmssd: [
          { metadata: meta("v0"), time: at("2026-10-01", "22:00:00"), heartRateVariabilityMillis: 99 }, // before sleep: ignored
          { metadata: meta("v1"), time: at("2026-10-02", "01:00:00"), heartRateVariabilityMillis: 40 },
          { metadata: meta("v2"), time: at("2026-10-02", "03:00:00"), heartRateVariabilityMillis: 50 },
        ],
        RestingHeartRate: [
          { metadata: meta("r1"), time: at("2026-10-02", "07:00:00"), beatsPerMinute: 55 },
          { metadata: meta("r2"), time: at("2026-10-02", "20:00:00"), beatsPerMinute: 53 },
        ],
        RespiratoryRate: [
          { metadata: meta("b1"), time: at("2026-10-02", "02:00:00"), rate: 14 },
          { metadata: meta("b2"), time: at("2026-10-02", "04:00:00"), rate: 15 },
          { metadata: meta("b3"), time: at("2026-10-02", "15:00:00"), rate: 20 }, // daytime: ignored when the night has readings
        ],
        OxygenSaturation: [{ metadata: meta("o1"), time: at("2026-10-02", "02:00:00"), percentage: 96.4 }],
        Vo2Max: [
          { metadata: meta("x1"), time: at("2026-10-02", "08:00:00"), vo2MillilitersPerMinuteKilogram: 41, measurementMethod: 0 },
          { metadata: meta("x2"), time: at("2026-10-02", "18:00:00"), vo2MillilitersPerMinuteKilogram: 42.26, measurementMethod: 0 },
        ],
      },
      TZ,
    );
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ day: "2026-10-02", hrvMs: 45, rhrBpm: 53, respBpm: 14.5, spo2Pct: 96.4, vo2maxDaily: 42.3, steps: null, calories: null });
  });

  it("splits VO2 max by Health Connect's measurement method: lab and field tests are measured, the rest estimates", () => {
    const v = (id: string, t: string, value: number, measurementMethod: number) => ({ metadata: meta(id), time: at("2026-10-02", t), vo2MillilitersPerMinuteKilogram: value, measurementMethod });
    const one = (records: ReturnType<typeof v>[]) => mapRecords({ Vo2Max: records }, TZ).metrics[0];
    // A metabolic cart (lab) and a Cooper test: measured, stored as vo2maxRun; the latest measured one wins.
    expect(one([v("m1", "08:00:00", 44.1, Vo2MaxMeasurementMethod.METABOLIC_CART), v("m2", "09:00:00", 45.04, Vo2MaxMeasurementMethod.COOPER_TEST)])).toMatchObject({ vo2maxRun: 45, vo2maxDaily: null });
    for (const m of [Vo2MaxMeasurementMethod.MULTISTAGE_FITNESS_TEST, Vo2MaxMeasurementMethod.ROCKPORT_FITNESS_TEST]) expect(one([v("m3", "08:00:00", 40, m)])).toMatchObject({ vo2maxRun: 40, vo2maxDaily: null });
    // Heart-rate ratio and "other" (a watch's estimate): vo2maxDaily.
    for (const m of [Vo2MaxMeasurementMethod.HEART_RATE_RATIO, Vo2MaxMeasurementMethod.OTHER]) expect(one([v("e1", "08:00:00", 38.2, m)])).toMatchObject({ vo2maxRun: null, vo2maxDaily: 38.2 });
    // Both on one day: each kept in its own column.
    expect(one([v("e2", "07:00:00", 37, Vo2MaxMeasurementMethod.OTHER), v("m4", "18:00:00", 43, Vo2MaxMeasurementMethod.METABOLIC_CART)])).toMatchObject({ vo2maxRun: 43, vo2maxDaily: 37 });
  });

  it("falls back to 00:00–12:00 for HRV and to the whole day for respiration and SpO2 without a main sleep", () => {
    const { metrics } = mapRecords(
      {
        HeartRateVariabilityRmssd: [
          { metadata: meta("v1"), time: at("2026-10-02", "03:00:00"), heartRateVariabilityMillis: 30 },
          { metadata: meta("v2"), time: at("2026-10-02", "14:00:00"), heartRateVariabilityMillis: 90 }, // afternoon: not nightly
        ],
        RespiratoryRate: [
          { metadata: meta("b1"), time: at("2026-10-02", "03:00:00"), rate: 12 },
          { metadata: meta("b2"), time: at("2026-10-02", "15:00:00"), rate: 16 },
        ],
      },
      TZ,
    );
    expect(metrics[0]).toMatchObject({ day: "2026-10-02", hrvMs: 30, respBpm: 14 });
  });

  it("builds skin temperature from baseline + mean delta, or deviation-only with a zero baseline", () => {
    const skin = (id: string, baseline: number | undefined, deltas: number[]) => ({
      metadata: meta(id),
      startTime: at("2026-10-01", "23:30:00"),
      endTime: at("2026-10-02", "05:30:00"),
      baseline: baseline === undefined ? undefined : { inCelsius: baseline, inFahrenheit: baseline * 1.8 + 32 },
      deltas: deltas.map((d, i) => ({ time: at("2026-10-02", `0${i}:00:00`), delta: { inCelsius: d, inFahrenheit: d * 1.8 } })),
    });
    const withBaseline = mapRecords({ SleepSession: [night], SkinTemperature: [skin("t1", 33.5, [0.2, 0.4])] }, TZ).metrics[0];
    expect(withBaseline).toMatchObject({ nightlyTempC: 33.8, tempBaselineC: 33.5, tempSdC: null });
    const deviationOnly = mapRecords({ SleepSession: [night], SkinTemperature: [skin("t2", undefined, [-0.3, -0.1])] }, TZ).metrics[0];
    expect(deviationOnly).toMatchObject({ nightlyTempC: -0.2, tempBaselineC: 0, tempSdC: null });
  });

  it("sums total calories per civil day, pro-rating records that span midnight", () => {
    const kcal = (id: string, from: string, to: string, v: number) => ({
      metadata: meta(id),
      startTime: from,
      endTime: to,
      energy: { inKilocalories: v, inCalories: v * 1000, inJoules: v * 4184, inKilojoules: v * 4.184 },
    });
    const { metrics } = mapRecords(
      {
        TotalCaloriesBurned: [
          kcal("c1", at("2026-10-02", "00:00:00"), at("2026-10-03", "00:00:00"), 2000),
          kcal("c2", at("2026-10-02", "22:00:00"), at("2026-10-03", "02:00:00"), 100), // half each side of midnight
        ],
      },
      TZ,
    );
    expect(metrics.map((m) => [m.day, m.calories])).toEqual([
      ["2026-10-02", 2050],
      ["2026-10-03", 50],
    ]);
  });
});

describe("exercises and daily values", () => {
  const len = (m: number) => ({ inMeters: m, inKilometers: m / 1000, inMiles: m / 1609.344, inInches: m * 39.3701, inFeet: m * 3.28084 });
  const energy = (v: number) => ({ inKilocalories: v, inCalories: v * 1000, inJoules: v * 4184, inKilojoules: v * 4.184 });

  it("names the type, sums overlapping active kcal and distance, and drops sessions under 2 minutes", () => {
    const { exercises, dailyValues } = mapRecords(
      {
        ExerciseSession: [
          { metadata: meta("run"), startTime: at("2026-10-02", "07:00:00"), endTime: at("2026-10-02", "07:30:00"), exerciseType: ExerciseType.RUNNING, title: "Morning run" },
          { metadata: meta("short"), startTime: at("2026-10-02", "09:00:00"), endTime: at("2026-10-02", "09:01:30"), exerciseType: ExerciseType.WALKING },
          { metadata: meta("odd"), startTime: at("2026-10-02", "18:00:00"), endTime: at("2026-10-02", "18:20:00"), exerciseType: 9999, title: "  " },
        ],
        ActiveCaloriesBurned: [
          { metadata: meta("a1"), startTime: at("2026-10-02", "07:00:00"), endTime: at("2026-10-02", "07:15:00"), energy: energy(150) },
          { metadata: meta("a2"), startTime: at("2026-10-02", "07:15:00"), endTime: at("2026-10-02", "07:45:00"), energy: energy(200) }, // half inside
          { metadata: meta("a3"), startTime: at("2026-10-02", "12:00:00"), endTime: at("2026-10-02", "12:15:00"), energy: energy(30) },
        ],
        Distance: [
          { metadata: meta("d1"), startTime: at("2026-10-02", "07:00:00"), endTime: at("2026-10-02", "07:30:00"), distance: len(5000) },
          { metadata: meta("d2"), startTime: at("2026-10-03", "08:00:00"), endTime: at("2026-10-03", "08:10:00"), distance: len(800) },
        ],
      },
      TZ,
    );
    expect(exercises).toHaveLength(2);
    expect(exercises[0]).toMatchObject({ id: "run", day: "2026-10-02", type: "RUNNING", name: "Morning run", calories: 250, distanceM: 5000 });
    expect(exercises[1]).toMatchObject({ id: "odd", type: "OTHER_WORKOUT", name: null, calories: null, distanceM: null });
    expect(dailyValues).toEqual([
      { day: "2026-10-02", key: "active_calories", value: 380 },
      { day: "2026-10-02", key: "distance", value: 5 },
      { day: "2026-10-03", key: "distance", value: 0.8 },
    ]);
  });

  it("takes the largest source for measured totals instead of adding a band's and a phone's", () => {
    const src = (id: string, dataOrigin: string) => ({ id, dataOrigin });
    const day = { startTime: at("2026-10-02", "00:00:00"), endTime: at("2026-10-03", "00:00:00") };
    const walk = { startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "11:00:00") };
    const { metrics, exercises, dailyValues } = mapRecords(
      {
        TotalCaloriesBurned: [
          { metadata: src("t1", "com.band"), ...day, energy: energy(2400) },
          { metadata: src("t2", "com.phone"), ...day, energy: energy(2300) },
        ],
        ActiveCaloriesBurned: [
          { metadata: src("a1", "com.band"), ...walk, energy: energy(300) },
          { metadata: src("a2", "com.phone"), ...walk, energy: energy(280) },
        ],
        Distance: [
          { metadata: src("d1", "com.band"), ...walk, distance: len(5000) },
          { metadata: src("d2", "com.phone"), ...walk, distance: len(5200) },
        ],
        ExerciseSession: [{ metadata: src("w", "com.band"), ...walk, exerciseType: ExerciseType.WALKING }],
      },
      TZ,
    );
    // Summed, these read 4,700 kcal, 580 active kcal and 10.2 km for one day with one 5 km walk.
    expect(metrics.map((m) => m.calories)).toEqual([2400]);
    expect(dailyValues).toEqual([
      { day: "2026-10-02", key: "active_calories", value: 300 },
      { day: "2026-10-02", key: "distance", value: 5.2 },
    ]);
    expect(exercises[0]).toMatchObject({ calories: 300, distanceM: 5200 });
  });

  it("reverse-maps exercise codes to the library's names", () => {
    expect(exerciseTypeName(56)).toBe("RUNNING");
    expect(exerciseTypeName(83)).toBe("YOGA");
    expect(exerciseTypeName(45)).toBe("OTHER_WORKOUT"); // 45 is unassigned in Health Connect
  });
});

describe("weight and body fat", () => {
  it("keeps the latest reading of each local day", () => {
    const { metrics } = mapRecords(
      {
        Weight: [
          { metadata: meta("w1"), time: at("2026-10-01", "07:00:00"), weight: { inKilograms: 80.04 } },
          { metadata: meta("w2"), time: at("2026-10-01", "20:00:00"), weight: { inKilograms: 80.46 } },
          { metadata: meta("w3"), time: at("2026-10-02", "07:00:00"), weight: { inKilograms: 79.9 } },
        ] as never,
        BodyFat: [{ metadata: meta("f1"), time: at("2026-10-02", "07:00:00"), percentage: 18.44 }] as never,
      },
      TZ,
    );
    expect(metrics.map((m) => [m.day, m.weightKg, m.bodyFatPct])).toEqual([
      ["2026-10-01", 80.5, null],
      ["2026-10-02", 79.9, 18.4],
    ]);
  });
});

describe("extras and the Fitbit log", () => {
  const len = (m: number) => ({ inMeters: m, inKilometers: m / 1000, inMiles: m / 1609.344, inInches: m * 39.3701, inFeet: m * 3.28084 });
  const energy = (v: number) => ({ inKilocalories: v, inCalories: v * 1000, inJoules: v * 4184, inKilojoules: v * 4.184 });
  const vol = (ml: number) => ({ inMilliliters: ml, inLiters: ml / 1000, inFluidOuncesUs: ml / 29.5735 });
  const mass = (g: number) => ({ inGrams: g, inKilograms: g / 1000, inMilligrams: g * 1000, inMicrograms: g * 1e6, inOunces: g / 28.3495, inPounds: g / 453.592 });
  const glucose = (id: string, time: string, mgdl: number) => ({ metadata: meta(id), time, level: { inMilligramsPerDeciliter: mgdl, inMillimolesPerLiter: mgdl / 18 }, specimenSource: 0, mealType: 0, relationToMeal: 0 });
  const temp = (id: string, time: string, c: number) => ({ metadata: meta(id), time, temperature: { inCelsius: c, inFahrenheit: c * 1.8 + 32 } });
  const input = {
    FloorsClimbed: [
      { metadata: meta("f1"), startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "10:05:00"), floors: 3 },
      { metadata: meta("f2"), startTime: at("2026-10-02", "23:00:00"), endTime: at("2026-10-03", "01:00:00"), floors: 4 }, // half each side of midnight
    ],
    ElevationGained: [{ metadata: meta("e1"), startTime: at("2026-10-02", "10:00:00"), endTime: at("2026-10-02", "11:00:00"), elevation: len(12.5) }],
    Hydration: [
      { metadata: meta("h1"), startTime: at("2026-10-02", "08:00:00"), endTime: at("2026-10-02", "08:00:00"), volume: vol(250) },
      { metadata: meta("h2"), startTime: at("2026-10-02", "15:00:00"), endTime: at("2026-10-02", "15:00:00"), volume: vol(500) },
    ],
    Nutrition: [
      {
        metadata: meta("n1"),
        startTime: at("2026-10-02", "13:00:00"),
        endTime: at("2026-10-02", "13:00:00"),
        mealType: MealType.LUNCH,
        name: " Dal and rice ",
        energy: energy(600),
        protein: mass(30),
        totalCarbohydrate: mass(0), // the bridge sends 0 for a nutrient the log lacks
        totalFat: mass(12.5),
      },
    ],
    BloodGlucose: [glucose("g1", at("2026-10-02", "07:00:00"), 90), glucose("g2", at("2026-10-02", "19:00:00"), 110)],
    BodyTemperature: [temp("t1", at("2026-10-02", "07:00:00"), 36.6), temp("t2", at("2026-10-02", "19:00:00"), 36.9)],
  };

  it("writes the catalogue's keys per local day: sums pro-rated over midnight, spot readings averaged", () => {
    expect(mapRecords(input, TZ).dailyValues).toEqual([
      { day: "2026-10-02", key: "calories_in", value: 600 },
      { day: "2026-10-02", key: "core_temp", value: 36.75 },
      { day: "2026-10-02", key: "elevation", value: 12.5 },
      { day: "2026-10-02", key: "fat", value: 12.5 },
      { day: "2026-10-02", key: "floors", value: 5 },
      { day: "2026-10-02", key: "glucose", value: 100 },
      { day: "2026-10-02", key: "protein", value: 30 },
      { day: "2026-10-02", key: "water", value: 750 },
      { day: "2026-10-03", key: "floors", value: 2 },
    ]);
  });

  it("turns water and food records into read-only log entries with Health Connect's ids", () => {
    const entries = mapExternalEntries(input, TZ);
    expect(entries.every((e) => e.source === "health_connect" && e.createdAt === e.ts)).toBe(true);
    expect(entries).toMatchObject([
      { id: "hc-water-h1", type: "hydration-log", ts: sec("2026-10-02", "08:00:00"), day: "2026-10-02", data: { ml: 250 } },
      { id: "hc-food-n1", type: "nutrition-log", ts: sec("2026-10-02", "13:00:00"), day: "2026-10-02", data: { name: "Dal and rice", meal: "LUNCH", kcal: 600, protein: 30, carbs: null, fat: 12.5 } },
      { id: "hc-water-h2", type: "hydration-log", data: { ml: 500 } },
    ]);
  });

  it("skips an empty food record, names an unknown meal, and falls back to a time-based id", () => {
    const entries = mapExternalEntries(
      {
        Nutrition: [
          { startTime: at("2026-10-02", "09:00:00"), endTime: at("2026-10-02", "09:00:00"), mealType: MealType.UNKNOWN, energy: energy(0) },
          { startTime: at("2026-10-02", "09:30:00"), endTime: at("2026-10-02", "09:30:00"), mealType: MealType.UNKNOWN, energy: energy(120) },
        ],
      },
      TZ,
    );
    expect(entries).toMatchObject([{ id: `hc-food-${sec("2026-10-02", "09:30:00")}`, data: { name: null, meal: "UNKNOWN", kcal: 120, protein: null, carbs: null, fat: null } }]);
  });

  it("maps periods (with their heaviest flow), runs of flow days, spotting and ovulation tests", () => {
    const flow = (day: string, f: number) => ({ metadata: meta(`fl-${day}`), time: at(day, "08:00:00"), flow: f });
    const entries = mapExternalEntries(
      {
        // Health Connect's record is an interval ending at midnight: Sep 28 to Oct 1 inclusive.
        MenstruationPeriod: [{ metadata: meta("p1"), startTime: at("2026-09-28", "00:00:00"), endTime: at("2026-10-02", "00:00:00") }],
        MenstruationFlow: [
          flow("2026-09-29", MenstruationFlow.HEAVY),
          flow("2026-09-30", MenstruationFlow.LIGHT),
          flow("2026-10-05", MenstruationFlow.MEDIUM), // no period record: consecutive flow days make one
          flow("2026-10-06", MenstruationFlow.LIGHT),
          flow("2026-10-08", MenstruationFlow.UNKNOWN),
        ],
        IntermenstrualBleeding: [{ metadata: meta("b1"), time: at("2026-10-10", "09:00:00") }],
        OvulationTest: [{ metadata: meta("o1"), time: at("2026-10-12", "07:00:00"), result: OvulationTestResult.HIGH }],
      },
      TZ,
    );
    expect(entries).toMatchObject([
      { id: "hc-period-p1", type: "menstrual-period", ts: localMidnight("2026-09-28", TZ), day: "2026-09-28", data: { start: "2026-09-28", end: "2026-10-01", flow: "HEAVY" } },
      { id: "hc-period-2026-10-05", type: "menstrual-period", day: "2026-10-05", data: { start: "2026-10-05", end: "2026-10-06", flow: "MEDIUM" } },
      { id: "hc-period-2026-10-08", type: "menstrual-period", day: "2026-10-08", data: { start: "2026-10-08", end: "2026-10-08", flow: null } },
      { id: "hc-spotting-b1", type: "menstrual-period", ts: sec("2026-10-10", "09:00:00"), day: "2026-10-10", data: { start: "2026-10-10", end: "2026-10-10", flow: "SPOTTING", spotting: true } },
      { id: "hc-ovulation-o1", type: "ovulation-test", ts: sec("2026-10-12", "07:00:00"), day: "2026-10-12", data: { result: "ESTROGEN_SURGE" } },
    ]);
    // The library's instantaneous shape (`time` only) is a one-day period too.
    expect(mapExternalEntries({ MenstruationPeriod: [{ metadata: meta("p2"), time: at("2026-10-20", "00:00:00") }] }, TZ)).toMatchObject([
      { id: "hc-period-p2", data: { start: "2026-10-20", end: "2026-10-20", flow: null } },
    ]);
  });
});

describe("empty input", () => {
  it("maps to empty lists", () => {
    expect(mapRecords({}, TZ)).toEqual({ metrics: [], sessions: [], segments: [], exercises: [], hr: [], hrv: [], steps: [], dailyValues: [], externalEntries: [], bloodPressure: [] });
  });
});

describe("mapHrv", () => {
  it("keeps every HRV sample, one per second, in time order (the Pulse engine labels each)", async () => {
    const { mapHrv } = await import("./import");
    const rec = (time: string, ms: number) => ({ time, heartRateVariabilityMillis: ms }) as never;
    expect(
      mapHrv([rec("2026-10-10T01:05:00Z", 40), rec("2026-10-10T01:00:00Z", 38), rec("2026-10-10T01:00:00.400Z", 39), rec("2026-10-10T01:10:00Z", 0)]),
    ).toEqual([
      { ts: ts("2026-10-10T01:00:00Z"), ms: 39 },
      { ts: ts("2026-10-10T01:05:00Z"), ms: 40 },
    ]);
  });
});
