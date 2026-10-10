// More › Behaviours (U21): the journal's tag actions. Ported from pulse src/server/actions/journal.ts
// (`loadBehaviours`, `saveBehaviors`, `addCustomTag`) and src/server/journalTags.ts (`selectTags`, `tagKey`, the cap and
// the defaults). Results are returned, not thrown, so a form can show them.
import { z } from "zod";
import { behavior } from "@/lib/behaviors";
import type { Store } from "../data/repos";
import { dataChanged } from "../screens/useScreen";
import { ctxOf } from "../queries/common";
import { getBehaviours } from "../queries/settings";
import type { BehavioursVM } from "../queries/types";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** The Journal's default behaviours (pulse journalTags.ts), made at onboarding. */
export const DEFAULT_JOURNAL_TAGS = [
  { tag: "alcohol", label: "Alcohol" },
  { tag: "late_caffeine", label: "Late caffeine" },
  { tag: "late_meal", label: "Late meal" },
  { tag: "screen_in_bed", label: "Screen in bed" },
  { tag: "meditation", label: "Meditation" },
  { tag: "stretching", label: "Stretching" },
  { tag: "sauna", label: "Sauna" },
  { tag: "travel", label: "Travel" },
  { tag: "illness", label: "Illness" },
] as const;

/** A custom tag's key: the label as snake_case ("Cold plunge" → "cold_plunge"); "" when it has no letter or digit. */
export const tagKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** Most tags (defaults included) a person can have. Insights bootstrap every tag on every recompute, so this bounds that work. */
export const MAX_TAGS = 60;

/**
 * Makes `tags` the behaviours the journal asks: adds catalogue behaviours the user has no row for (at the end), shows
 * the chosen ones and hides the rest. "unknown" for a key neither in the catalogue nor the user's; "full" past MAX_TAGS.
 */
export async function selectTags(store: Store, tags: string[]): Promise<"saved" | "unknown" | "full"> {
  const mine = new Set(await store.journal.tagKeys());
  const added = [...new Set(tags)].filter((t) => !mine.has(t));
  if (added.some((t) => !behavior(t))) return "unknown";
  if (mine.size + added.length > MAX_TAGS) return "full";
  await store.transaction(async (tx) => {
    await tx.journal.addTags(added.map((t) => ({ tag: t, label: behavior(t)!.label })));
    await tx.journal.showOnly(tags);
  });
  return "saved";
}

/** Read-only: every behaviour the user has, hidden ones included, for Select Behaviors. */
export async function loadBehaviours(store: Store): Promise<ActionResult<BehavioursVM>> {
  return { ok: true, data: await getBehaviours(await ctxOf(store)) };
}

const Selection = z.object({ tags: z.array(z.string().min(1).max(64)).max(200) });

/**
 * Select Behaviors' Save: the journal asks exactly `tags`. Catalogue behaviours not yet added are added; every other
 * behaviour is hidden, its past answers kept.
 */
export async function saveBehaviors(store: Store, input: z.input<typeof Selection>): Promise<ActionResult> {
  const r = Selection.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const result = await selectTags(store, r.data.tags);
  if (result === "unknown") return { ok: false, error: "Unknown behaviour" };
  if (result === "full") return { ok: false, error: `Too many behaviours: the limit is ${MAX_TAGS}` };
  dataChanged();
  return { ok: true, data: undefined };
}

const CustomTag = z.object({ label: z.string().trim().min(1).max(40) });

/** Adds a custom tag; its key is the label as snake_case. Fails when that key already exists. */
export async function addCustomTag(store: Store, input: z.input<typeof CustomTag>): Promise<ActionResult<{ tag: string }>> {
  const r = CustomTag.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const { label } = r.data;
  const tag = tagKey(label);
  if (!tag) return { ok: false, error: "Label needs a letter or digit" };
  const added = await store.journal.addTag(tag, label, MAX_TAGS);
  if (added === "exists") return { ok: false, error: `Tag already exists: ${tag}` };
  if (added === "full") return { ok: false, error: `Too many behaviours: the limit is ${MAX_TAGS}` };
  dataChanged();
  return { ok: true, data: { tag } };
}
