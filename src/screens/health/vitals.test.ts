// Pulse's VitalTiles.test.tsx: each vital opens its full detail, preserving the selected day.
import { describe, expect, it } from "vitest";
import { isDetailKey } from "@/queries/metric";
import type { VitalKey } from "@/queries/types";
import { vitalHref } from "./vitals";

const keys: VitalKey[] = ["resp", "spo2", "restingHr", "hrv", "skinTempDev", "bp"];

describe("metric destinations", () => {
  it("opens each Health Monitor vital's full detail, preserving the selected day", () => {
    expect(keys.map((k) => vitalHref(k, "2026-10-03", "2026-10-07"))).toEqual([
      "/metric/resp?d=2026-10-03",
      "/metric/spo2?d=2026-10-03",
      "/metric/rhr?d=2026-10-03",
      "/metric/hrv?d=2026-10-03",
      "/metric/skin?d=2026-10-03",
      "/metric/bp?d=2026-10-03",
    ]);
  });
  it("opens a metric that has a screen", () => {
    for (const k of keys) expect(isDetailKey(vitalHref(k, "2026-10-07", "2026-10-07").replace("/metric/", ""))).toBe(true);
  });
  it("leaves the day out for today", () => {
    expect(vitalHref("hrv", "2026-10-07", "2026-10-07")).toBe("/metric/hrv");
  });
});
