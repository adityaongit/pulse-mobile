import { describe, expect, it, vi } from "vitest";
import { testStore } from "../data/testing";
import { seedHeartRhythm } from "./heartRhythm";

vi.mock("../screens/useScreen", () => ({ dataChanged: vi.fn() }));

const TZ = "Asia/Kolkata";
const NOW = Date.parse("2026-10-02T14:00:00+05:30") / 1000;
const ANCHOR = "2026-04-06";
const records = (store: ReturnType<typeof testStore>) => store.daily.healthRecordsUpTo("9999-12-31");

describe("seedHeartRhythm", () => {
  it("writes the four records by now, deterministically, and a repeat adds no duplicates", async () => {
    const a = testStore();
    expect(await seedHeartRhythm(a, ANCHOR, TZ, NOW)).toBe(4);
    expect((await records(a)).reverse().map((r) => r.kind)).toEqual(["ecg", "irn", "ecg", "ecg"]);
    expect(await seedHeartRhythm(a, ANCHOR, TZ, NOW)).toBe(0);
    const b = testStore();
    await seedHeartRhythm(b, ANCHOR, TZ, NOW);
    expect(await records(a)).toEqual(await records(b));
  });

  it("leaves out records after now", async () => {
    const early = testStore();
    // 40 days earlier only the ECG 64 days before the end has happened.
    expect(await seedHeartRhythm(early, ANCHOR, TZ, NOW - 40 * 86_400)).toBe(1);
  });
});
