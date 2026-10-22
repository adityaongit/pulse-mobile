import { describe, expect, it } from "vitest";
import { openMemoryStore } from "./memory";

describe("replaceDailyValues", () => {
  it("drops a day's value the source no longer has, keeps other keys and days outside the range", async () => {
    const store = openMemoryStore();
    await store.upsertDailyValues([
      { day: "2026-10-01", key: "calories_in", value: 900 },
      { day: "2026-10-02", key: "calories_in", value: 642 },
      { day: "2026-10-02", key: "protein", value: 22 },
      { day: "2026-10-02", key: "steps_goal", value: 8000 },
    ]);
    // The day's food was deleted in Health Connect: the sync brings no calories or protein for it.
    await store.replaceDailyValues({ from: "2026-10-02", to: "2026-10-02" }, ["calories_in", "protein"], []);
    const left = (await store.dailyValues()).map((v) => `${v.day}:${v.key}`).sort();
    expect(left).toEqual(["2026-10-01:calories_in", "2026-10-02:steps_goal"]);
  });

  it("writes the rows it is given", async () => {
    const store = openMemoryStore();
    await store.replaceDailyValues({ from: "2026-10-01", to: "2026-10-02" }, ["calories_in"], [{ day: "2026-10-02", key: "calories_in", value: 321 }]);
    expect(await store.dailyValues()).toEqual([{ day: "2026-10-02", key: "calories_in", value: 321 }]);
  });
});
