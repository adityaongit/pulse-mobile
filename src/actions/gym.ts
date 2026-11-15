// The gym log's writes: starting a session, ticking a set, finishing, routines, measurements and the Strong import.
// Plain TypeScript over the Store, like the journal's actions, so the tests run on the in-memory store. The screens
// reload with `dataChanged()` after a write; nothing here touches Health Connect or the scoring pipeline.
import { BY_ID, resolveExerciseId } from "@/core/gym/catalogue";
import { importStrongCsv, type ImportSummary } from "@/core/gym/csv";
import { estimate1Rm } from "@/core/gym/load";
import { planItemsOf } from "@/core/gym/plan";
import { groupByExercise, isWorkSet, previousSets } from "@/core/gym/stats";
import type { BodyPart, Equipment, GymExercise, GymMeasurement, GymRoutine, GymRoutineItem, GymSession, GymSet, MeasurementKind, SetType, WeightUnit } from "@/core/gym/types";
import { MEASUREMENTS } from "@/core/gym/types";
import { EMPTY_IMPORT, type GymImportState } from "@/data/gym";
import type { Store } from "@/data/store";
import { exerciseMap } from "@/queries/gym";
import { newId, slug } from "@/lib/ids";
import { localDay } from "@/lib/time";
import { slice } from "@/lib/yield";
import type { ActionCtx } from "@/state/app";

export type GymResult<T = undefined> = { ok: true; data: T } | { ok: false; error: GymError };
export type GymError = "invalid" | "notFound" | "emptyFile" | "notStrong" | "nothingToImport";

const nowOf = (c: ActionCtx) => (c.nowS ? c.nowS() : Math.floor(Date.now() / 1000));
const fail = (error: GymError) => ({ ok: false as const, error });

/** A custom exercise's id: its slug, or a suffixed one when the name is already taken by another row. */
function customId(name: string, taken: Set<string>): string {
  const base = slug(name) || "exercise";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Adds the owner's own exercise (or returns the one with that name). The catalogue keeps its own ids. */
export async function createExercise(store: Store, input: { name: string; bodyPart?: BodyPart; equipment?: Equipment; hold?: boolean }): Promise<GymExercise> {
  const name = input.name.trim().slice(0, 60);
  const known = resolveExerciseId(name);
  const map = await exerciseMap(store);
  if (known && map.has(known)) return map.get(known)!;
  const existing = [...map.values()].find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const ex: GymExercise = {
    id: customId(name, new Set(map.keys())),
    name: name || "Exercise",
    bodyPart: input.bodyPart ?? "full body",
    equipment: input.equipment ?? "other",
    custom: true,
    hold: input.hold === true,
    unit: "kg",
    note: null,
  };
  await store.putGymExercises([ex]);
  return ex;
}

/** Sets an exercise's unit (Strong keeps this per exercise). The row is stored even for a catalogue exercise. */
export async function setExerciseUnit(store: Store, exercise: GymExercise, unit: WeightUnit): Promise<void> {
  await store.putGymExercises([{ ...exercise, unit }]);
}

// ── sessions ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The session still in progress, if there is one. A phone holds one workout at a time. */
export async function activeSession(store: Store): Promise<GymSession | null> {
  const sessions = await store.gymSessions();
  return sessions.find((s) => !s.finished) ?? null;
}

export type StartInput = { name?: string; routineId?: string };

/**
 * Starts a session, or hands back the one already running. Started from a routine, its exercises arrive as sets with
 * the planned count and reps; a set whose weight was logged last time is filled with that weight, so the first tick of
 * a familiar lift needs no typing. Started empty, it has no exercises yet.
 */
export async function startSession(c: ActionCtx, input: StartInput = {}): Promise<GymResult<{ session: GymSession; sets: GymSet[] }>> {
  const running = await activeSession(c.store);
  if (running) return { ok: true, data: { session: running, sets: await c.store.gymSets([running.id]) } };
  const now = nowOf(c);
  const { routines, items } = await c.store.gymRoutines();
  const routine = input.routineId ? routines.find((r) => r.id === input.routineId) : undefined;
  const session: GymSession = {
    id: newId(),
    day: localDay(now, c.timeZone),
    startTs: now,
    endTs: null,
    name: (input.name ?? routine?.name ?? "").trim() || "Workout",
    notes: null,
    routineId: routine?.id ?? null,
    finished: false,
    restStartedTs: null,
    restSec: null,
  };
  await c.store.putGymSession(session);
  const planned = items.filter((i) => i.routineId === routine?.id).sort((a, b) => a.position - b.position);
  // The last session's numbers, per exercise: the weight a set starts with, so the log opens ready to tick.
  const exerciseIds = [...new Set(planned.map((i) => i.exerciseId))];
  const earlier = exerciseIds.length ? await c.store.gymExerciseSets(exerciseIds, now) : [];
  const map = await exerciseMap(c.store);
  const sets: GymSet[] = [];
  planned.forEach((item, position) => {
    const exercise = map.get(item.exerciseId);
    const previous = previousSets(earlier, item.exerciseId, now);
    const work = previous ? [...previous.byNo.values()].filter(isWorkSet).sort((a, b) => b.setNo - a.setNo) : [];
    const lastWeight = work[0]?.weightKg ?? 0;
    const lastReps = work[0]?.reps ?? 0;
    const count = item.sets > 0 ? Math.min(20, item.sets) : 1;
    for (let n = 1; n <= count; n++) {
      const p = previous?.byNo.get(n);
      const used = p && isWorkSet(p) ? p : null;
      sets.push({
        id: newId(),
        sessionId: session.id,
        exerciseId: item.exerciseId,
        position,
        setNo: n,
        weightKg: used?.weightKg ?? lastWeight,
        reps: used && used.reps > 0 ? used.reps : item.reps || lastReps,
        seconds: exercise?.hold ? 30 : null,
        distanceM: null,
        rpe: null,
        type: "normal",
        supersetId: null,
        completed: false,
        ts: null,
        note: null,
      });
    }
  });
  // One transaction for the whole first set list: fifteen separate writes is a visible wait before the page opens.
  await c.store.putGymSets(sets);
  return { ok: true, data: { session, sets } };
}

/** Adds an exercise to a session's end, with `count` sets prefilled from the last time it was trained. */
export async function addExerciseToSession(store: Store, session: GymSession, exercise: GymExercise, opts: { count?: number; reps?: number; weightKg?: number } = {}): Promise<GymSet[]> {
  const existing = await store.gymSets([session.id]);
  const position = existing.length ? Math.max(...existing.map((s) => s.position)) + 1 : 0;
  const count = Math.max(1, Math.min(20, opts.count ?? 3));
  const earlier = await store.gymExerciseSets([exercise.id], session.startTs);
  const previous = previousSets(earlier, exercise.id, session.startTs);
  const work = previous ? [...previous.byNo.values()].filter(isWorkSet).sort((a, b) => b.setNo - a.setNo) : [];
  const sets: GymSet[] = [];
  for (let n = 1; n <= count; n++) {
    const p = previous?.byNo.get(n);
    const used = p && isWorkSet(p) ? p : null;
    sets.push({
      id: newId(),
      sessionId: session.id,
      exerciseId: exercise.id,
      position,
      setNo: n,
      weightKg: opts.weightKg ?? used?.weightKg ?? work[0]?.weightKg ?? 0,
      reps: opts.reps ?? (exercise.hold ? 0 : used?.reps ?? work[0]?.reps ?? 10),
      seconds: exercise.hold ? 30 : null,
      distanceM: null,
      rpe: null,
      type: "normal",
      supersetId: null,
      completed: false,
      ts: null,
      note: null,
    });
  }
  await store.putGymSets(sets);
  return sets;
}

/** Writes one set as it stands: every tick, and every edit, is its own small write. */
export async function saveSet(store: Store, set: GymSet): Promise<GymResult<GymSet>> {
  if (!Number.isFinite(set.weightKg) || set.weightKg < 0 || set.weightKg > 1000) return fail("invalid");
  if (!Number.isInteger(set.reps) || set.reps < 0 || set.reps > 1000) return fail("invalid");
  if (set.rpe != null && (set.rpe < 1 || set.rpe > 10)) return fail("invalid");
  const clean: GymSet = {
    ...set,
    weightKg: Math.round(set.weightKg * 1000) / 1000,
    reps: Math.max(0, Math.round(set.reps)),
    seconds: set.seconds != null && set.seconds > 0 ? Math.round(set.seconds) : null,
    distanceM: set.distanceM != null && set.distanceM > 0 ? Math.round(set.distanceM * 10) / 10 : null,
    note: set.note?.trim() || null,
  };
  await store.putGymSet(clean);
  return { ok: true, data: clean };
}

/** Ticking or unticking a set: `ts` is the moment it was ticked, and the rest timer starts on a tick. */
export async function tickSet(store: Store, set: GymSet, on: boolean, now: number): Promise<GymSet> {
  const next: GymSet = { ...set, completed: on, ts: on ? now : null };
  await store.putGymSet(next);
  return next;
}

/** Deletes a set and renumbers the rest of its exercise 1..n, so the left column has no gap. */
export async function deleteSet(store: Store, set: GymSet): Promise<void> {
  await store.deleteGymSet(set.id);
  const rest = (await store.gymSets([set.sessionId])).filter((s) => s.exerciseId === set.exerciseId && s.id !== set.id);
  for (const [i, s] of rest.sort((a, b) => a.setNo - b.setNo).entries()) {
    if (s.setNo !== i + 1) await store.putGymSet({ ...s, setNo: i + 1 });
  }
}

/** Puts a deleted set back at its old number, moving the ones after it along. The undo of `deleteSet`. */
export async function restoreSet(store: Store, set: GymSet): Promise<void> {
  const rest = (await store.gymSets([set.sessionId])).filter((s) => s.exerciseId === set.exerciseId && s.id !== set.id);
  for (const s of rest.filter((s) => s.setNo >= set.setNo).sort((a, b) => b.setNo - a.setNo)) {
    await store.putGymSet({ ...s, setNo: s.setNo + 1 });
  }
  await store.putGymSet(set);
}

/** Puts an exercise's deleted sets back, all at once (the undo of removing the exercise). If the exercise has been
 *  added back in the meantime, the restored sets go after the new ones rather than landing on their numbers. */
export async function restoreSets(store: Store, sets: GymSet[]): Promise<void> {
  if (!sets.length) return;
  const { sessionId, exerciseId } = sets[0];
  const existing = (await store.gymSets([sessionId])).filter((s) => s.exerciseId === exerciseId);
  const after = existing.length;
  await store.putGymSets(
    sets
      .slice()
      .sort((a, b) => a.setNo - b.setNo)
      .map((s, i) => ({ ...s, setNo: after + i + 1 })),
  );
}

/** The unticked sets of one exercise go: it is skipped for today, the sets already done stay and renumber without a gap. */
export async function skipExercise(store: Store, sessionId: string, exerciseId: string): Promise<GymSet[]> {
  return skipSets(store, sessionId, (s) => s.exerciseId === exerciseId);
}

/** Every unticked set goes before the workout is finished: what was not done is not part of it. Returns how many went. */
export async function skipPendingSets(store: Store, sessionId: string): Promise<number> {
  return (await skipSets(store, sessionId, () => true)).length;
}

async function skipSets(store: Store, sessionId: string, match: (s: GymSet) => boolean): Promise<GymSet[]> {
  const sets = await store.gymSets([sessionId]);
  const removed = sets.filter((s) => !s.completed && match(s));
  for (const s of removed) await store.deleteGymSet(s.id);
  for (const exerciseId of new Set(removed.map((s) => s.exerciseId))) {
    const left = sets.filter((s) => s.exerciseId === exerciseId && s.completed).sort((a, b) => a.setNo - b.setNo);
    for (const [i, s] of left.entries()) if (s.setNo !== i + 1) await store.putGymSet({ ...s, setNo: i + 1 });
  }
  return removed;
}

/** A new blank set at the end of an exercise, copied from the last one's weight and reps. */
export async function addSet(store: Store, sessionId: string, exerciseId: string): Promise<GymSet | null> {
  const sets = await store.gymSets([sessionId]);
  const mine = sets.filter((s) => s.exerciseId === exerciseId).sort((a, b) => a.setNo - b.setNo);
  const tail = mine[mine.length - 1];
  if (!tail) return null;
  // A drop or a failure set is not the next set's plan: copy the last ordinary set, or the tail when there is none.
  const last = [...mine].reverse().find((s) => s.type === "normal") ?? tail;
  const set: GymSet = {
    id: newId(),
    sessionId,
    exerciseId,
    position: tail.position,
    setNo: (tail.setNo ?? mine.length) + 1,
    weightKg: last.weightKg,
    reps: last.reps,
    seconds: last.seconds,
    distanceM: last.distanceM,
    rpe: null,
    type: "normal",
    supersetId: tail.supersetId,
    completed: false,
    ts: null,
    note: null,
  };
  await store.putGymSet(set);
  return set;
}

/** Ends a workout: finished, with the length it took. */
export async function finishSession(store: Store, session: GymSession, now: number): Promise<GymSession> {
  const done: GymSession = { ...session, finished: true, endTs: Math.max(now, session.startTs + 1), restStartedTs: null, restSec: null };
  await store.putGymSession(done);
  return done;
}

/** Throws a session away, sets and all. */
export async function discardSession(store: Store, id: string): Promise<void> {
  await store.deleteGymSession(id);
}

export async function updateSession(store: Store, session: GymSession, patch: Partial<Pick<GymSession, "name" | "notes" | "day" | "startTs" | "endTs" | "routineId">>): Promise<GymSession> {
  const next = { ...session, ...patch, name: (patch.name ?? session.name).trim().slice(0, 60) || session.name };
  await store.putGymSession(next);
  return next;
}

/** Starts the rest timer (a ticked set asks for it); `seconds` is what the exercise or the app default says. */
export async function startRest(store: Store, session: GymSession, seconds: number, now: number): Promise<GymSession> {
  const next = { ...session, restStartedTs: now, restSec: Math.max(5, Math.min(900, Math.round(seconds))) };
  await store.putGymSession(next);
  return next;
}

export async function stopRest(store: Store, session: GymSession): Promise<GymSession> {
  const next = { ...session, restStartedTs: null, restSec: null };
  await store.putGymSession(next);
  return next;
}

/** Adds or takes away rest seconds while the bar runs, keeping when it started so the countdown stays true. */
export async function adjustRest(store: Store, session: GymSession, delta: number): Promise<GymSession> {
  if (!session.restStartedTs || !session.restSec) return session;
  const next = { ...session, restSec: Math.max(5, Math.min(900, session.restSec + Math.round(delta))) };
  await store.putGymSession(next);
  return next;
}

/** Moves an exercise one slot up or down in the running workout, taking all of its sets with it. */
export async function moveExercise(store: Store, sessionId: string, exerciseId: string, delta: -1 | 1): Promise<void> {
  const sets = await store.gymSets([sessionId]);
  const blocks = groupByExercise(sets);
  const at = blocks.findIndex((b) => b.exerciseId === exerciseId);
  const swap = blocks[at + delta];
  if (at < 0 || !swap) return;
  const here = blocks[at];
  await store.putGymSets(
    sets.map((s) =>
      s.exerciseId === here.exerciseId ? { ...s, position: swap.position } : s.exerciseId === swap.exerciseId ? { ...s, position: here.position } : s,
    ),
  );
}

/** Sets a workout's exercises in the given order, taking every set with its exercise. */
export async function reorderExercises(store: Store, sessionId: string, ordered: string[]): Promise<void> {
  const at = new Map(ordered.map((id, position) => [id, position]));
  const sets = await store.gymSets([sessionId]);
  await store.putGymSets(sets.map((s) => ({ ...s, position: at.get(s.exerciseId) ?? s.position })));
}

/**
 * Ties two exercises of a session into a superset (no rest between them) by giving their sets one id, or unties them
 * with `supersetId: null`. The partner is the exercise's sets, so the badge follows every set of both.
 */
export async function setSuperset(store: Store, sessionId: string, exerciseId: string, partnerId: string | null, supersetId: string | null): Promise<void> {
  const sets = (await store.gymSets([sessionId])).filter((s) => s.exerciseId === exerciseId || s.exerciseId === partnerId);
  await store.putGymSets(sets.map((s) => ({ ...s, supersetId })));
}

// ── routines ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type RoutineInput = { id?: string; name: string; notes?: string | null; items: { exerciseId: string; sets: number; reps: number; restSec?: number | null }[] };

export async function saveRoutine(store: Store, input: RoutineInput, now: number): Promise<GymResult<GymRoutine>> {
  const name = input.name.trim().slice(0, 60);
  if (!name) return fail("invalid");
  if (!input.items.length) return fail("invalid");
  const { routines } = await store.gymRoutines();
  const id = input.id ?? newId();
  const exists = routines.find((r) => r.id === id);
  const routine: GymRoutine = {
    id,
    name,
    notes: input.notes?.trim() || null,
    position: exists?.position ?? routines.length,
    updatedAt: now,
  };
  const items: GymRoutineItem[] = input.items.map((i, position) => ({
    routineId: id,
    exerciseId: i.exerciseId,
    position,
    sets: Math.max(0, Math.min(20, Math.round(i.sets))),
    reps: Math.max(0, Math.min(100, Math.round(i.reps))),
    restSec: i.restSec ?? null,
    note: null,
  }));
  await store.putGymRoutine(routine, items);
  return { ok: true, data: routine };
}

export async function deleteRoutine(store: Store, id: string): Promise<void> {
  await store.deleteGymRoutine(id);
}

/** Sets the templates' order, each keeping its planned exercises. */
export async function reorderRoutines(store: Store, ordered: string[], now: number): Promise<void> {
  const at = new Map(ordered.map((id, position) => [id, position]));
  const { routines, items } = await store.gymRoutines();
  for (const routine of routines) {
    const position = at.get(routine.id);
    if (position === undefined || position === routine.position) continue;
    await store.putGymRoutine({ ...routine, position, updatedAt: now }, items.filter((i) => i.routineId === routine.id));
  }
}

/**
 * Turns a finished workout into a template: its working exercises, the sets each was done for, and the most common
 * reps. The next session with that name then opens with the same shape. A name already in the templates gets a number.
 */
export async function saveSessionAsRoutine(store: Store, session: GymSession, now: number): Promise<GymRoutine | null> {
  const sets = (await store.gymSets([session.id])).filter(isWorkSet);
  if (!sets.length) return null;
  const items = planItemsOf(sets);
  if (!items.length) return null;
  const { routines } = await store.gymRoutines();
  const taken = new Set(routines.map((r) => r.name.toLowerCase()));
  const base = session.name.trim() || "Workout";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  const res = await saveRoutine(
    store,
    { name, items: items.map(({ exerciseId, sets: count, reps }) => ({ exerciseId, sets: count, reps })) },
    now,
  );
  return res.ok ? res.data : null;
}

/**
 * Makes the session's template match what is being done: the exercises still in it, each with its set count and most
 * common reps. The template keeps its name and position; the next session from it starts with this shape, not the old
 * exercises. A session that did not start from a template has nothing to update.
 */
export async function updateRoutineFromSession(store: Store, session: GymSession, now: number): Promise<GymRoutine | null> {
  if (!session.routineId) return null;
  const sets = (await store.gymSets([session.id])).filter(isWorkSet);
  if (!sets.length) return null;
  const { routines } = await store.gymRoutines();
  const routine = routines.find((r) => r.id === session.routineId);
  if (!routine) return null;
  const items = planItemsOf(sets);
  if (!items.length) return null;
  const res = await saveRoutine(store, { id: routine.id, name: routine.name, notes: routine.notes, items: items.map(({ exerciseId, sets: count, reps }) => ({ exerciseId, sets: count, reps })) }, now);
  return res.ok ? res.data : null;
}

// ── measurements ───────────────────────────────────────────────────────────────────────────────────────────────

export async function saveMeasurement(store: Store, input: { day: string; kind: MeasurementKind; value: number }): Promise<GymResult<GymMeasurement>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return fail("invalid");
  if (!MEASUREMENTS.some((m) => m.kind === input.kind)) return fail("invalid");
  if (!Number.isFinite(input.value) || input.value <= 0 || input.value > 1000) return fail("invalid");
  const existing = (await store.gymMeasurements()).find((m) => m.day === input.day && m.kind === input.kind);
  const row: GymMeasurement = { id: existing?.id ?? newId(), day: input.day, kind: input.kind, value: Math.round(input.value * 100) / 100 };
  await store.putGymMeasurement(row);
  return { ok: true, data: row };
}

export async function deleteMeasurement(store: Store, id: string): Promise<void> {
  await store.deleteGymMeasurement(id);
}

// ── the Strong import ───────────────────────────────────────────────────────────────────────────────────────────

export type ImportOutcome = ImportSummary & {
  /** Sessions already in the log with the same start, left alone. */
  duplicates: number;
  /** Names that became the owner's own exercises. */
  custom: string[];
  routines: number;
  /** What the import wrote, for Undo. */
  sessionIds: string[];
  routineIds: string[];
};

export type ImportPreview = { result: ReturnType<typeof importStrongCsv>; duplicates: number; custom: string[] };

/** Reads the file and says what it holds, without writing anything: the import screen shows this before the tap. */
export async function previewStrong(c: ActionCtx, text: string): Promise<GymResult<ImportPreview>> {
  if (!text.trim()) return fail("emptyFile");
  if (!/exercise name/i.test(text.slice(0, 4000)) && !/set order/i.test(text.slice(0, 4000))) return fail("notStrong");
  const result = importStrongCsv(text, { timeZone: c.timeZone });
  if (!result.sessions.length) return fail("nothingToImport");
  const existing = new Set((await c.store.gymSessions()).map((s) => s.startTs));
  const known = await exerciseMap(c.store);
  const custom = result.summary.names.filter((n) => !resolveExerciseId(n.name) && ![...known.values()].some((e) => e.name.toLowerCase() === n.name.toLowerCase())).map((n) => n.name);
  return { ok: true, data: { result, duplicates: result.sessions.filter((s) => existing.has(s.startTs)).length, custom } };
}

/**
 * Writes a Strong export into the log. Sessions already present (same start instant) are skipped, so running the same
 * file twice adds nothing. Every name the catalogue does not know becomes an exercise of the owner's, never a dropped
 * row; the exercise names in the file are the ones the log then shows.
 *
 * After the sessions, one routine is made per workout name the file used (Push, Pull, Leg + arms...), from the most
 * recent session of that name: the templates page is then the owner's own week rather than an empty grid.
 */
export async function importStrong(
  c: ActionCtx,
  text: string,
  onProgress?: (p: { done: number; total: number }) => void,
): Promise<GymResult<ImportOutcome>> {
  const preview = await previewStrong(c, text);
  if (!preview.ok) return { ok: false, error: preview.error };
  const { result } = preview.data;
  const { sessions, summary } = result;
  const now = nowOf(c);
  const existing = new Set((await c.store.gymSessions()).map((s) => s.startTs));

  const map = await exerciseMap(c.store);
  const taken = new Set(map.keys());
  const customRows: GymExercise[] = [];
  const resolved = new Map<string, string>();
  for (const n of summary.names) {
    const known = resolveExerciseId(n.name);
    if (known && map.has(known)) {
      resolved.set(n.name, known);
      continue;
    }
    const lower = n.name.toLowerCase();
    const mine = [...map.values()].find((e) => e.name.toLowerCase() === lower);
    if (mine) {
      resolved.set(n.name, mine.id);
      continue;
    }
    const id = customId(n.name, taken);
    taken.add(id);
    const ex: GymExercise = {
      id,
      name: n.name.charAt(0).toUpperCase() + n.name.slice(1),
      bodyPart: n.name.toLowerCase().includes("run") || n.name.toLowerCase().includes("row") || n.name.toLowerCase().includes("bike") ? "cardio" : "full body",
      equipment: "other",
      custom: true,
      hold: false,
      unit: "kg",
      note: null,
    };
    map.set(id, ex);
    resolved.set(n.name, id);
    customRows.push(ex);
  }
  if (customRows.length) await c.store.putGymExercises(customRows);

  let written = 0;
  let writtenSets = 0;
  let duplicates = 0;
  const writtenIds: string[] = [];
  const byName = new Map<string, { session: GymSession; sets: GymSet[] }>();
  const total = sessions.length;
  onProgress?.({ done: 0, total });
  for (const [i, parsed] of sessions.entries()) {
    if (existing.has(parsed.startTs)) {
      duplicates++;
      onProgress?.({ done: i + 1, total });
      continue;
    }
    const session: GymSession = {
      id: newId(),
      day: parsed.day,
      startTs: parsed.startTs,
      endTs: parsed.endTs,
      name: parsed.name.slice(0, 60),
      notes: parsed.notes,
      routineId: null,
      finished: true,
      restStartedTs: null,
      restSec: null,
    };
    await c.store.putGymSession(session);
    const counters = new Map<string, number>();
    const positions = new Map<string, number>();
    const sets: GymSet[] = parsed.sets.map((s) => {
      const exerciseId = resolved.get(s.exercise)!;
      if (!positions.has(exerciseId)) positions.set(exerciseId, positions.size);
      const n = (counters.get(exerciseId) ?? 0) + 1;
      counters.set(exerciseId, n);
      return {
        id: newId(),
        sessionId: session.id,
        exerciseId,
        position: positions.get(exerciseId)!,
        setNo: n,
        weightKg: s.weightKg,
        reps: s.reps,
        seconds: s.seconds,
        distanceM: s.distanceM,
        rpe: s.rpe,
        type: (s.type ?? "normal") as SetType,
        supersetId: null,
        completed: true,
        ts: session.startTs,
        note: s.note,
      };
    });
    await c.store.putGymSets(sets);
    byName.set(session.name, { session, sets });
    writtenIds.push(session.id);
    written++;
    writtenSets += sets.length;
    onProgress?.({ done: i + 1, total });
    // Ten sessions at a time, so the bar moves while the writes run.
    if (i % 10 === 0) await slice();
  }
  onProgress?.({ done: total, total });
  if (!written) return fail("nothingToImport");

  // One template per workout name, from the last time it was done.
  const made = await buildRoutinesFrom(c.store, byName, now);
  await c.store.putGymImport({
    importedAt: now,
    sessions: written,
    sets: writtenSets,
    firstDay: summary.from,
    lastDay: summary.to,
    sessionIds: writtenIds,
    routineIds: made.ids,
  });
  return {
    ok: true,
    data: { ...summary, sessions: written, sets: writtenSets, duplicates, custom: customRows.map((e) => e.name), routines: made.ids.length, sessionIds: writtenIds, routineIds: made.ids },
  };
}

/**
 * A routine per workout name: the exercises of the most recent session with that name, each with the sets it had and
 * the most common reps. Sessions are pointed at their new routine so "last done" has something to read.
 */
async function buildRoutinesFrom(store: Store, byName: Map<string, { session: GymSession; sets: GymSet[] }>, now: number): Promise<{ count: number; ids: string[] }> {
  const { routines } = await store.gymRoutines();
  let made = 0;
  const ids: string[] = [];
  const names = [...byName.keys()];
  for (const [index, name] of names.entries()) {
    const { session, sets } = byName.get(name)!;
    // A template with this name already exists: the imported session belongs to it, so "last done" is not "Never done".
    const existing = routines.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      await store.putGymSession({ ...session, routineId: existing.id });
      continue;
    }
    const groups = groupByExercise(sets);
    const items: GymRoutineItem[] = groups
      .map((g, position) => {
        const counts = new Map<number, number>();
        for (const s of g.sets) counts.set(s.reps, (counts.get(s.reps) ?? 0) + 1);
        const reps = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
        return { routineId: "", exerciseId: g.exerciseId, position, sets: Math.min(20, g.sets.length), reps, restSec: null, note: null };
      })
      .filter((i) => i.exerciseId);
    if (!items.length) continue;
    const routine: GymRoutine = { id: newId(), name, notes: null, position: routines.length + made, updatedAt: now };
    await store.putGymRoutine(routine, items.map((i) => ({ ...i, routineId: routine.id })));
    await store.putGymSession({ ...session, routineId: routine.id });
    ids.push(routine.id);
    made++;
    if (index % 10 === 0) await slice();
  }
  return { count: made, ids };
}

/**
 * Takes the last import back out: every session it wrote and every template it made. A session that was edited or
 * given sets after the import goes too, because the import wrote the whole row; the confirmation says so.
 */
export async function undoStrongImport(store: Store, state: GymImportState): Promise<number> {
  const sessions = state.sessionIds ?? [];
  for (const id of sessions) await store.deleteGymSession(id);
  for (const id of state.routineIds ?? []) await store.deleteGymRoutine(id);
  if (sessions.length || (state.routineIds ?? []).length) await store.putGymImport(EMPTY_IMPORT);
  return sessions.length;
}

/** The estimated 1RM of a set, for the tick's record check (re-exported so screens do not import the maths twice). */
export { estimate1Rm };

/** The catalogue's own id for an exercise name, for tests and the AI-free import summary. */
export const catalogueId = (name: string) => (BY_ID.has(slug(name)) ? slug(name) : resolveExerciseId(name));
