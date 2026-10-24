// What the Health Connect import remembers between syncs, outside the Store (it describes Health Connect, not Pulse's
// rows): the changes token and the types it was taken for, and the importer version the stored rows were
// imported under (sync.ts re-imports the whole history window when it is older).
import AsyncStorage from "@react-native-async-storage/async-storage";

export const TOKEN_KEY = "pulse.hc.changesToken";
export const TYPES_KEY = "pulse.hc.readTypes";
/** `{ version }` of the last completed import (older installs also stored a `policy`, now ignored). */
export const IMPORT_STATE_KEY = "pulse.hc.importState";

export type ImportState = { version: number };

export async function readImportState(): Promise<ImportState | null> {
  try {
    const raw = await AsyncStorage.getItem(IMPORT_STATE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<ImportState>) : null;
    return v && typeof v.version === "number" ? { version: v.version } : null;
  } catch {
    return null;
  }
}

export async function writeImportState(s: ImportState): Promise<void> {
  await AsyncStorage.setItem(IMPORT_STATE_KEY, JSON.stringify(s)).catch(() => {});
}

/**
 * Forget the changes token and the import state, so the next sync re-reads the whole history window and replaces what
 * the earlier imports wrote for it.
 */
export async function forgetChanges(): Promise<void> {
  await AsyncStorage.multiRemove([TOKEN_KEY, TYPES_KEY, IMPORT_STATE_KEY]).catch(() => {});
}
