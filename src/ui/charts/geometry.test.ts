import { describe, expect, it } from "vitest";
import { arcPath, areaPath, barWidth, equidistantPreserveStart, evenTicks, linePath, linearScale, nearestIndex, preserveStartEnd, segments, tickTextWidth, ticksIn } from "./geometry";

describe("scales", () => {
  it("maps a domain onto a reversed range", () => {
    const y = linearScale([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(25)).toBe(150);
  });
  it("centres a flat domain", () => {
    expect(linearScale([5, 5], [0, 10])(5)).toBe(5);
  });
});

describe("paths", () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 10, y: 20 },
    { x: 20, y: null },
    { x: 30, y: 5 },
    { x: 40, y: 15 },
  ];
  it("breaks the line at a gap", () => {
    expect(segments(pts)).toHaveLength(2);
    expect(linePath(pts)).toBe("M0,10L10,20M30,5L40,15");
  });
  it("closes each run of an area down to the base", () => {
    expect(areaPath(pts, 50)).toBe("M0,10L10,20L10,50L0,50ZM30,5L40,15L40,50L30,50Z");
  });
  it("steps after each point", () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 5, y: 3 }, { x: 9, y: 2 }], "stepAfter")).toBe("M0,1L5,1L5,3L9,3L9,2");
  });
  it("a monotone curve never overshoots its points", () => {
    const d = linePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 10 }], "monotone");
    const ys = [...d.matchAll(/C[\d.]+,([\d.-]+),[\d.]+,([\d.-]+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);
  });
  it("two points are a straight line even when monotone", () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 5, y: 3 }], "monotone")).toBe("M0,1L5,3");
  });
});

describe("arcs", () => {
  it("draws nothing for an empty sweep", () => {
    expect(arcPath(50, 50, 40, 10, 10)).toBe("");
  });
  it("starts at 12 o'clock and ends at 3 o'clock for a quarter turn", () => {
    expect(arcPath(50, 50, 40, 0, 90)).toBe("M50,10A40,40 0 0 1 78.28,21.72A40,40 0 0 1 90,50");
  });
});

describe("nearestIndex and ticks", () => {
  it("snaps to the closest x", () => {
    expect(nearestIndex([0, 10, 20, 30], 14)).toBe(1);
    expect(nearestIndex([0, 10, 20, 30], 16)).toBe(2);
    expect(nearestIndex([], 3)).toBe(-1);
  });
  it("rounds ticks to a nice step", () => {
    // Recharts' getNiceTickValues, as the web's axes print them.
    expect(evenTicks(0, 90, 3)).toEqual([0, 45, 90]);
    expect(evenTicks(0, 21, 4)).toEqual([0, 7, 14, 21]);
    expect(evenTicks(42.3, 47.6, 3)).toEqual([42, 45, 48]);
    expect(evenTicks(0, 180, 5)).toEqual([0, 45, 90, 135, 180]);
    expect(evenTicks(-12, 30, 4)).toEqual([-15, 0, 15, 30]);
    expect(evenTicks(45, 45, 3)).toEqual([44, 45, 46]);
    expect(evenTicks(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(evenTicks(0.3, 0.9, 3)).toEqual([0.3, 0.6, 0.9]);
    expect(evenTicks(3, 7, 4)).toEqual([2, 4, 6, 8]);
    expect(evenTicks(0, 7.2, 3)).toEqual([0, 4, 8]);
    // A fixed numeric domain: Recharts' getTickValuesFixedDomain.
    expect(ticksIn(40, 180, 4)).toEqual([40, 90, 140, 180]);
    expect(ticksIn(50, 170, 4)).toEqual([50, 90, 130, 170]);
  });
  it("treats ends that differ only by float noise as one value (a flat series' mean ± a zero SD)", () => {
    expect(evenTicks(42.3, 42.300000000000004, 3)).toEqual(evenTicks(42.3, 42.3, 3));
    expect(evenTicks(0.1 + 0.2, 0.3, 3)).toEqual(evenTicks(0.3, 0.3, 3));
    expect(ticksIn(61, 61.00000000000007, 4)).toEqual([61]);
  });
});

describe("tick thinning (Recharts)", () => {
  // A month of weekly ticks 65 px apart; Recharts measures the raw ISO date, about 66 px of 12 px text.
  const weekly = [10, 75, 140, 205, 270].map((x) => ({ x, size: tickTextWidth("2026-09-12") }));
  it("preserveStartEnd keeps the ends, pulled inside the plot, and every tick that clears its neighbour", () => {
    expect(preserveStartEnd(weekly, 0, 270, 8).map((k) => k.index)).toEqual([0, 2, 4]);
    const [first, , last] = preserveStartEnd(weekly, 0, 270, 8);
    expect(first.x).toBeCloseTo(tickTextWidth("2026-09-12") / 2);
    expect(last.x).toBeCloseTo(270 - tickTextWidth("2026-09-12") / 2);
    expect(preserveStartEnd([], 0, 100, 8)).toEqual([]);
  });
  it("equidistantPreserveStart takes every k-th tick from the first", () => {
    const hours = [0, 40, 80, 120, 160, 200, 240].map((x) => ({ x, size: 33 }));
    expect(equidistantPreserveStart(hours, 0, 260, 24)).toEqual([0, 2, 4, 6]);
  });
});

describe("barWidth (Recharts)", () => {
  it("leaves 10 % of the band each side, rounds, and caps at maxBarSize", () => {
    expect(barWidth(10.6)).toBe(8);
    expect(barWidth(50, 0.1, 28)).toBe(28);
    expect(barWidth(40, 0.18)).toBe(26);
  });
});
