import { describe, expect, it } from "vitest";
import { activityView, kcalPerMin, strainWord, withoutSpikes, zonePosition } from "./activityView";
import type { WorkoutSample } from "./workout";

const sample = (seq: number, sec: number, bpm: number, epoch = 0): WorkoutSample => ({ seq, t: 1_000_000 + sec * 1000, elapsedMs: sec * 1000, bpm, epoch, rrMs: [] });
const setup = { restingHr: 60, maxHr: 190, base: null, sex: "male" };
const body = { age: 30, weightKg: 80, sex: "male" as const };

describe("kcalPerMin", () => {
  it("follows Keytel 2005 and never goes below zero", () => {
    expect(kcalPerMin(150, body)).toBeCloseTo((-55.0969 + 0.6309 * 150 + 0.1988 * 80 + 0.2017 * 30) / 4.184, 6);
    expect(kcalPerMin(150, { ...body, sex: "female" })).toBeCloseTo((-20.4022 + 0.4472 * 150 - 0.1263 * 80 + 0.074 * 30) / 4.184, 6);
    expect(kcalPerMin(40, body)).toBe(0);
  });
});

describe("activityView", () => {
  it("counts heart rate, calories and Strain over a run", () => {
    const run = Array.from({ length: 61 }, (_, i) => sample(i + 1, i * 5, 150));
    const v = activityView(run, setup, body);
    expect(v.avgHr).toBe(150);
    expect(v.maxHr).toBe(150);
    expect(v.kcal).toBe(Math.round(kcalPerMin(150, body) * 5));
    expect(v.activityStrain).toBeGreaterThan(0);
    expect(v.dayNow).toBeGreaterThanOrEqual(v.activityStrain);
    expect(v.zoneSeconds.reduce((a, b) => a + b, 0)).toBe(300);
  });

  it("credits nothing across a pause or a long gap", () => {
    const paused = activityView([sample(1, 0, 150), sample(2, 5, 150), sample(3, 10, 150, 1), sample(4, 15, 150, 1)], setup, body);
    expect(paused.zoneSeconds.reduce((a, b) => a + b, 0)).toBe(10);
    const gap = activityView([sample(1, 0, 150), sample(2, 60, 150)], setup, body);
    expect(gap.zoneSeconds.reduce((a, b) => a + b, 0)).toBe(0);
    expect(gap.kcal).toBe(0);
  });

  it("leaves calories unknown without the body figures", () => {
    expect(activityView([sample(1, 0, 150), sample(2, 5, 150)], setup, null).kcal).toBeNull();
  });
});

describe("zonePosition", () => {
  it("places the dot inside its zone", () => {
    // max 190: zones start at 95, 114, 133, 152, 171; zone 0 starts at 40 % (76).
    expect(zonePosition(76, 190)).toEqual({ zone: 0, at: 0 });
    expect(zonePosition(123.5, 190)).toEqual({ zone: 2, at: 0.5 });
    expect(zonePosition(200, 190)).toEqual({ zone: 5, at: 1 });
  });
});

describe("strainWord", () => {
  it("compares the day with the target, else names the activity's band", () => {
    expect(strainWord(10, 30, [40, 60])).toBe("restorative");
    expect(strainWord(10, 50, [40, 60])).toBe("optimal");
    expect(strainWord(10, 70, [40, 60])).toBe("overreaching");
    expect(strainWord(40, 90, null)).toBe("light");
    expect(strainWord(55, 90, null)).toBe("moderate");
    expect(strainWord(70, 90, null)).toBe("strenuous");
    expect(strainWord(85, 90, null)).toBe("allOut");
  });
});

describe("withoutSpikes", () => {
  it("drops a lone reading far from both neighbours, and keeps real changes", () => {
    const spike = [sample(1, 0, 80), sample(2, 1, 160), sample(3, 2, 82)];
    expect(withoutSpikes(spike).map((s) => s.bpm)).toEqual([80, 82]);
    const first = [sample(1, 0, 160), sample(2, 1, 80), sample(3, 2, 81)];
    expect(withoutSpikes(first).map((s) => s.bpm)).toEqual([80, 81]);
    const climb = [sample(1, 0, 80), sample(2, 1, 100), sample(3, 2, 120)];
    expect(withoutSpikes(climb)).toHaveLength(3);
    expect(activityView(spike, setup, body).maxHr).toBe(82);
  });
});
