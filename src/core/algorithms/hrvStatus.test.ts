import { describe, expect, it } from "vitest";
import { hrvStatus, hrvStatusConfig } from "./hrvStatus";

/** 60 baseline nights alternating ±k around `ms` (σ_ln ≈ k), then a week at `week`. */
const history = (ms: number, sdLn: number, week: number | null, weekNights = 7) => [
  ...Array.from({ length: 60 }, (_, i) => ms * Math.exp(i % 2 ? sdLn : -sdLn)),
  ...Array.from({ length: weekNights }, () => week),
];

describe("HRV Status (Garmin-style, on ln RMSSD)", () => {
  it("a flat 50 ms history with last week at 50 is Balanced", () => {
    const r = hrvStatus(history(50, 0, 50));
    expect(r.status).toBe("balanced");
    if (r.status === null) throw new Error("no status");
    expect(r.weekAverage).toBeCloseTo(50, 9);
    // σ is floored, so the band still has width.
    expect(r.band.low).toBeLessThan(50);
    expect(r.band.high).toBeGreaterThan(50);
  });

  it("last week at 30 ms against 50 with σ_ln 0.15 is Low", () => {
    const r = hrvStatus(history(50, 0.15, 30));
    expect(r.status).toBe("low");
  });

  it("last week at 70 is Unbalanced, above the band; a mild dip is Unbalanced, below it", () => {
    const high = hrvStatus(history(50, 0.15, 70));
    expect(high).toMatchObject({ status: "unbalanced", direction: "high" });
    // 50 · e^(−0.15) ≈ 43: under μ − 0.75σ, above μ − 1.5σ.
    expect(hrvStatus(history(50, 0.15, 43))).toMatchObject({ status: "unbalanced", direction: "low" });
  });

  it("the band is e^(μ ± 0.75σ) and the Low line e^(μ − 1.5σ), in ms", () => {
    const r = hrvStatus(history(50, 0.15, 50));
    if (r.status === null) throw new Error("no status");
    // 60 nights at ±0.15: sample SD 0.15 · √(60 / 59).
    const sd = 0.15 * Math.sqrt(60 / 59);
    expect(r.band.low).toBeCloseTo(50 * Math.exp(-0.75 * sd), 9);
    expect(r.band.high).toBeCloseTo(50 * Math.exp(0.75 * sd), 9);
    expect(r.lowLine).toBeCloseTo(50 * Math.exp(-1.5 * sd), 9);
  });

  it("reads a status from 21 nights (14 for the baseline, the week's 7), and needs 4 of the last 7", () => {
    const short = Array(20).fill(50);
    expect(hrvStatus(short)).toMatchObject({ status: null, reason: "building", baselineNights: 13 });
    expect(hrvStatus(Array(21).fill(50)).status).toBe("balanced");
    const gappy = [...Array(30).fill(50), 50, null, 50, null, 50, null, null];
    expect(hrvStatus(gappy)).toMatchObject({ status: null, reason: "no_recent" });
    expect(hrvStatusConfig.minBaselineNights).toBe(14);
  });

  it("uses only the 60 nights before the last 7 for the baseline", () => {
    const old = Array(40).fill(20); // long ago: ignored
    const r = hrvStatus([...old, ...history(50, 0.1, 50)]);
    expect(r.status).toBe("balanced");
  });
});
