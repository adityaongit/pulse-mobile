// More, Settings and Your data (spec §7.14), ported from Pulse's src/server/queries/settings.ts and src/server/export.ts.
// The phone has no server, account or Google grant: the data source's live state (Health Connect permissions, the sync
// run) lives in the app state and the screens read it there; these queries read the Store.
import { wholeYears } from "@/lib/time";
import { LEARNED_MAX_HR_KEY, resolveMaxHr } from "@/pipeline";
import { SCORING_VERSION } from "@/pipeline/types";
import { finite, firstDay, loadDays, type QueryCtx, todayOf } from "./common";
import { latestReport } from "./home";
import { tagRows } from "./journal";
import { TREND_METRICS } from "./trends";
import type { MoreVM, SettingsVM, YourDataVM } from "./types";
import app from "../../app.json";

/** From app.json. */
export const APP_VERSION = app.expo.version;
export { SCORING_VERSION };

/** The web's demo / google split: on the phone, demo data or the person's own (Health Connect or a Google account). */
export type Mode = MoreVM["mode"];

/** Settings › Profile: the saved profile as the web shows it (age, the max HR in use and where it came from). */
export type SettingsProfileVM = SettingsVM["profile"];

/** Settings `/settings`: the read-only profile, the version and the scoring version. */
export async function getSettings(ctx: QueryCtx): Promise<{ profile: SettingsProfileVM; version: string; scoringVersion: number }> {
  const p = ctx.profile;
  const today = todayOf(ctx);
  const age = wholeYears(p.birthDate, today);
  // The pipeline's max HR: the profile's own, else Tanaka's raised to the one learned from workouts (pipeline/index.ts).
  const learned = p.maxHr ? null : ((await ctx.store.dailyValues({ from: "latest", to: "latest" })).find((v) => v.key === LEARNED_MAX_HR_KEY)?.value ?? null);
  const maxHr = resolveMaxHr(p, today, learned);
  return {
    profile: {
      birthDate: p.birthDate,
      age,
      sex: p.sex,
      maxHr,
      maxHrSource: p.maxHr ? "set" : learned != null && learned >= maxHr ? "learned" : "estimated",
      timeZone: ctx.timeZone,
      heightCm: p.heightCm,
      waistCm: p.waistCm ?? null,
    },
    version: APP_VERSION,
    scoringVersion: SCORING_VERSION,
  };
}

// ── Behaviours (journal tags) ────────────────────────────────────────────────

export type Behaviour = { tag: string; label: string; custom: boolean; hidden: boolean };

/** Every behaviour, hidden ones included, in check-in order (the web's journalBehaviours); the defaults are ensured first. */
export async function behaviours(ctx: QueryCtx): Promise<Behaviour[]> {
  return (await tagRows(ctx.store)).map((t) => ({ tag: t.tag, label: t.label, custom: !t.isDefault, hidden: t.hidden }));
}

// ── More ─────────────────────────────────────────────────────────────────────

/** More `/more`: the latest complete week and month, the report count and the behaviours shown on the check-in. */
export async function getMore(ctx: QueryCtx, mode: Mode = "google"): Promise<MoreVM> {
  const [tags, latestWeek, latestMonth, reports] = await Promise.all([behaviours(ctx), latestReport(ctx, "week"), latestReport(ctx, "month"), ctx.store.getReports()]);
  return {
    latestWeek,
    latestMonth,
    reportCount: reports.filter((r) => r.data.days > 0).length,
    behaviours: { shown: tags.filter((t) => !t.hidden).length, total: tags.length },
    mode,
    version: APP_VERSION,
    scoringVersion: SCORING_VERSION,
  };
}

// ── Your data ────────────────────────────────────────────────────────────────

/** Your data `/more/data`: what each export holds. */
export async function getYourData(ctx: QueryCtx, mode: Mode = "google"): Promise<YourDataVM> {
  const today = todayOf(ctx);
  const [first, journal, storageBytes] = await Promise.all([firstDay(ctx), ctx.store.allJournal(), ctx.store.storageBytes()]);
  const days = first ? (await ctx.store.scoresIn({ from: first, to: today })).length : 0;
  return { first, days, answers: journal.length, storageBytes, mode };
}

type Cell = string | number | null;
export type Table = { columns: string[]; rows: Cell[][] };

/** Every day from the first stored day to today: one column per daily metric, rounded as the app shows it. */
export async function dailyTable(ctx: QueryCtx): Promise<Table> {
  const columns = ["day", ...TREND_METRICS.map((m) => m.column)];
  const first = await firstDay(ctx);
  if (!first) return { columns, rows: [] };
  const today = todayOf(ctx);
  const rows: Cell[][] = [];
  for (const [day, r] of await loadDays(ctx, first, today)) {
    const values = TREND_METRICS.map((m) => {
      const v = m.partialToday && day === today ? null : m.pick(r);
      const k = m.format === "decimal2" ? 100 : 10; // distance keeps its 10 m
      return finite(v) ? Math.round(v * k) / k : null;
    });
    rows.push([day, ...values]);
  }
  return { columns, rows };
}

/** Journal answers, one row per (day, behaviour): answer 1 for yes (or a count), 0 for no. Hidden behaviours included. */
export async function journalTable(ctx: QueryCtx): Promise<Table> {
  const [entries, tags] = await Promise.all([ctx.store.allJournal(), behaviours(ctx)]);
  const label = new Map(tags.map((t) => [t.tag, t.label]));
  const sorted = [...entries].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return { columns: ["day", "behaviour", "label", "answer"], rows: sorted.map((e) => [e.day, e.tag, label.get(e.tag) ?? e.tag, e.value]) };
}

/** The behaviour list itself, for the journal JSON. */
export const journalBehaviours = (ctx: QueryCtx) => behaviours(ctx);

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

export type ExportKind = "daily" | "journal";
export type ExportFormat = "csv" | "json";
export type ExportFile = { name: string; mimeType: string; body: string };

/** One export as the web's /export/<kind>?format= answers it: "pulse-<kind>-<today>.<ext>" with the same body. */
export async function exportFile(ctx: QueryCtx, kind: ExportKind, format: ExportFormat): Promise<ExportFile> {
  const name = `pulse-${kind}-${todayOf(ctx)}.${format}`;
  const csv = (t: Table): ExportFile => ({ name, mimeType: "text/csv", body: toCsv(t) });
  const json = (v: unknown): ExportFile => ({ name, mimeType: "application/json", body: JSON.stringify(v, null, 2) });
  if (kind === "daily") {
    const table = await dailyTable(ctx);
    return format === "csv" ? csv(table) : json({ timeZone: ctx.timeZone, days: toObjects(table) });
  }
  const [table, tags] = await Promise.all([journalTable(ctx), journalBehaviours(ctx)]);
  return format === "csv" ? csv(table) : json({ behaviours: tags, entries: toObjects(table) });
}
