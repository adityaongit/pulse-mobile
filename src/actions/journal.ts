import { i18n } from "@/i18n/config";
// Journal writes, as halo's src/screens/journal/actions.ts does them (ported from pulse's src/server/actions/journal.ts):
// the same validation and messages, results returned rather than thrown so a form can show them. Plain TypeScript over
// the Store, so the tests run in Node. The caller reloads the screens (`dataChanged`) or rescores (`refresh`) after a write.
import { behavior, englishBehaviorLabel } from "@/lib/behaviors";
import type { JournalTagChange, JournalTagRow } from "@/data/store";
import { addDays, localDay } from "@/lib/time";
import type { QueryCtx } from "@/queries/ctx";
import { addTag, editTags, getJournal, MAX_TAG_ROWS, MAX_TAGS, tagKey, tagRows } from "@/queries/journal";
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
  const known = (await tagRows(c.store)).some((t) => t.tag === tag && !t.removed);
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

/** Adds a custom tag, or brings back a removed tag with the same key. */
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

export type BehaviorSelection = { tags: string[]; remove?: string[]; restore?: string[] };

/** Save the check-in selection and explicit picker removals/restorations together. Past answers keep their tag rows. */
export async function saveBehaviors(c: ActionCtx, { tags, remove = [], restore = [] }: BehaviorSelection): Promise<ActionResult> {
  const validTags = (list: string[]) => Array.isArray(list) && list.every((tag) => typeof tag === "string" && tag.length >= 1 && tag.length <= 64);
  if (![tags, remove, restore].every(validTags) || tags.length > 200) return fail(i18n.t("errors:journal.invalidInput"));
  const shown = new Set(tags);
  const removing = new Set(remove);
  const restoring = new Set(restore);
  if (remove.some((tag) => shown.has(tag) || restoring.has(tag))) return fail(i18n.t("errors:journal.invalidInput"));
  return editTags<ActionResult>(c.store, (rows) => {
    const mine = new Map(rows.map((r) => [r.tag, r]));
    const changes: JournalTagChange[] = [];
    const newTags: JournalTagRow[] = [];
    let available = 0;
    for (const tag of new Set([...mine.keys(), ...shown, ...removing, ...restoring])) {
      const row = mine.get(tag);
      const removed = removing.has(tag) || (!!row?.removed && !restoring.has(tag));
      const hidden = removed || !shown.has(tag);
      if (!removed) available++;
      if (!row) {
        if (!behavior(tag)) return { result: fail(i18n.t("errors:journal.unknownBehaviour")) };
        newTags.push({ tag, label: englishBehaviorLabel(tag), isDefault: false, hidden, removed, position: 0 });
      } else if (!!row.removed !== removed) {
        changes.push({ tag, removed, hidden });
      } else if (row.hidden !== hidden) {
        changes.push({ tag, hidden });
      }
    }
    if (available > MAX_TAGS || rows.length + newTags.length > MAX_TAG_ROWS) return { result: fail(i18n.t("errors:journal.tooManyBehaviours", { count: MAX_TAGS })) };
    return { result: { ok: true, data: undefined }, update: changes, insert: newTags };
  });
}
