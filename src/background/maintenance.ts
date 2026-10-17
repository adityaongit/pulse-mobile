// Storage upkeep after each sync and scoring run (runSync.ts). Raw heart rate is most of the database: a day of it is
// tens of thousands of samples, and nothing used to leave. Days older than RAW_HR_DAYS keep one mean per minute, and
// the space they freed goes back to the phone. Pulse's web app compacted the same way after each recompute (pulse
// src/server/worker.ts); Baro, another on-phone Fitbit app, keeps raw pages briefly and per-minute heart rate long term.
import type { Store } from "@/data/store";

const DAY_S = 86_400;

/**
 * Days of heart rate kept as recorded. Older days are read per minute everywhere (the night and workout charts, the
 * stored per-minute series, stage 1's minute means), so only a stage-1 rerun of one (a SCORING_VERSION bump) sees the
 * compacted samples. The web app kept the same 30 days.
 */
export const RAW_HR_DAYS = 30;

/** Compacts the heart rate that has aged past RAW_HR_DAYS and, when that freed anything, reclaims the space. */
export async function maintainStorage(store: Store, nowTs: number): Promise<void> {
  const compacted = await store.compactHr(nowTs - RAW_HR_DAYS * DAY_S);
  if (compacted) await store.reclaimSpace();
}
