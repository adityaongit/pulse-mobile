import { expect, it } from "vitest";
import type { BehavioursVM } from "@/queries/types";
import { selectionOf, type BehaviorState } from "./behaviorSelection";

it("keeps draft removals separate from unchecked rows when the picker refreshes", () => {
  const row = (tag: string, hidden: boolean, removed = false): BehavioursVM["tags"][number] =>
    ({ tag, label: tag, group: "custom", isDefault: false, answers: 0, hidden, removed });
  const tags = [row("sauna", false), row("late_meal", false), row("yoga", true, true)];
  const edits = new Map<string, BehaviorState>([["sauna", "removed"], ["late_meal", "unselected"], ["yoga", "unselected"], ["camping", "removed"]]);
  // A custom behaviour added while those edits were pending arrives already selected.
  const draft = selectionOf([...tags, row("cold_plunge", false)], edits);
  expect(draft.input).toEqual({ tags: ["cold_plunge"], remove: ["sauna", "camping"], restore: ["yoga"] });
  expect([...draft.removed]).toEqual(["sauna", "camping"]);
  expect(draft.dirty).toBe(true);
  expect(selectionOf(tags, new Map([["sauna", "selected"], ["yoga", "removed"]])).dirty).toBe(false);
});
