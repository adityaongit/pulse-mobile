import { describe, expect, it } from "vitest";
import { selectedWorkout, workoutChatSeed } from "./workoutChat";

describe("opening workout analysis", () => {
  it("continues the existing preview with its selected workout", () => {
    const seed = workoutChatSeed("ride-1", "Tell me about my ride", "A steady ride.");
    expect(seed.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(seed[1].parts).toEqual([{ type: "text", text: "A steady ride." }]);
    expect(selectedWorkout(seed)).toBe("ride-1");
    expect(workoutChatSeed("ride-1", "Tell me about my ride", undefined)).toEqual([]);
    expect(workoutChatSeed(undefined, "Hello", "Preview")).toEqual([]);
  });
});
