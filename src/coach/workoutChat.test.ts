import { describe, expect, it } from "vitest";
import { selectedWorkout } from "./workoutChat";

describe("stored workout chat selection", () => {
  it("reads the persisted workout ID from user metadata", () => {
    expect(selectedWorkout([{ id: "old-question", role: "user", parts: [], metadata: { workoutId: "ride-1" } }])).toBe("ride-1");
    expect(selectedWorkout([{ id: "answer", role: "assistant", parts: [], metadata: { workoutId: "ride-1" } }])).toBeNull();
  });
});
