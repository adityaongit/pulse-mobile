// Disconnect Google and delete everything (Settings). Disconnect is pulse's settings/actions.ts `disconnectGoogle` with
// the phone's meaning: there is no server and nothing to revoke from here, so it forgets the grant and what Google
// synced (the web kept the data and only stopped syncing; the owner chose to clear it, as an account switch does:
// pulse avatar.ts `forgetSyncedData`). The journal, profile, dashboard, log and coach stay.
import type { Store } from "../data/repos";
import { dataChanged } from "../screens/useScreen";
import type { ActionResult } from "./journal";

/**
 * Forgets the Google grant and everything synced from it, in one transaction: each owner's `clearSynced()`, then the
 * grant itself. `forgetTokens` removes the tokens from the secure store (the connect step owns them).
 */
export async function disconnectGoogle(store: Store, forgetTokens: () => Promise<void> = async () => {}): Promise<ActionResult> {
  try {
    await store.transaction(async (tx) => {
      await tx.samples.clearSynced();
      await tx.series.clearSynced();
      await tx.scores.clearSynced();
      await tx.daily.clearSynced();
      await tx.sessions.clearSynced();
      await tx.settings.clearSynced();
      await tx.settings.remove("google.grant");
    });
    await forgetTokens();
  } catch {
    return { ok: false, error: "Couldn’t disconnect. Try again." };
  }
  dataChanged();
  return { ok: true, data: undefined };
}

/**
 * Deletes the database file and restarts into onboarding. The handle is closed first (an open file cannot be deleted
 * on every platform), then the app reloads: the database module opens a fresh, empty file, the migrations run again
 * and, with no profile, the root layout sends the person to onboarding. `forgetSecrets` removes what is in the secure store.
 */
export async function deleteEverything(forgetSecrets: () => Promise<void> = async () => {}): Promise<ActionResult> {
  try {
    await forgetSecrets();
    // Loaded here: only this action touches the file itself, and Node tests have no expo modules.
    const [{ sqlite }, { deleteDatabaseAsync }, { reloadAppAsync }] = await Promise.all([import("../data/db"), import("expo-sqlite"), import("expo")]);
    sqlite.closeSync();
    // Reload even when the delete failed: the closed handle is only usable again after a restart.
    try {
      await deleteDatabaseAsync("pulse.db");
    } finally {
      await reloadAppAsync("Deleted everything");
    }
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Couldn’t delete everything. Try again." };
  }
}
