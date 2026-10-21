import { i18n } from "@/i18n/config";
// Journal writes, as halo's src/screens/journal/actions.ts does them (ported from pulse's src/server/actions/journal.ts):
// the same validation and messages, results returned rather than thrown so a form can show them. Plain TypeScript over
// the Store, so the tests run in Node. The caller reloads the screens (`dataChanged`) or rescores (`refresh`) after a write.
import { behavior } from "@/lib/behaviors";
import { addDays, localDay } from "@/lib/time";
import type { QueryCtx } from "@/queries/ctx";
import { addTag, getJournal, MAX_TAGS, tagKey, tagRows } from "@/queries/journal";
import type { JournalVM } from "@/queries/types";
import type { ActionCtx } from "@/state/app";

export type { ActionCtx };
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const nowOf = (c: ActionCtx) => (c.nowS ? c.nowS() : Math.floor(Date.now() / 1000));
const todayOf = (c: ActionCtx) => localDay(nowOf(c), c.timeZone);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day "YYYY-MM-DD" (rejects 2026-02-31), as zod's `z.iso.date()`. */
export const isDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
};

/** How far back a day may go (the web's MAX_PAST_DAYS): the sheet's day strip runs from that day to today. */
export const MAX_PAST_DAYS = 3650;
export const inDayRange = (v: string, today: string) => isDay(v) && v <= today && v >= addDays(today, -MAX_PAST_DAYS);

const fail = (error: string) => ({ ok: false as const, error });

export type EntryInput = { day: string; tag: string; value: boolean | number | null };

/** Upserts (or, with value null, deletes) one (day, tag) for today or a past day. Repeating it changes nothing. */
export async function saveJournalEntry(c: ActionCtx, input: EntryInput): Promise<ActionResult> {
  const { day, tag, value } = input;
  if (!isDay(day)) return fail(i18n.t("errors:journal.invalidDate"));
  if (typeof tag !== "string" || tag.length < 1 || tag.length > 64) return fail(i18n.t("errors:journal.invalidTag"));
  // A yes/no behaviour, or a count (e.g. drinks); stored as an integer. null clears the answer: no row means "not
  // answered", which journal impact keeps apart from an answered "no" (0).
  if (value !== null && typeof value !== "boolean" && !(Number.isInteger(value) && value >= 0 && value <= 1000)) return fail(i18n.t("errors:journal.invalidValue"));
  if (day > todayOf(c)) return fail(i18n.t("errors:log.futureDay"));
  const known = (await tagRows(c.store)).some((t) => t.tag === tag);
  if (!known) return fail(i18n.t("errors:journal.unknownTag", { tag }));
  if (value === null) await c.store.deleteJournal(day, tag);
  else await c.store.setJournal({ day, tag, value: Number(value) });
  // Stage 2 reads the journal (impact, Insights, Monitor context) but a check-in is no source change, so mark the day
  // dirty (stage 1 redoes only that day, to the same result) as the web does. The caller then runs the pipeline.
  await c.store.markIntradayDirty([day]);
  return { ok: true, data: undefined };
}

/** The check-in's Save: each changed answer, one after another, stopping at the first failure. */
export async function saveCheckIn(c: ActionCtx, day: string, answers: Omit<EntryInput, "day">[]): Promise<ActionResult> {
  for (const a of answers) {
    const r = await saveJournalEntry(c, { day, ...a });
    if (!r.ok) return r;
  }
  return { ok: true, data: undefined };
}

/** Read-only: the check-in sheet's behaviours, a day's answers and the day strip. */
export async function loadCheckIn(ctx: QueryCtx, day: string): Promise<ActionResult<Pick<JournalVM, "tags" | "checkIn" | "strip">>> {
  if (!isDay(day)) return fail(i18n.t("errors:journal.invalidDay"));
  if (!inDayRange(day, ctx.today)) return fail(i18n.t("errors:journal.invalidDay"));
  const { tags, checkIn, strip } = await getJournal(day, ctx);
  return { ok: true, data: { tags, checkIn, strip } };
}

/** Adds a custom tag; its key is the label as snake_case. Fails when that key already exists. */
export async function addCustomTag(c: ActionCtx, input: { label: string }): Promise<ActionResult<{ tag: string }>> {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (label.length < 1) return fail(i18n.t("errors:journal.labelEmpty"));
  if (label.length > 40) return fail(i18n.t("errors:journal.labelLong"));
  const tag = tagKey(label);
  if (!tag) return fail(i18n.t("errors:journal.labelNeedsChar"));
  const added = await addTag(c.store, tag, label);
  if (added === "exists") return fail(i18n.t("errors:journal.tagExists", { tag }));
  if (added === "full") return fail(i18n.t("errors:journal.tooManyBehaviours", { count: MAX_TAGS }));
  return { ok: true, data: { tag } };
}

/**
 * Select Behaviors' Save: the journal asks exactly `tags`. Catalogue behaviours not yet added are added; every other
 * behaviour is hidden, its past answers kept.
 */
export async function saveBehaviors(c: ActionCtx, input: { tags: string[] }): Promise<ActionResult> {
  const { tags } = input;
  if (!Array.isArray(tags) || tags.length > 200 || tags.some((t) => typeof t !== "string" || t.length < 1 || t.length > 64)) return fail(i18n.t("errors:journal.invalidInput"));
  const rows = await tagRows(c.store);
  const mine = new Set(rows.map((r) => r.tag));
  const added = [...new Set(tags)].filter((t) => !mine.has(t));
  if (added.some((t) => !behavior(t))) return fail(i18n.t("errors:journal.unknownBehaviour"));
  if (mine.size + added.length > MAX_TAGS) return fail(i18n.t("errors:journal.tooManyBehaviours", { count: MAX_TAGS }));
  await c.store.insertJournalTags(added.map((tag) => ({ tag, label: behavior(tag)!.label, isDefault: false, hidden: false, position: 0 })));
  const shown = new Set(tags);
  await c.store.updateJournalTags([...mine, ...added].map((tag) => ({ tag, hidden: !shown.has(tag) })));
  return { ok: true, data: undefined };
}
