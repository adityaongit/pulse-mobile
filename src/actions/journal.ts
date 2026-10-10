// Journal writes (pulse src/server/actions/journal.ts): validated with zod, results are returned, not thrown, so a form
// can show them. They take the app's Store; after a write they call `dataChanged()` (pulse's revalidatePath) so every
// mounted screen reloads. There is no session check (one person per install) and no worker to kick: a check-in marks
// its day dirty, and the background stream's recompute picks it up (pulse's `requestSync({ force: true, pull: false })`).
// Select Behaviors' Save and the behaviour catalogue belong to Settings (`more/behaviours`); `addCustomTag` is here
// because the check-in's "Add a behaviour" field needs it.
import { z } from "zod";
import type { Store } from "../data/repos";
import { getJournal } from "../queries/journal";
import { ctxOf } from "../queries/common";
import type { JournalVM } from "../queries/types";
import { dataChanged } from "../screens/useScreen";
import { MAX_TAGS, tagKey } from "../journalTags";
import { userTimeZone } from "../profile";
import { localDay } from "../time";
import { inDayRange } from "@/lib/url";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Today's local `YYYY-MM-DD` in the person's time zone (UTC before onboarding). */
const localToday = async (store: Store, now = Math.floor(Date.now() / 1000)) => localDay(now, (await userTimeZone(store)) ?? "UTC");

const Entry = z.object({
  day: z.iso.date(),
  tag: z.string().min(1).max(64),
  // A yes/no behaviour, or a count (e.g. drinks); stored as an integer. null clears the answer: no row
  // means "not answered", which journal impact keeps apart from an answered "no" (0).
  value: z.union([z.boolean(), z.number().int().min(0).max(1000)]).transform(Number).nullable(),
  /** The follow-up slider's answer (minutes after midnight or a count); kept only with a "yes". */
  detail: z.number().int().min(0).max(1440).nullable().optional(),
});

async function writeEntry(store: Store, input: z.input<typeof Entry>): Promise<ActionResult> {
  const r = Entry.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const { day, tag, value } = r.data;
  const detail = value ? (r.data.detail ?? null) : null;
  if (day > (await localToday(store))) return { ok: false, error: "Can’t log a future day" };
  if (!(await store.journal.hasTag(tag))) return { ok: false, error: `Unknown tag: ${tag}` };
  if (value === null) await store.journal.deleteEntry(day, tag);
  else await store.journal.saveEntry({ day, tag, value, detail });
  // Stage 2 reads the journal (impact, Insights, Monitor context) but a check-in is no source change, so mark the day
  // dirty (persistent, survives a restart; stage 1 redoes only that day, to the same result).
  await store.scores.markDirty([day]);
  return { ok: true, data: undefined };
}

/** Upserts (or, with value null, deletes) one (day, tag) for today or a past day. Repeating it changes nothing. */
export async function saveJournalEntry(store: Store, input: z.input<typeof Entry>): Promise<ActionResult> {
  const res = await writeEntry(store, input);
  if (res.ok) dataChanged();
  return res;
}

/**
 * Read-only: the journal's behaviours, a day's answers and note, and the day strip. The sheet opens over any screen
 * (spec §11 UX2), so it fetches what the Journal page would have passed it.
 */
export async function loadCheckIn(store: Store, day: string): Promise<ActionResult<Pick<JournalVM, "tags" | "checkIn" | "strip">>> {
  const r = z.iso.date().safeParse(day);
  if (!r.success) return { ok: false, error: "Invalid day" };
  const ctx = await ctxOf(store);
  if (!inDayRange(r.data, localDay(ctx.now, ctx.timeZone))) return { ok: false, error: "Invalid day" };
  // ponytail: getJournal also builds the strip, history and teaser the sheet drops; a lean query if it ever shows.
  const { tags, checkIn, strip } = await getJournal(ctx, r.data);
  return { ok: true, data: { tags, checkIn, strip } };
}

const Note = z.object({ day: z.iso.date(), text: z.string().max(2000) });

async function writeNote(store: Store, input: z.input<typeof Note>): Promise<ActionResult> {
  const r = Note.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const { day } = r.data;
  const text = r.data.text.trim();
  if (day > (await localToday(store))) return { ok: false, error: "Can’t log a future day" };
  if (!text) await store.journal.deleteNote(day);
  else await store.journal.saveNote(day, text);
  return { ok: true, data: undefined };
}

/** Sets (or, when blank, removes) a day's journal note. Notes feed no score, so nothing is recomputed. */
export async function saveJournalNote(store: Store, input: z.input<typeof Note>): Promise<ActionResult> {
  const res = await writeNote(store, input);
  if (res.ok) dataChanged();
  return res;
}

/**
 * The check-in's Save: each changed answer, then the note (when it changed), one after another as the web sends them,
 * stopping at the first failure. Screens reload once at the end, not once per answer.
 */
export async function saveCheckIn(store: Store, day: string, answers: Omit<z.input<typeof Entry>, "day">[], note: string | null): Promise<ActionResult> {
  let wrote = false;
  try {
    for (const a of answers) {
      const res = await writeEntry(store, { day, ...a });
      if (!res.ok) return res;
      wrote = true;
    }
    if (note !== null) {
      const res = await writeNote(store, { day, text: note });
      if (!res.ok) return res;
      wrote = true;
    }
    return { ok: true, data: undefined };
  } finally {
    if (wrote) dataChanged();
  }
}

const CustomTag = z.object({ label: z.string().trim().min(1).max(40) });

/** Adds a custom tag; its key is the label as snake_case. Fails when that key already exists. */
export async function addCustomTag(store: Store, input: z.input<typeof CustomTag>): Promise<ActionResult<{ tag: string }>> {
  const r = CustomTag.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const { label } = r.data;
  const tag = tagKey(label);
  if (!tag) return { ok: false, error: "Label needs a letter or digit" };
  const added = await store.journal.addTag(tag, label, MAX_TAGS);
  if (added === "exists") return { ok: false, error: `Tag already exists: ${tag}` };
  if (added === "full") return { ok: false, error: `Too many behaviours: the limit is ${MAX_TAGS}` };
  dataChanged();
  return { ok: true, data: { tag } };
}
