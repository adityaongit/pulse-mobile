// Journal `/journal`, Behaviour insights `/journal/insights` and More › Behaviours, ported from Pulse's
// src/server/queries/journal.ts, with the tag-table helpers of src/server/journalTags.ts. Every Postgres read is a
// Store read; the VM shapes are the web's (types.ts).
import { i18n } from "@/i18n/config";
import { behavior } from "@/lib/behaviors";
import type { ImpactMetric, TagImpact } from "@/core/algorithms/journalImpact";
import type { JournalEntry } from "@/data/types";
import type { JournalTagRow, Store } from "@/data/store";
import { addDays } from "@/lib/time";
import type { JournalImpactRow } from "@/pipeline/types";
import { finite, loadDays, meanSd, type QueryCtx, todayOf } from "./common";
import type { BehavioursVM, ImpactMetricKey, JournalInsightsVM, JournalTag, JournalVM } from "./types";


// ── journalTags.ts ──────────────────────────────────────────────────────────

/** The Journal's default behaviours, shared by both data sources (and the demo generator's DEFAULT_JOURNAL_TAGS). */
export const DEFAULT_JOURNAL_TAGS = [
  { tag: "alcohol", label: "Alcohol" },
  { tag: "late_caffeine", label: "Late caffeine" },
  { tag: "late_meal", label: "Late meal" },
  { tag: "screen_in_bed", label: "Screen in bed" },
  { tag: "meditation", label: "Meditation" },
  { tag: "stretching", label: "Stretching" },
  { tag: "sauna", label: "Sauna" },
  { tag: "travel", label: "Travel" },
  { tag: "illness", label: "Illness" },
] as const;

/** Inserts any missing default tag; existing rows (and custom tags) are left alone. Returns rows inserted. */
export async function ensureDefaultTags(store: Store): Promise<number> {
  const added = await store.insertJournalTags(DEFAULT_JOURNAL_TAGS.map(({ tag, label }) => ({ tag, label, isDefault: true, hidden: false, position: 0 })));
  return added.length;
}

/** A custom tag's key: the label as snake_case ("Cold plunge" → "cold_plunge"); "" when it has no letter or digit. */
export const tagKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** Most tags (defaults included) a person can have. Insights bootstrap every tag on every recompute, so this bounds that work. */
export const MAX_TAGS = 60;

/**
 * The tag rows, the defaults first ensured. The web inserts them at sign-up and on the worker's first run; on the
 * phone they are inserted the first time anything reads the tags (and again after `clearAll`), a no-op afterwards.
 */
export async function tagRows(store: Store): Promise<JournalTagRow[]> {
  const rows = await store.journalTags();
  const have = new Set(rows.map((r) => r.tag));
  if (DEFAULT_JOURNAL_TAGS.every((t) => have.has(t.tag))) return rows;
  await ensureDefaultTags(store);
  return store.journalTags();
}

/** Adds a custom tag at the end of its group. "exists" when the key is taken, "full" at MAX_TAGS. */
export async function addTag(store: Store, tag: string, label: string): Promise<"added" | "exists" | "full"> {
  const rows = await tagRows(store);
  if (rows.some((r) => r.tag === tag)) return "exists";
  if (rows.length >= MAX_TAGS) return "full";
  const position = rows.reduce((m, r) => Math.max(m, r.position), 0) + 1;
  const added = await store.insertJournalTags([{ tag, label, isDefault: false, hidden: false, position }]);
  return added.length ? "added" : "exists";
}

/** Hides a tag from the check-in sheet or shows it again. Its answers are untouched. False for an unknown tag. */
export async function setTagHidden(store: Store, tag: string, hidden: boolean): Promise<boolean> {
  if (!(await tagRows(store)).some((r) => r.tag === tag)) return false;
  await store.updateJournalTags([{ tag, hidden }]);
  return true;
}

/**
 * Orders `tags` (one check-in group, in its new order) by writing their positions 0..n-1. Other groups keep
 * theirs: groups render apart, so only the order inside a group matters. False, writing nothing, if any tag is unknown.
 */
export async function reorderTags(store: Store, tags: string[]): Promise<boolean> {
  if (new Set(tags).size !== tags.length) return false;
  if (!tags.length) return true;
  const known = new Set((await tagRows(store)).map((r) => r.tag));
  if (!tags.every((t) => known.has(t))) return false;
  await store.updateJournalTags(tags.map((tag, position) => ({ tag, position })));
  return true;
}

// ── queries/journal.ts ──────────────────────────────────────────────────────

const GROUP: Record<string, JournalTag["group"]> = {
  alcohol: "evening",
  late_caffeine: "evening",
  late_meal: "evening",
  screen_in_bed: "evening",
  meditation: "recovery",
  stretching: "recovery",
  sauna: "recovery",
  travel: "context",
  illness: "context",
};

/**
 * A tag's name as shown. The store keeps the English name a default tag was seeded with (stored text is never
 * translated), so a tag whose stored name is its catalogue's English name shows the catalogue's name in the language in
 * use; a name the person typed is shown as typed.
 */
function shownLabel(tag: string, stored: string): string {
  const b = behavior(tag);
  return b && stored === (i18n.t(`journal:behavior.${tag}` as never, { lng: "en" } as never) as unknown as string) ? b.label : stored;
}

/** Every tag, hidden ones included, in check-in order (position inside a group, then insertion order). */
async function tagsOf(ctx: QueryCtx): Promise<JournalTag[]> {
  const rows = await tagRows(ctx.store);
  return rows.map((r) => ({ tag: r.tag, label: shownLabel(r.tag, r.label), isDefault: r.isDefault, hidden: r.hidden, group: GROUP[r.tag] ?? "custom" }));
}

/** More › Behaviours: every tag, hidden ones included, with how many days answered it. */
export async function getBehaviours(ctx: QueryCtx): Promise<BehavioursVM> {
  const [tags, entries] = await Promise.all([tagsOf(ctx), ctx.store.allJournal()]);
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.tag, (counts.get(e.tag) ?? 0) + 1);
  return { tags: tags.map((t) => ({ ...t, answers: counts.get(t.tag) ?? 0 })) };
}

const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Entries with from <= day <= to, by day then tag. */
async function entriesBetween(ctx: QueryCtx, from: string, to: string): Promise<JournalEntry[]> {
  return (await ctx.store.allJournal()).filter((e) => e.day >= from && e.day <= to).sort((a, b) => byteOrder(a.day, b.day) || byteOrder(a.tag, b.tag));
}

/**
 * The newest stored journal impact on or before today. Stage 2 writes one for every scored day, so the last fortnight
 * nearly always has it; otherwise every stored day is searched.
 */
async function latestImpact(ctx: QueryCtx): Promise<{ asOf: string; impacts: TagImpact[] } | null> {
  const today = todayOf(ctx);
  const pick = (rows: { day: string; journal_impact: JournalImpactRow | null }[]) => {
    let best: { asOf: string; impacts: TagImpact[] } | null = null;
    for (const r of rows) if (r.journal_impact && r.day <= today && (!best || r.day > best.asOf)) best = { asOf: r.day, impacts: r.journal_impact.impacts };
    return best;
  };
  return (
    pick(await ctx.store.scoresIn({ from: addDays(today, -13), to: today })) ??
    pick(await ctx.store.scoresIn({ from: ctx.sync.firstDay ?? "0000-01-01", to: addDays(today, -14) }))
  );
}

/** Journal `/journal` for `day` (spec §7.11). */
export async function getJournal(day: string, ctx: QueryCtx): Promise<JournalVM> {
  const today = todayOf(ctx);
  const stripStart = day < addDays(today, -29) ? day : addDays(today, -29);
  const [tags, entries, impact] = await Promise.all([tagsOf(ctx), entriesBetween(ctx, stripStart, today), latestImpact(ctx)]);
  const label = new Map(tags.map((t) => [t.tag, t.label]));
  const byDay = new Map<string, typeof entries>();
  for (const e of entries) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);

  const strip: JournalVM["strip"] = [];
  for (let d = stripStart; d <= today; d = addDays(d, 1)) strip.push({ day: d, done: byDay.has(d) });
  const mine = byDay.get(day) ?? [];
  const yesOf = (es: typeof entries) => es.filter((e) => e.value > 0).map((e) => ({ tag: e.tag, label: label.get(e.tag) ?? e.tag }));

  const strongest = impact?.impacts.find((t) => t.effects.recovery.label === "positive" || t.effects.recovery.label === "negative");
  const teaser = strongest
    ? {
        ready: true,
        text: i18n.t(strongest.effects.recovery.delta! < 0 ? "journal:teaser.lowers" : "journal:teaser.raises", {
          behaviour: (label.get(strongest.tag) ?? strongest.tag).toLowerCase(),
          pct: Math.abs(Math.round(strongest.effects.recovery.delta!)),
        }),
      }
    : { ready: false, text: i18n.t("journal:teaser.notReady") };

  const history: JournalVM["history"] = [];
  for (let d = today; d >= addDays(today, -29); d = addDays(d, -1)) {
    const es = byDay.get(d);
    if (es) history.push({ day: d, yes: yesOf(es).map((y) => y.label) });
  }

  return {
    day,
    today,
    strip,
    // Hidden behaviours leave the check-in sheet; their answers stay, still label History and still count in insights.
    tags: tags.filter((t) => !t.hidden),
    checkIn: { done: mine.length > 0, entries: Object.fromEntries(mine.map((e) => [e.tag, e.value])), yes: yesOf(mine) },
    teaser,
    history,
  };
}

const METRIC: Record<ImpactMetricKey, ImpactMetric> = { recovery: "recovery", hrv: "hrvZ", sleep: "sleepPerf" };

/** Journal Insights `/journal/insights?m=` (spec §7.12): effects on next-day Recovery, HRV (SD) or sleep. */
export async function getJournalInsights(metric: ImpactMetricKey = "recovery", ctx: QueryCtx): Promise<JournalInsightsVM> {
  const key = METRIC[metric];
  const unit = metric === "hrv" ? "SD" : "%";
  const impact = await latestImpact(ctx);
  if (!impact) return { metric, unit, items: [], needsMore: [] };
  const from = addDays(impact.asOf, -90);
  const [tags, entries, rows] = await Promise.all([tagsOf(ctx), entriesBetween(ctx, from, addDays(impact.asOf, -1)), loadDays(ctx, addDays(from, 1), impact.asOf)]);
  const label = new Map(tags.map((t) => [t.tag, t.label]));
  const outcome = (day: string) => {
    const r = rows.get(day);
    return key === "recovery" ? r?.recovery?.value : key === "hrvZ" ? r?.recovery?.hrvZ : r?.sleep?.performance;
  };
  const arms = (tag: string) => {
    const yes: (number | null | undefined)[] = [];
    const no: (number | null | undefined)[] = [];
    for (const e of entries) if (e.tag === tag) (e.value > 0 ? yes : no).push(outcome(addDays(e.day, 1)));
    return { avgWith: meanSd(yes.filter(finite)).mean, avgWithout: meanSd(no.filter(finite)).mean };
  };

  const items: JournalInsightsVM["items"] = [];
  const needsMore: JournalInsightsVM["needsMore"] = [];
  for (const t of impact.impacts) {
    const e = t.effects[key];
    const name = label.get(t.tag) ?? t.tag;
    if (e.label === "not_enough_data" || e.delta == null) {
      needsMore.push({ key: t.tag, label: name, yes: e.nYes, no: e.nNo });
      continue;
    }
    items.push({
      key: t.tag,
      label: name,
      delta: e.delta,
      effect: e.label === "positive" ? "positive" : e.label === "negative" ? "negative" : "none",
      yes: e.nYes,
      no: e.nNo,
      ci: [e.ciLow!, e.ciHigh!],
      ...arms(t.tag),
    });
  }
  items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key));
  return { metric, unit, items, needsMore };
}
