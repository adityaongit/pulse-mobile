// Incremental stage 2 (Pulse-only; halo's stage 2 replays every day). Stage 2 is a fold, oldest day first, and day D's
// scores read only days up to D + 1 (tonight's sleep: Energy Bank, Stress). So the fold as it stood before day C,
// together with the rows already stored for the days before C, is what a full replay would give again, as long as no
// input of a day up to C + 1 changed. Each run keeps that fold for a day near the end, with a key per day of that day's
// inputs, in the Store (one JSON row), so a background run or the first run after a launch resumes too; the next run
// starts from it when the keys match, and replays every day otherwise.
import { PULSE_AGE_BP_MANIFEST } from "@/core/engine/pulseAgeBp";
import type { Store } from "@/data/store";
import { FEATURES } from "@/lib/features";
import { addDays } from "@/lib/time";
import { type Data, sha } from "./data";
import { type Fold, type Inputs, newFold } from "./scores";
import { type PipelineOptions, SCORING_VERSION } from "./types";

/** The fold is kept as it stood before this many days from the end: covers the sync window and recent journal edits. */
export const CHECKPOINT_DAYS = 14;

type Checkpoint = { key: string; last: string; day: string; fold: Fold; days: [string, string][] };

/** Drops the Store's checkpoint, so the next run replays every day. */
export const dropCheckpoint = (store: Store) => store.putCheckpoint(null);

// JSON keeps the fold's numbers exactly; NaN, ±Infinity and undefined, which it would turn into null or drop, are tagged.
const encode = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) => (typeof x === "number" && !Number.isFinite(x) ? { $n: String(x) } : x === undefined ? { $u: 1 } : x));
const decode = (s: string): unknown =>
  JSON.parse(s, (_k, x: unknown) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return x;
    const keys = Object.keys(x);
    if (keys.length !== 1) return x;
    if (keys[0] === "$n") return Number((x as { $n: string }).$n);
    return keys[0] === "$u" ? undefined : x;
  });

/** The stored checkpoint, or null when there is none or it no longer fits this code's fold. */
async function load(store: Store): Promise<Checkpoint | null> {
  try {
    const raw = await store.getCheckpoint();
    if (!raw) return null;
    const cp = decode(raw) as Checkpoint;
    // A fold from another build: SCORING_VERSION in the key usually catches it, the shape check the rest.
    const shape = (o: object) => JSON.stringify(Object.keys(o).sort());
    return cp.fold && shape(cp.fold) === shape(newFold()) ? cp : null;
  } catch {
    return null;
  }
}

/** The fold as it stands, for `keep` once the run has written everything. */
export const snapshot = (f: Fold) => clone(f);

/** A deep copy of the fold's plain objects and arrays; anything else in it would not copy, so it throws. */
function clone<T>(v: T): T {
  if (v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(clone) as T;
  if (Object.getPrototypeOf(v) !== Object.prototype) throw new Error("checkpoint: the fold holds a non-plain object");
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
}

/** What stage 2 reads for one day, as a key: its daily row, sessions with their stages, workouts, stage 1 row and journal. */
function dayKeys(data: Data, inputs: Inputs, journal: Map<string, unknown[]>) {
  return new Map(
    data.days.map((d) => {
      const c = inputs.cached.get(d);
    const sessions = (data.sessionsByDay.get(d) ?? []).map((s) => [s, inputs.segments.get(s.id) ?? null]);
    const parts = [
      data.metrics.get(d) ?? null,
      sessions,
      data.exercisesByDay.get(d) ?? [],
      data.bloodPressureByDay.get(d) ?? [],
      c ? [c.s1, c.activities, c.sessionRhr] : null,
      journal.get(d) ?? [],
    ];
    return [d, sha(JSON.stringify(parts))];
    }),
  );
}

/**
 * Where stage 2 can start: the kept day and a copy of the fold before it, or day 0 and a fresh fold. `rerun` are the days
 * stage 1 redid, whose per-minute series may have changed. Clears the checkpoint: `keep` sets the next one.
 */
export async function resume(store: Store, data: Data, inputs: Inputs, journal: Map<string, unknown[]>, opts: PipelineOptions, rerun: string[]) {
  const key = sha(JSON.stringify([SCORING_VERSION, FEATURES.bpPulseAge, PULSE_AGE_BP_MANIFEST.modelVersion, PULSE_AGE_BP_MANIFEST.bpFeatureVersion, opts, data.first]));
  const keys = dayKeys(data, inputs, journal);
  const cp = await load(store);
  const kept = cp && new Map(cp.days);
  await dropCheckpoint(store);
  const at = cp ? data.days.indexOf(cp.day) : -1;
  // Up to C + 1: day C − 1 reads day C's sessions as tonight's sleep; one spare day beyond.
  const upTo = cp && addDays(cp.day, 2);
  const ok =
    cp &&
    at >= 0 &&
    cp.key === key &&
    data.last >= cp.last &&
    !rerun.some((d) => d <= upTo!) &&
    data.days.every((d) => d > upTo! || keys.get(d) === kept!.get(d));
  const keepAt = Math.max(0, data.days.length - CHECKPOINT_DAYS);
  const keep = (fold: Fold) => store.putCheckpoint(encode({ key, last: data.last, day: data.days[keepAt], fold, days: [...keys] } satisfies Checkpoint));
  return { start: ok ? at : 0, fold: ok ? cp.fold : null, keepAt, keep };
}
