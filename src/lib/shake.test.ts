import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, shakeDetector } from "./shake";

/** Readings at 20 Hz from `from` ms: `g(i)` gives the i-th magnitude, along x. */
const feed = (shake: ReturnType<typeof shakeDetector>, from: number, n: number, g: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => shake(from + i * 50, g(i), 0, 0));

describe("shakeDetector", () => {
  it("fires once a shake keeps most readings past 1.33 g for half a second, then rests", () => {
    const shake = shakeDetector();
    expect(feed(shake, 0, 10, () => 1).some(Boolean)).toBe(false); // at rest
    const hits = feed(shake, 1000, 40, (i) => (i % 4 === 3 ? 1.1 : 2)); // two seconds of shaking
    expect(hits.indexOf(true)).toBe(3);
    expect(hits.filter(Boolean)).toHaveLength(1); // cooling down
    expect(feed(shake, 1000 + COOLDOWN_MS + 500, 6, () => 2).some(Boolean)).toBe(true);
  });

  it("ignores walking: a spike a step, never three quarters of the readings", () => {
    const shake = shakeDetector();
    expect(feed(shake, 0, 200, (i) => (i % 10 < 2 ? 1.6 : 1)).some(Boolean)).toBe(false);
  });
});
