import { describe, expect, it } from "vitest";
import { type DayRow, vo2Of } from "./common";

const row = (fitness: DayRow["fitness"], estimate: number | null) =>
  ({ fitness, healthspan: estimate == null ? null : { reason: "calibrating", dataDays: 0, fitnessEstimate: { vo2max: estimate } } }) as unknown as DayRow;
const fitbit = { reason: null, vo2max: 49.2, source: "daily", sourceDay: "2026-10-01", percentile: 54, category: "fair", age: 29 } as DayRow["fitness"];

describe("vo2Of", () => {
  it("shows Fitbit's VO2 max, and Pulse's estimate only without one", () => {
    expect(vo2Of(row(fitbit, 44))).toEqual({ value: 49.2, estimate: false });
    expect(vo2Of(row({ reason: "no_data" }, 44))).toEqual({ value: 44, estimate: true });
    expect(vo2Of(row(null, null))).toBeNull();
  });
});
