// More › Behaviours (U21): the journal's tag actions. Ported from pulse src/server/actions/journal.ts
// (`loadBehaviours`, `saveBehaviors`); `addCustomTag` is in ./journal as in pulse. Results are returned, not thrown, so a
// form can show them.
import { z } from "zod";
import type { Store } from "../data/repos";
import { dataChanged } from "../screens/useScreen";
import { ctxOf } from "../queries/common";
import { getBehaviours } from "../queries/journal";
import { MAX_TAGS, selectTags } from "../journalTags";
import type { BehavioursVM } from "../queries/types";
import type { ActionResult } from "./journal";

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
