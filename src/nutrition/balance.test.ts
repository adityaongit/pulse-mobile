import { describe, expect, it } from "vitest";
import { balanceOf, zoneOf } from "./balance";

describe("calorie zones", () => {
  it("is Under below 90 %, In zone from 90 to 110 %, Over above", () => {
    expect(zoneOf(1799, 2000)).toBe("under");
    expect(zoneOf(1800, 2000)).toBe("in");
    expect(zoneOf(2200, 2000)).toBe("in");
    expect(zoneOf(2201, 2000)).toBe("over");
  });
});

describe("calorie balance", () => {
  it("is in minus out, null when either is unknown", () => {
    expect(balanceOf(1092, 544)).toBe(548);
    expect(balanceOf(1500, 2100)).toBe(-600);
    expect(balanceOf(null, 2100)).toBeNull();
    expect(balanceOf(1500, null)).toBeNull();
  });
});
