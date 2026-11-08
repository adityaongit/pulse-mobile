import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { activityChatSeed, selectedActivity } from "./activityChat";

describe("activity chat context", () => {
  it.each(["workout", "sleep", "nap"] as const)("seeds %s previews with a saved selection", (kind) => {
    const activity = { kind, id: kind === "sleep" ? "2026-10-01" : "session-1" };
    const seed = activityChatSeed(activity, "Analyze this activity", "A useful observation.");
    expect(seed.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(seed[1].parts).toEqual([{ type: "text", text: "A useful observation." }]);
    expect(selectedActivity(JSON.parse(JSON.stringify(seed)))).toEqual(activity);
    expect(activityChatSeed(activity, "Analyze", undefined)).toEqual([]);
  });

  it("keeps selections in older saved chats", () => {
    const message = (metadata: unknown): UIMessage[] => [{ id: "u", role: "user", parts: [], metadata }];
    expect(selectedActivity(message({ workoutId: "ride-1" }))).toEqual({ kind: "workout", id: "ride-1" });
    expect(selectedActivity(message({ sleepDay: "2026-10-01" }))).toEqual({ kind: "sleep", id: "2026-10-01" });
    expect(selectedActivity(message({ activity: { kind: "nap", id: "nap-1" }, workoutId: "ride-1" }))).toEqual({ kind: "nap", id: "nap-1" });
  });

  it("ignores malformed or assistant-supplied selections", () => {
    for (const activity of [{ kind: "sleep", id: "2026-02-31" }, { kind: "nap", id: "" }, { kind: "workout", id: "x".repeat(101) }, { kind: "unknown", id: "a" }]) {
      expect(selectedActivity([{ id: "u", role: "user", parts: [], metadata: { activity } }])).toBeNull();
    }
    expect(selectedActivity([{ id: "a", role: "assistant", parts: [], metadata: { activity: { kind: "nap", id: "n" } } }])).toBeNull();
  });
});
