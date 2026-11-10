import { describe, expect, it } from "vitest";
import { COOLDOWN_MS, shakeDetector } from "./shake";

describe("shakeDetector", () => {
  it("fires on three hard jolts within a second, then rests", () => {
    const shake = shakeDetector();
    expect(shake(0, 0, 0, 1)).toBe(false); // at rest
    expect(shake(100, 3, 0, 0)).toBe(false);
    expect(shake(300, -3, 0, 0)).toBe(false);
    expect(shake(500, 3, 0, 0)).toBe(true);
    expect([700, 900, 1100].map((t) => shake(t, 3, 0, 0))).toEqual([false, false, false]); // cooling down
    expect([COOLDOWN_MS + 600, COOLDOWN_MS + 700, COOLDOWN_MS + 800].map((t) => shake(t, 0, 3, 0))).toEqual([false, false, true]);
  });

  it("ignores walking and jolts spread over more than a second", () => {
    const shake = shakeDetector();
    expect(Array.from({ length: 50 }, (_, i) => shake(i * 100, 0.4, 0.3, 1.6)).some(Boolean)).toBe(false);
    expect([0, 600, 1200, 1800].map((t) => shake(t, 3, 0, 0)).some(Boolean)).toBe(false);
  });
});
