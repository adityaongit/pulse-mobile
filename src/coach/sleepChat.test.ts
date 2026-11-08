import { describe, expect, it } from "vitest";
import { selectedSleep } from "./sleepChat";

describe("stored sleep chat selection", () => {
  it("reads the persisted wake-up date", () => {
    expect(selectedSleep([{ id: "old-question", role: "user", parts: [], metadata: { sleepDay: "2026-10-01" } }])).toBe("2026-10-01");
  });

  it("ignores malformed dates and assistant-supplied selection", () => {
    expect(selectedSleep([{ id: "u", role: "user", parts: [], metadata: { sleepDay: "2026-02-31" } }])).toBeNull();
    expect(selectedSleep([{ id: "a", role: "assistant", parts: [], metadata: { sleepDay: "2026-10-01" } }])).toBeNull();
  });
});
