import type { BehavioursVM } from "@/queries/types";

export type BehaviorState = "selected" | "unselected" | "removed";

/** Keep unsaved edits when adding a custom behaviour refreshes the list underneath the picker. */
export function selectionOf(tags: BehavioursVM["tags"], edits: ReadonlyMap<string, BehaviorState>) {
  const initial = new Set(tags.filter((t) => !t.hidden).map((t) => t.tag));
  const selected = new Set(initial);
  const removed = new Set(tags.filter((t) => t.removed).map((t) => t.tag));
  const remove: string[] = [];
  const restore: string[] = [];
  for (const [tag, state] of edits) {
    if (state === "selected") selected.add(tag);
    else selected.delete(tag);
    if (state === "removed" && !removed.has(tag)) {
      removed.add(tag);
      remove.push(tag);
    } else if (state !== "removed" && removed.delete(tag)) {
      restore.push(tag);
    }
  }
  const dirty = remove.length > 0 || restore.length > 0 || selected.size !== initial.size || [...selected].some((t) => !initial.has(t));
  return { initial, selected, removed, dirty, input: { tags: [...selected], remove, restore } };
}
