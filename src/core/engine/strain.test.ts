import { describe, expect, it } from "vitest";
import {
  dayStrain,
  epoc,
  hrRecovery,
  loadConfidence,
  loadStatus,
  loadStep,
  segmentsOf,
  strainRing,
  targetBase,
  targetRange,
  trimp,
  units,
  weight,
  zoneBoundsError,
  zoneOf,
  zonesOf,
} from "./strain";

const z = zonesOf(190);

describe("zones and weights", () => {
  it("zones on % of max HR", () => expect(z.lowest).toEqual([95, 114, 133, 152, 171]));
  it("interpolates each zone's weights", () => {
    expect(weight(47.5, z)).toBe(0.5);
    expect(weight(95, z)).toBe(2);
    expect(weight(133, z)).toBe(4);
    expect(weight(142.5, z)).toBe(5.5);
    expect(weight(190, z)).toBe(20);
    expect(zoneOf(200, z)).toBe(5);
  });
  it("segments run start to start, capped; the passive pool drops zone 0", () => {
    const segs = segmentsOf([{ ts: 0, bpm: 90 }, { ts: 60, bpm: 120 }, { ts: 4000, bpm: 100 }], 1800);
    expect(segs).toEqual([{ bpm: 90, seconds: 60 }, { bpm: 120, seconds: 1800 }]);
    expect(units(segs, z, true)).toBeCloseTo(weight(120, z) * 1800);
    expect(units(segs, z)).toBeCloseTo(weight(90, z) * 60 + weight(120, z) * 1800);
  });
});

describe("the person's own zones", () => {
  const own = [100, 125, 140, 155, 170];
  it("uses own lower bounds in bpm, and the weights follow them", () => {
    const mine = zonesOf(190, own);
    expect(mine).toEqual({ lowest: own, maxHr: 190 });
    expect([99, 100, 124, 125, 139, 140, 154, 155, 169, 170].map((hr) => zoneOf(hr, mine))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
    expect(weight(100, mine)).toBe(2);
    expect(weight(140, mine)).toBe(4);
    expect(weight(147.5, mine)).toBe(5.5);
    expect(weight(190, mine)).toBe(20);
    // 120 bpm is zone 2 on the defaults (from 114) but zone 1 here.
    expect(weight(120, mine)).toBeLessThan(weight(120, z));
  });
  it("keeps today's zones without own bounds or with malformed ones", () => {
    expect(zonesOf(190, null)).toEqual(z);
    expect(zonesOf(190, [100, 120, 140, 160])).toEqual(z);
    expect(zonesOf(190, [100, 120, 120, 160, 180])).toEqual(z);
    expect(zonesOf(190, [30, 120, 140, 160, 180])).toEqual(z);
    expect(zonesOf(190, [100, 120.5, 140, 160, 180])).toEqual(z);
  });
  it("zone 5 runs one bpm past its own start when max HR is lower", () => expect(zonesOf(180, [100, 120, 140, 160, 185]).maxHr).toBe(186));
  it("says why bounds can't be zones", () => {
    expect(zoneBoundsError(own, 190)).toBeNull();
    expect(zoneBoundsError([100, 120], 190)).toBe("count");
    expect(zoneBoundsError([39, 120, 140, 160, 180], 190)).toBe("range");
    expect(zoneBoundsError([100, 120, 240, 250, 260])).toBe("range");
    expect(zoneBoundsError([100, 140, 120, 160, 180], 190)).toBe("order");
    expect(zoneBoundsError([100, 120, 140, 160, 190], 190)).toBe("max");
    expect(zoneBoundsError([100, 120, 140, 160, 190])).toBeNull();
  });
});

describe("Daily Strain, a percent", () => {
  it("16·atan(steps/7000) + 66·atan(U/20000)", () => {
    expect(dayStrain(7000, 20000)).toBeCloseTo((82 * Math.PI) / 4);
    expect(dayStrain(0, 0)).toBe(0);
    expect(dayStrain(1e9, 1e12)).toBeCloseTo((82 * Math.PI) / 2, 2);
  });
  it("the ring is full at 100 and stays full above it (fix 2)", () => {
    expect(strainRing(42)).toBe(0.42);
    expect(strainRing(112)).toBe(1);
  });
});

describe("TRIMP", () => {
  it("golden: an hour at 100 of a 140 bpm reserve, male", () => {
    const x = 100 / 140;
    expect(trimp([{ bpm: 150, seconds: 3600 }], 50, 190, "male")).toBeCloseTo(0.64 * Math.exp(1.92 * x) * x * 60, 10);
    expect(trimp([{ bpm: 40, seconds: 3600 }], 50, 190, "female")).toBe(0);
    expect(trimp([{ bpm: 150, seconds: 60 }], null, 190, "male")).toBeNull();
  });
  it("sums in doubles in time order (fix 16, fix 18): not a Float32 value", () => {
    const t = trimp([{ bpm: 131, seconds: 37 }, { bpm: 163, seconds: 59 }], 55, 188, "male")!;
    expect(t).not.toBe(Math.fround(t));
  });
});

describe("EPOC", () => {
  it("decays below resting HR instead of growing (fix 1)", () => {
    const e = epoc([{ bpm: 190, seconds: 600 }, { bpm: 40, seconds: 600 }], 50, 190);
    expect(e.peak).toBeCloseTo(0.3 * Math.exp(4 * 0.6) * 10);
    expect(e.final).toBeLessThan(e.peak);
    // The source added 5 % a minute here and credited it to low aerobic.
    expect(e.focus.lowAerobic).toBe(0);
    expect(e.focus.anaerobic).toBeCloseTo(e.peak);
  });
  it("holds between rest and 40 % of the reserve", () => {
    const e = epoc([{ bpm: 190, seconds: 60 }, { bpm: 90, seconds: 600 }], 50, 190);
    expect(e.final).toBe(e.peak);
  });
});

describe("heart-rate recovery", () => {
  const xs = [
    { ts: 0, bpm: 150 },
    { ts: 100, bpm: 175 },
    { ts: 160, bpm: 160 },
    { ts: 220, bpm: 140 },
    { ts: 400, bpm: 120 },
  ];
  it("the largest drop within 120 s from a reading at or before the active end", () => {
    expect(hrRecovery(xs, 100, z)).toEqual({ drop: 35, startHr: 175, endHr: 140, startTs: 100, endTs: 220 });
  });
  it("none below zone 4, or with too few readings", () => {
    expect(hrRecovery(xs.map((x) => ({ ...x, bpm: x.bpm - 40 })), 100, z)).toBeNull();
    expect(hrRecovery(xs.slice(0, 1), 100, z)).toBeNull();
  });
});

describe("Cardio Load", () => {
  it("ATL α 0.25, CTL α 2/43 from zero", () => {
    expect(loadStep({ atl: 0, ctl: 0 }, 100)).toEqual({ atl: 25, ctl: 200 / 43 });
  });
  it("confidence: density and recency", () => {
    expect(loadConfidence([], 0)).toBe(0);
    expect(loadConfidence([10, 10, 10, 10, 0], 28)).toBeCloseTo(Math.min(1, 0.25 * (1 + 0.9375 + 0.875 + 0.8125)));
  });
  it("status", () => {
    const s = (atl: number, ctl: number, trend: number | null, recovery: number | null = 60) => loadStatus({ atl, ctl, confidence: 1, ctlTrendPct: trend, recovery });
    expect(loadStatus({ atl: 1, ctl: 1, confidence: 0.3, ctlTrendPct: null, recovery: null })).toBe("calibrating");
    expect(s(150, 100, null)).toBe("overtraining");
    expect(s(120, 100, null)).toBe("productive");
    expect(s(120, 100, null, 10)).toBe("fatigued");
    expect(s(90, 100, 6)).toBe("peaking");
    expect(s(90, 100, -6)).toBe("detraining");
    expect(s(90, 100, 0)).toBe("maintaining");
  });
});

describe("Target Strain", () => {
  it("the study's worked ranges for a base of 60", () => {
    expect(targetRange(60, 50)).toEqual({ low: 52.5, high: 80 });
    expect(targetRange(60, 100)).toEqual({ low: 68, high: 108 });
    const r0 = targetRange(60, 0);
    expect(r0.low).toBeCloseTo(37);
    expect(r0.high).toBeCloseTo(52);
    expect(targetRange(targetBase([]), null)).toEqual({ low: 20, high: 40 });
  });
  it("the base folds the last 14 days, a missing day as 0", () => {
    expect(targetBase([40])).toBe(40);
    expect(targetBase(Array(20).fill(50))).toBeCloseTo(50);
    expect(targetBase([50, null])).toBeCloseTo((50 * 0.75 + 50 * 0.25) * 0.75);
  });
});
