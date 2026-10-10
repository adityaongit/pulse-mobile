// Your data (More): the daily scores, the journal and the coach chats as CSV or JSON. Ported from pulse
// src/server/export.ts and src/app/export/*/route.ts: the same tables and files; a download becomes a file written to the
// app's cache and handed to the share sheet. No export ever carries Google tokens or the coach provider key: the files
// read only the tables below (the tokens and the key are in the secure store, never in SQLite).
import { EXTRA_METRICS, type ExtraKey } from "@/lib/extraMetrics";
import type { FormatKey } from "@/lib/format";
import type { Store } from "../data/repos";
import { type DayRow, ctxOf, finite, firstDay, loadDays, type QueryCtx, todayOf, toStrain } from "../queries/common";
import type { ActionResult } from "./behaviours";

type Cell = string | number | null;
export type Table = { columns: string[]; rows: Cell[][] };

/** Export column: the key plus its unit ("distance_km", "glucose_mg_dl"); h:mm metrics export minutes. (pulse queries/trends.ts `columnOf`) */
const columnOf = (key: string, unit: string | undefined, format: FormatKey) =>
  unit ? `${key}_${unit.replace("°", "").replace("/", "_").toLowerCase()}` : format === "duration" && !key.endsWith("_minutes") ? `${key}_minutes` : key;

type Column = { column: string; format: FormatKey; partialToday?: boolean; pick: (r: DayRow) => number | null | undefined };

// ponytail: the column list is a copy of pulse's TREND_METRICS (column, format, partialToday, pick); when the Trends
// stream's src/queries/trends.ts lands, import its TREND_METRICS here instead and delete this list.
const CORE: Column[] = [
  { column: "recovery_pct", format: "int", pick: (r) => r.recovery?.value },
  { column: "strain", format: "decimal1", partialToday: true, pick: (r) => (finite(r.s1?.effort) ? toStrain(r.s1.effort) : null) },
  { column: "sleep_performance_pct", format: "int", pick: (r) => r.sleep?.performance },
  { column: "sleep_minutes", format: "duration", pick: (r) => r.sleep?.main?.asleepMin },
  { column: "sleep_consistency_pct", format: "int", pick: (r) => r.sleep?.consistency },
  { column: "hrv_ms", format: "int", pick: (r) => r.metrics?.hrvMs },
  { column: "resting_hr_bpm", format: "int", pick: (r) => r.metrics?.rhrBpm ?? r.sessionRhr },
  { column: "respiratory_rate_rpm", format: "decimal1", pick: (r) => r.metrics?.respBpm },
  { column: "spo2_pct", format: "int", pick: (r) => r.metrics?.spo2Pct },
  { column: "skin_temperature_deviation_c", format: "decimal1", pick: (r) => r.recovery?.inputs.skinTempDev },
  { column: "stress_avg", format: "decimal1", partialToday: true, pick: (r) => r.stress?.average },
  { column: "steps", format: "grouped", partialToday: true, pick: (r) => r.metrics?.steps },
  { column: "weight_kg", format: "decimal1", pick: (r) => r.metrics?.weightKg },
  { column: "body_fat_pct", format: "decimal1", pick: (r) => r.metrics?.bodyFatPct },
];
const COLUMNS: Column[] = [
  ...CORE,
  ...EXTRA_METRICS.map((m): Column => ({
    column: columnOf(m.key, "unit" in m ? m.unit : undefined, m.format),
    format: m.format,
    ...("partialToday" in m && { partialToday: m.partialToday }),
    pick: (r) => r.extra[m.key as ExtraKey],
  })),
];

/** Every day from the first stored day to today: one column per daily metric, rounded as the app shows it. */
export async function dailyTable(ctx: QueryCtx): Promise<Table> {
  const columns = ["day", ...COLUMNS.map((m) => m.column)];
  const first = await firstDay(ctx);
  if (!first) return { columns, rows: [] };
  const today = todayOf(ctx);
  const rows: Cell[][] = [];
  for (const [day, r] of await loadDays(ctx, first, today)) {
    const values = COLUMNS.map((m) => {
      const v = m.partialToday && day === today ? null : m.pick(r);
      const k = m.format === "decimal2" ? 100 : 10; // distance keeps its 10 m
      return typeof v === "number" && Number.isFinite(v) ? Math.round(v * k) / k : null;
    });
    rows.push([day, ...values]);
  }
  return { columns, rows };
}

/**
 * Journal answers, one row per (day, behaviour): answer 1 for yes (or a count), 0 for no, and the follow-up answer
 * (minutes after midnight or a count) when there is one. Hidden behaviours included.
 */
export async function journalTable(ctx: QueryCtx): Promise<Table> {
  const rows = await ctx.store.journal.entriesWithLabels();
  return { columns: ["day", "behaviour", "label", "answer", "follow_up"], rows: rows.map((r) => [r.day, r.tag, r.label, r.value, r.detail]) };
}

/** The behaviour list itself, for the journal JSON. */
export async function journalBehaviours(ctx: QueryCtx) {
  return (await ctx.store.journal.tags()).map((t) => ({ tag: t.tag, label: t.label, custom: !t.isDefault, hidden: t.hidden }));
}

/**
 * RFC 4180 CSV. A text cell that starts with = + - @ (a custom behaviour's label is user input) gets a leading
 * apostrophe, so a spreadsheet shows it as text instead of running it as a formula.
 */
export function toCsv({ columns, rows }: Table): string {
  const cell = (v: Cell) => {
    if (v === null) return "";
    if (typeof v === "number") return String(v);
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const toObjects = ({ columns, rows }: Table) => rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));

export type ExportKind = "daily" | "journal" | "coach";
export type ExportFormat = "csv" | "json";
export type ExportFile = { name: string; mime: string; body: string };

/** A file named "pulse-<what>-<today>.<ext>". The coach export is JSON only. */
export async function buildExport(ctx: QueryCtx, kind: ExportKind, format: ExportFormat): Promise<ExportFile> {
  const name = (ext: string) => `pulse-${kind}-${todayOf(ctx)}.${ext}`;
  const csv = (t: Table) => ({ name: name("csv"), mime: "text/csv", body: toCsv(t) });
  const json = (v: unknown) => ({ name: name("json"), mime: "application/json", body: JSON.stringify(v, null, 2) });
  if (kind === "coach") return json({ chats: await ctx.store.coach.exportChats() });
  if (kind === "daily") {
    const table = await dailyTable(ctx);
    return format === "csv" ? csv(table) : json({ timeZone: ctx.timeZone, days: toObjects(table) });
  }
  const [table, behaviours, notes] = await Promise.all([journalTable(ctx), journalBehaviours(ctx), ctx.store.journal.notes()]);
  return format === "csv" ? csv(table) : json({ behaviours, entries: toObjects(table), notes });
}

/** Builds the export, writes it to the app's cache and opens the share sheet (Save to Files, AirDrop, Drive, mail ...). */
export async function shareExport(store: Store, kind: ExportKind, format: ExportFormat): Promise<ActionResult> {
  try {
    const file = await buildExport(await ctxOf(store), kind, format);
    // Loaded here so the builders above run in Node tests, where the native modules do not exist.
    const [{ File, Paths }, Sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: "Sharing isn’t available on this device." };
    const out = new File(Paths.cache, file.name);
    out.create({ overwrite: true });
    out.write(file.body);
    await Sharing.shareAsync(out.uri, { mimeType: file.mime, UTI: file.mime === "text/csv" ? "public.comma-separated-values-text" : "public.json", dialogTitle: file.name });
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Couldn’t export. Try again." };
  }
}
