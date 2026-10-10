// The Journal's behaviour catalogue rules, ported from pulse src/server/journalTags.ts (the SQL is in the journal
// repository). Sits beside time.ts so pulse's `../journalTags` imports match.
import { behavior } from "@/lib/behaviors";
import type { Store } from "./data/repos";

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
