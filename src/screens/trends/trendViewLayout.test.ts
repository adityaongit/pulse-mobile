import { describe, expect, it } from "vitest";
import { buildModel, clockOf, niceTicks, xTickKeys, type TrendViewChartProps } from "./trendViewLayout";

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10));
const props = (o: Partial<TrendViewChartProps>): TrendViewChartProps => ({
  label: "HRV",
  bars: days("2026-09-04", 30).map((d, i) => ({ from: d, to: d, value: 40 + (i % 7) })),
  chart: "line",
  range: "m",
  colorBy: "single",
  format: "int",
  direction: "up",
  ...o,
});
const fmt = (v: number) => String(Math.round(v));

describe("Trend View chart layout", () => {
  it("clock labels wrap around midnight", () => {
    expect([clockOf(-90), clockOf(0), clockOf(450), clockOf(1500)]).toEqual(["22:30", "00:00", "07:30", "01:00"]);
  });

  it("niceTicks covers the domain on round steps, whole clock steps for durations", () => {
    expect(niceTicks([0, 100])).toEqual([0, 50, 100]);
    const t = niceTicks([37, 61]);
    expect(t[0]).toBeLessThanOrEqual(37);
    expect(t.at(-1)!).toBeGreaterThanOrEqual(61);
    expect(niceTicks([0, 600], true)).toEqual([0, 240, 480, 720]); // 600 / 3 = 200, so the 240 minute step
  });

  it("x ticks: every 7th day back from the end in M, one per month in 6M, all in W", () => {
    const m = days("2026-09-04", 30);
    expect(xTickKeys(m, "m", false)).toEqual(m.filter((_, i) => (29 - i) % 7 === 0));
    expect(xTickKeys(m.slice(-7), "w", false)).toHaveLength(7);
    const six = days("2026-04-06", 182);
    const ticks = xTickKeys(six, "6m", false);
    // One tick per calendar month, each on the first day from the 14th (or the first key of an edge month).
    expect(new Set(ticks.map((k) => k.slice(0, 7))).size).toBe(ticks.length);
    expect(ticks.slice(1, -1).every((k) => k.slice(8) === "14")).toBe(true);
  });

  it("a line chart has a tight axis; bars stand on zero with 15 % headroom", () => {
    const line = buildModel(props({}), fmt);
    expect(line.domain[0]).toBeGreaterThan(0);
    expect(line.yTicks[0]).toBe(line.domain[0]);
    const bars = buildModel(props({ chart: "bars" }), fmt);
    expect(bars.domain[0]).toBe(0);
    expect(bars.domain[1]).toBeGreaterThanOrEqual(46 * 1.15);
    expect(buildModel(props({ chart: "bars", domain: [0, 100] }), fmt).yTicks).toEqual([0, 25, 50, 75, 100]);
    expect(buildModel(props({ chart: "bars", domain: [0, 21] }), fmt).yTicks).toEqual([0, 5, 10, 15, 21]);
  });

  it("the margins, axes and height follow the chart kind", () => {
    const w = buildModel(props({ range: "w", bars: days("2026-09-28", 7).map((d) => ({ from: d, to: d, value: 5 })) }), fmt);
    expect(w.margin.top).toBe(22);
    expect(w.labelled).toBe(true);
    expect(buildModel(props({ compact: true }), fmt)).toMatchObject({ height: 150, yAxisWidth: 0 });
    expect(buildModel(props({ unit: "%" }), fmt).yAxisWidth).toBe(46);
    expect(buildModel(props({ chart: "line", range: "m" }), fmt).margin.right).toBe(24);
    expect(buildModel(props({ range: "6m" }), fmt)).toMatchObject({ six: true, faint: true, xAxisHeight: 24 });
  });

  it("time in bed runs on an inverted clock axis from before 21:00 to after 13:00", () => {
    const bars = days("2026-09-28", 7).map((d) => ({ from: d, to: d, value: 450, parts: { bed: -90, wake: 360 } }));
    const m = buildModel(props({ chart: "range", range: "w", bars }), fmt);
    expect(m.domain[0]).toBeLessThanOrEqual(-180);
    expect(m.domain[1]).toBeGreaterThanOrEqual(780);
    expect(m.yTicks.every((t, i) => i === 0 || t - m.yTicks[i - 1] === 240)).toBe(true);
    expect(m.rows[0].span).toEqual([-90, 360]);
  });

  it("an empty window says so in its summary", () => {
    expect(buildModel(props({ bars: [] }), fmt).summary).toBe("No HRV data in this period.");
    expect(buildModel(props({}), fmt).summary).toMatch(/^HRV: 30 days with data, from 40 to 46\.$/);
  });
});
