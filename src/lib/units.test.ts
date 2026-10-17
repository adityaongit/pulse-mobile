import { afterEach, describe, expect, it } from "vitest";
import { clock, clockTick, heightText, timeOfDay } from "./format";
import { DEFAULT_DISPLAY, feetInches, fromFeetInches, inUnits, quantity, setDisplayPrefs } from "./units";

afterEach(() => setDisplayPrefs(DEFAULT_DISPLAY));

describe("units (units.ts)", () => {
  it("passes metric and unit-less values through", () => {
    const q = quantity("kg", "metric");
    expect([q.unit, q.value(70), q.stored(70)]).toEqual(["kg", 70, 70]);
    expect(quantity("bpm", "imperial").unit).toBe("bpm");
    expect(quantity(undefined, "imperial").value(5)).toBe(5);
  });

  it("converts each stored unit to its imperial one and back", () => {
    const cases: [string, number, string, number][] = [
      ["kg", 70, "lb", 154.32],
      ["km", 10, "mi", 6.21],
      ["/km", 300, "/mi", 482.8],
      ["m", 100, "ft", 328.08],
      ["cm", 80, "in", 31.5],
      ["ml", 500, "fl oz", 16.91],
      ["°C", 37, "°F", 98.6],
    ];
    for (const [from, v, to, shown] of cases) {
      const q = quantity(from, "imperial");
      expect(q.unit).toBe(to);
      expect(q.value(v)).toBeCloseTo(shown, 1);
      expect(q.stored(q.value(v))).toBeCloseTo(v, 9);
    }
  });

  it("scales a difference without the temperature offset", () => {
    const q = quantity("°C", "imperial");
    expect(q.change(0.5)).toBeCloseTo(0.9, 9);
    expect(q.value(0)).toBe(32);
  });

  it("converts a spec's pick, a deviation as a change, and leaves a metric spec as it is", () => {
    setDisplayPrefs({ units: "imperial", hours: 24 });
    const weight = inUnits({ unit: "kg", pick: (r: { kg: number | null }) => r.kg });
    expect(weight.unit).toBe("lb");
    expect(weight.pick({ kg: 100 })).toBeCloseTo(220.46, 2);
    expect(weight.pick({ kg: null })).toBeNull();
    const skin = inUnits({ unit: "°C", deviation: true, pick: () => -0.5 });
    expect([skin.unit, skin.pick()]).toEqual(["°F", -0.9]);
    setDisplayPrefs(DEFAULT_DISPLAY);
    const spec = { unit: "kg", pick: () => 1 };
    expect(inUnits(spec)).toBe(spec);
  });

  it("splits a height into feet and inches and back", () => {
    expect(feetInches(178)).toEqual({ feet: 5, inches: 10 });
    expect(feetInches(182.9)).toEqual({ feet: 6, inches: 0 });
    expect(fromFeetInches(5, 10)).toBeCloseTo(177.8, 1);
  });
});

describe("display formatting (format.ts)", () => {
  const at = Date.UTC(2026, 9, 17, 22, 5);
  const midnight = Date.UTC(2026, 9, 17, 0, 0);

  it("prints the clock on the person's 24- or 12-hour choice", () => {
    expect([clock(at, "UTC"), clock(midnight, "UTC"), clockTick(midnight, "UTC")]).toEqual(["22:05", "00:00", "00:00"]);
    setDisplayPrefs({ units: "metric", hours: 12 });
    expect([clock(at, "UTC"), clock(midnight, "UTC"), timeOfDay(12, 30)]).toEqual(["10:05\u00a0PM", "12:00\u00a0AM", "12:30\u00a0PM"]);
    expect([clockTick(midnight, "UTC"), clockTick(at, "UTC")]).toEqual(["12\u00a0AM", "10:05\u00a0PM"]);
  });

  it("prints a height in the chosen units", () => {
    expect(heightText(178)).toBe("178\u00a0cm");
    setDisplayPrefs({ units: "imperial", hours: 24 });
    expect(heightText(178)).toBe("5′\u00a010″");
  });
});
