// Logging from Pulse (spec §11 LG1): pulse's src/server/actions/log.ts and the validation and entry building of
// src/server/logging.ts (`logFor`). The Google parts (access check, write, mirror in logged_entries, sync cursors) are
// src/google/logging.ts. A write needs a Google token: `tokenSource()` below is where the connect step plugs in. Until
// it does, every write answers pulse's not-connected result (RECONNECT) before anything is stored, as pulse did for a
// grant that could not write.
import { randomUUID } from "expo-crypto";
import { z } from "zod";
import { CYCLE_SYMPTOMS, FLOWS, isCycleKind, MEALS, MOODS, OVULATION_RESULTS, READABLE, RECONNECT, SYMPTOMS, VALENCES } from "@/lib/log";
import type { Store } from "../data/repos";
import { deleteEntry, type LogWriter, type NewEntry } from "../google/log";
import { LOG_MESSAGE, logEntries, logWriter } from "../google/logging";
import type { TokenSource } from "../google/token";
import { getProfile } from "../profile";
import { dataChanged } from "../screens/useScreen";
import { addDays, fromWall, localDay, localMidnight } from "../time";
import type { ActionResult } from "./journal";

/** Where the Google access token comes from. The connect step returns the secure-store source here; null means not connected. */
export const tokenSource = (): TokenSource | null => null;

type Deps = { tokens?: TokenSource | null; writer?: LogWriter; now?: number; newId?: () => string };
const writerOf = (tz: string, d: Deps): LogWriter | null => {
  if (d.writer) return d.writer;
  const tokens = d.tokens === undefined ? tokenSource() : d.tokens;
  return tokens ? logWriter({ tokens, timeZone: tz }) : null;
};

const keys = <T extends readonly (readonly [string, ...unknown[]])[]>(list: T) => list.map((x) => x[0]) as unknown as [T[number][0], ...T[number][0][]];
/** Local wall time `YYYY-MM-DDTHH:mm`; omitted means now. */
const At = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a time").optional();
const grams = z.number().min(0).max(1000).nullable();
const tenth = (g: number | null) => (g === null ? null : Math.round(g * 10) / 10);

const Input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("water"), ml: z.number().int().min(10, "At least 10 ml").max(5000, "At most 5,000 ml"), at: At }),
  z.object({
    kind: z.literal("food"),
    name: z.string().trim().max(80).transform((s) => s || null),
    meal: z.enum(keys(MEALS)),
    kcal: z.number().int().min(0).max(10_000, "At most 10,000 kcal"),
    protein: grams,
    carbs: grams,
    fat: grams,
    at: At,
  }),
  z.object({
    kind: z.literal("weight"),
    kg: z.number().min(20, "Between 20 and 300 kg").max(300, "Between 20 and 300 kg"),
    fatPct: z.number().min(2, "Between 2 and 75%").max(75, "Between 2 and 75%").nullable(),
    at: At,
  }),
  z.object({
    kind: z.literal("mood"),
    moods: z.array(z.enum(keys(MOODS))).min(1, "Choose how you feel").max(5),
    valence: z.enum(keys(VALENCES)).nullable(),
    at: At,
  }),
  z.object({ kind: z.literal("symptoms"), symptoms: z.array(z.enum(keys(SYMPTOMS))).min(1, "Choose a symptom").max(10), at: At }),
  z.object({ kind: z.literal("period"), start: z.iso.date(), end: z.iso.date(), flow: z.enum(keys(FLOWS)).nullable() }),
  z.object({ kind: z.literal("ovulation"), result: z.enum(keys(OVULATION_RESULTS)), at: At }),
]);
export type LogInput = z.input<typeof Input>;

/**
 * Logs water, food, weight (and body fat), mood, symptoms, or (female profiles) a period or ovulation test. On success
 * `needsSync` says Google's totals for the entry's day are waiting for the next sync (the cursors are rewound): the
 * caller that owns sync starts one.
 */
export async function logEntry(store: Store, input: LogInput, deps: Deps = {}): Promise<ActionResult<{ needsSync: boolean }>> {
  const r = Input.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const v = r.data;
  const p = await getProfile(store);
  if (!p) return { ok: false, error: "Finish setting up your profile first" };
  const tz = p.timeZone;
  const female = p.sex === "female";
  // Cycle tracking never exists on a male profile, whatever a request says.
  if (!female && (isCycleKind(v.kind) || (v.kind === "symptoms" && v.symptoms.some((s) => CYCLE_SYMPTOMS.has(s))))) {
    return { ok: false, error: "Not available for this profile" };
  }

  const now = deps.now ?? Math.floor(Date.now() / 1000);
  const today = localDay(now, tz);
  const ts = "at" in v && v.at ? fromWall(v.at, tz) : now;
  if (ts > now + 60) return { ok: false, error: "Can’t log the future" };
  if (ts < now - 366 * 86_400) return { ok: false, error: "Can’t log more than a year back" };

  let entries: NewEntry[];
  switch (v.kind) {
    case "water":
      entries = [{ type: "hydration-log", ts, data: { ml: v.ml } }];
      break;
    case "food":
      // Grams to a tenth, as Google's copy comes back (map.ts), so the sync never rewrites what was logged.
      entries = [{ type: "nutrition-log", ts, data: { name: v.name, meal: v.meal, kcal: v.kcal, protein: tenth(v.protein), carbs: tenth(v.carbs), fat: tenth(v.fat) } }];
      break;
    case "weight":
      entries = [
        { type: "weight", ts, data: { kg: Math.round(v.kg * 10) / 10 } },
        ...(v.fatPct != null ? [{ type: "body-fat" as const, ts, data: { pct: Math.round(v.fatPct * 10) / 10 } }] : []),
      ];
      break;
    case "mood":
      entries = [{ type: "moods", ts, data: { moods: v.moods, valence: v.valence } }];
      break;
    case "symptoms":
      entries = [{ type: "symptoms", ts, data: { symptoms: v.symptoms } }];
      break;
    case "period": {
      if (v.end < v.start) return { ok: false, error: "The last day is before the first" };
      if (v.end > today) return { ok: false, error: "Can’t log a future day" };
      if (v.start < addDays(today, -366)) return { ok: false, error: "Can’t log more than a year back" };
      if (v.end > addDays(v.start, 14)) return { ok: false, error: "A period is 15 days at most" };
      entries = [{ type: "menstrual-period", ts: fromWall(`${v.start}T00:00`, tz), data: { start: v.start, end: v.end, flow: v.flow } }];
      break;
    }
    case "ovulation":
      entries = [{ type: "ovulation-test", ts, data: { result: v.result } }];
      break;
  }

  // Without a token source there is no Google to write to: the web's answer for a grant that cannot write.
  const writer = writerOf(tz, deps);
  if (!writer) return { ok: false, error: RECONNECT };
  const res = await logEntries(store, entries, { tz, writer, now, newId: deps.newId ?? randomUUID });
  dataChanged(); // entries before a failure stay (a weigh-in is two points), as pulse revalidated either way
  if (!res.ok) return { ok: false, error: LOG_MESSAGE[res.reason] };
  return { ok: true, data: { needsSync: !!res.needsSync } };
}

const Delete = z.object({ id: z.uuid() });

/** Deletes a logged entry here and, when it was written there, at Google. */
export async function deleteLogEntry(store: Store, input: z.input<typeof Delete>, deps: Deps = {}): Promise<ActionResult<{ needsSync: boolean }>> {
  const r = Delete.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const tz = (await store.profile.userTimeZone()) ?? "UTC";
  const held = await store.log.entryById(r.data.id);
  // An entry Google holds can only be deleted through Google: with no token source it is not deleted here either.
  const writer = writerOf(tz, deps);
  if (held?.googleName && !writer) return { ok: false, error: RECONNECT };
  const res = await deleteEntry(store, r.data.id, writer);
  if (!res.ok) {
    dataChanged(); // a weigh-in is two deletes: the first may have gone
    return { ok: false, error: LOG_MESSAGE[res.reason] };
  }
  const readable = !!res.type && !!res.day && READABLE.has(res.type);
  // The sync owns water, food and weight totals: have it re-read the entry's day.
  if (readable) await store.settings.rewindSyncCursor(res.type!, localMidnight(res.day!, tz));
  dataChanged();
  return { ok: true, data: { needsSync: readable } };
}
