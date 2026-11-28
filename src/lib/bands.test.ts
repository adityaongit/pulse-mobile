import { describe, expect, it } from "vitest";
import { acwrBand, acwrSignal } from "@/core/scoring/readiness";
import { acwrTone, deltaTone, dialColor, GOOD_DIRECTION, partColor, recoveryBand, stressLevel } from "./bands";

describe("partColor", () => {
  it("draws blood pressure as Health Monitor does: systolic rose, diastolic blue", () => {
    expect(partColor("systolic")).toBe("var(--bp-systolic)");
    expect(partColor("diastolic")).toBe("var(--bp-diastolic)");
  });
});

describe("recoveryBand", () => {
  it("bands at 67 and 34", () => {
    expect(recoveryBand(67)).toBe("green");
    expect(recoveryBand(66.9)).toBe("yellow");
    expect(recoveryBand(34)).toBe("yellow");
    expect(recoveryBand(33.9)).toBe("red");
    expect(recoveryBand(0)).toBe("red");
    expect(recoveryBand(100)).toBe("green");
  });
});

describe("dialColor", () => {
  it("bands Recovery, never Strain or Sleep", () => {
    expect(dialColor("recovery", 80)).toBe("recovery-green");
    expect(dialColor("recovery", 20)).toBe("recovery-red");
    for (const v of [0, 5, 14, 21]) expect(dialColor("strain", v)).toBe("strain");
    for (const v of [10, 50, 90]) expect(dialColor("sleep", v)).toBe("sleep");
  });
});

describe("deltaTone", () => {
  it("HRV 8% above average is good", () => {
    expect(deltaTone(GOOD_DIRECTION.hrv, 108, 100, 5)).toEqual({ dir: "up", tone: "good" });
  });
  it("resting HR 3 bpm above average is bad", () => {
    expect(deltaTone(GOOD_DIRECTION.resting_hr, 52, 49, 2)).toEqual({ dir: "up", tone: "bad" });
    expect(deltaTone(GOOD_DIRECTION.resting_hr, 45, 49, 2)).toEqual({ dir: "down", tone: "good" });
  });
  it("inside ±1 σ is neutral", () => {
    expect(deltaTone("up", 104, 100, 5)).toEqual({ dir: "flat", tone: "neutral" });
    expect(deltaTone("down", 95, 100, 5)).toEqual({ dir: "flat", tone: "neutral" });
  });
  it("neutral metrics keep the arrow but never a tone", () => {
    expect(deltaTone(GOOD_DIRECTION.strain, 16, 14.5, 0.5)).toEqual({ dir: "up", tone: "neutral" });
  });
  it("a rise in respiratory rate is bad, as the reference app colours it (spec §11 R34)", () => {
    expect(deltaTone(GOOD_DIRECTION.respiratory_rate, 16, 14.5, 0.5)).toEqual({ dir: "up", tone: "bad" });
  });
  it("skin temperature is good toward zero", () => {
    expect(deltaTone("toward_zero", 0.1, 0.6, 0.2).tone).toBe("good");
    expect(deltaTone("toward_zero", -0.9, -0.2, 0.2).tone).toBe("bad");
  });
});

describe("stress and training load", () => {
  it("stress levels at 30 and 60", () => {
    expect(stressLevel(29)).toBe("low");
    expect(stressLevel(30)).toBe("medium");
    expect(stressLevel(59)).toBe("medium");
    expect(stressLevel(60)).toBe("high");
  });
  it("ACWR tones", () => {
    expect(acwrTone(0.7)).toBe("neutral");
    expect(acwrTone(1.1)).toBe("optimal");
    expect(acwrTone(1.6)).toBe("warning");
    expect(acwrTone(2.1)).toBe("alert");
  });
  it("ACWR tone and the Reports band agree at the boundaries", () => {
    const cases = [
      [0.79, "neutral", "LOAD_RAMPING_DOWN"],
      [0.8, "optimal", "LOAD_SWEET_SPOT"],
      [1.49, "optimal", "LOAD_SWEET_SPOT"],
      [1.5, "warning", "LOAD_BUILDING_FAST"],
      [1.99, "warning", "LOAD_BUILDING_FAST"],
      [2.0, "alert", "LOAD_SPIKING"],
    ] as const;
    for (const [acwr, tone, band] of cases) {
      expect(acwrTone(acwr), String(acwr)).toBe(tone);
      expect(acwrBand(acwr), String(acwr)).toBe(band);
      expect(acwrSignal(acwr, 0, 0).detail, String(acwr)).toBe(band);
    }
  });
});
