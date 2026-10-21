import { i18n } from "@/i18n/config";
// Your data (More): the daily scores and the journal as CSV or JSON (halo's queries/settings.ts `exportFile`). The file
// is written to the app's cache and handed to the share sheet.
import { exportFile, type ExportFormat, type ExportKind } from "@/queries/settings";
import type { QueryCtx } from "@/queries/ctx";
import type { ActionResult } from "./journal";

export type { ExportFormat, ExportKind };

export async function shareExport(ctx: QueryCtx, kind: ExportKind, format: ExportFormat): Promise<ActionResult> {
  try {
    const file = await exportFile(ctx, kind, format);
    // Loaded here so the queries above run in Node tests, where the native modules do not exist.
    const [{ File, Paths }, Sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: i18n.t("errors:export.sharingUnavailable") };
    const out = new File(Paths.cache, file.name);
    out.create({ overwrite: true });
    out.write(file.body);
    await Sharing.shareAsync(out.uri, { mimeType: file.mimeType, dialogTitle: file.name });
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: i18n.t("errors:export.failed") };
  }
}
