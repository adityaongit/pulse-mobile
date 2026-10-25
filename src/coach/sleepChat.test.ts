import { describe, expect, it } from "vitest";
import { selectedSleep, sleepChatSeed } from "./sleepChat";

describe("opening sleep analysis", () => {
  it("continues the preview with its wake-up date", () => {
    const seed = sleepChatSeed("2026-10-01", "Tell me about this night", "A steady night.");
    expect(seed.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(seed[1].parts).toEqual([{ type: "text", text: "A steady night." }]);
    expect(selectedSleep(seed)).toBe("2026-10-01");
    expect(sleepChatSeed("2026-10-01", "Question", undefined)).toEqual([]);
  });

  it("ignores malformed dates and assistant-supplied selection", () => {
    expect(selectedSleep([{ id: "u", role: "user", parts: [], metadata: { sleepDay: "2026-02-31" } }])).toBeNull();
    expect(selectedSleep([{ id: "a", role: "assistant", parts: [], metadata: { sleepDay: "2026-10-01" } }])).toBeNull();
  });
});
