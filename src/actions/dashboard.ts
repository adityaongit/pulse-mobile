// Home's My Dashboard (spec §11 CD1): which metrics it shows, in which order. Ported from pulse src/server/actions/dashboard.ts:
// the Store replaces the user and the database, and `dataChanged()` (every mounted screen reloads) replaces revalidatePath.
import { z } from "zod";
import { isDashboardKey } from "@/lib/dashboard";
import type { Store } from "../data/repos";
import { dashboardDefault } from "../queries/home";
import { dataChanged } from "../screens/useScreen";
import type { ActionResult } from "./journal";

const Dashboard = z.object({
  keys: z
    .array(z.string().refine(isDashboardKey, { message: "Unknown metric" }))
    .min(1, "Choose at least one metric")
    .refine((k) => new Set(k).size === k.length, { message: "A metric is listed twice" }),
});

/** Saves the chosen metrics in order. The default list is stored as no rows, so a later default change reaches it. */
export async function saveDashboard(store: Store, input: z.input<typeof Dashboard>): Promise<ActionResult> {
  const r = Dashboard.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const { keys } = r.data;
  const def = await dashboardDefault(store);
  const isDefault = keys.length === def.length && keys.every((k, i) => k === def[i]);
  await store.settings.saveDashboard(isDefault ? [] : keys);
  dataChanged();
  return { ok: true, data: undefined };
}
