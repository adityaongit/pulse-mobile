// Home's gym card: the workout running now, and the template to start today. The suggestion follows the owner's split:
// templates named for a known split (push → pull → legs, upper → lower) rotate in that order, so after Push comes Pull
// even when Pull was last done weeks ago. Without a named split, the template left longest among the ones used this
// month is next, which is how a rotation of any names comes round. A template unused for a month is never suggested.
import type { QueryCtx } from "./ctx";
import type { GymRoutine, GymSession } from "@/data/gym";
import { localDay } from "@/lib/time";

const MONTH = 30 * 86_400;

export type HomeGymVM = {
  /** The workout running now: its clock's start and how many of its sets are ticked. */
  active: { sessionId: string; name: string; startTs: number; done: number; total: number } | null;
  /** The workout finished earlier today, if any: nothing is suggested again before tomorrow. */
  doneToday: { sessionId: string; name: string; endTs: number; seconds: number; sets: number } | null;
  /** `lastTs` is when the suggested template was last done, null when it never was. */
  suggested: { routineId: string; name: string; exercises: number; lastTs: number | null } | null;
};

/** The named splits, each a cycle of name patterns. A template belongs to the first step whose pattern its name matches. */
const SPLITS: RegExp[][] = [
  [/\bpush\b/i, /\bpull\b/i, /\blegs?\b/i],
  [/\bupper\b/i, /\blower\b/i],
];

/** The step of a split a template plays, or -1. */
function stepOf(split: RegExp[], name: string): number {
  return split.findIndex((re) => re.test(name));
}

/**
 * The template to do next. `done` is the finished sessions with a template that still exists, newest first.
 * Exported for the tests.
 */
export function nextRoutine(routines: GymRoutine[], done: GymSession[], now: number): GymRoutine | null {
  const recent = done.filter((s) => s.startTs >= now - MONTH);
  if (!recent.length) return null;
  const byId = new Map(routines.map((r) => [r.id, r]));
  const lastTs = (id: string) => done.find((s) => s.routineId === id)?.startTs ?? -Infinity;

  for (const split of SPLITS) {
    // The split's steps, each played by the template of that step done most recently (or, if none was, the first one
    // in the owner's order). A split counts once two of its steps have a template.
    const steps = split.map((_, i) => {
      const cands = routines.filter((r) => stepOf(split, r.name) === i);
      return cands.sort((a, b) => lastTs(b.id) - lastTs(a.id) || a.position - b.position)[0] ?? null;
    });
    if (steps.filter(Boolean).length < 2) continue;
    // The last split workout this month decides where the cycle stands; other workouts in between (a cardio day) do not.
    const last = recent.find((s) => stepOf(split, byId.get(s.routineId!)!.name) >= 0);
    if (!last) continue;
    const at = stepOf(split, byId.get(last.routineId!)!.name);
    for (let k = 1; k <= split.length; k++) {
      const step = steps[(at + k) % split.length];
      if (step) return step;
    }
  }

  // No named split: the least recently done of the templates used this month.
  const used = [...new Set(recent.map((s) => s.routineId!))].map((id) => byId.get(id)!);
  return used.sort((a, b) => lastTs(a.id) - lastTs(b.id) || a.position - b.position)[0] ?? null;
}

export async function getHomeGym(ctx: QueryCtx): Promise<HomeGymVM> {
  const [sessions, { routines, items }] = await Promise.all([ctx.store.gymSessions(), ctx.store.gymRoutines()]);
  const active = sessions.find((s) => !s.finished) ?? null;
  const doneToday = sessions.find((s) => s.finished && localDay(s.endTs ?? s.startTs, ctx.timeZone) === ctx.today) ?? null;
  // gymSessions is newest first. A session of a deleted template is left out.
  const known = new Set(routines.map((r) => r.id));
  const done = sessions.filter((s) => s.finished && !!s.routineId && known.has(s.routineId));
  const routine = active || doneToday ? null : nextRoutine(routines, done, ctx.now);
  const ids = [active, doneToday].filter((s) => !!s).map((s) => s.id);
  const sets = ids.length ? await ctx.store.gymSets(ids) : [];
  const of = (id: string) => sets.filter((s) => s.sessionId === id);
  return {
    active: active
      ? { sessionId: active.id, name: active.name, startTs: active.startTs, done: of(active.id).filter((s) => s.completed).length, total: of(active.id).length }
      : null,
    doneToday: doneToday
      ? {
          sessionId: doneToday.id,
          name: doneToday.name,
          endTs: doneToday.endTs ?? doneToday.startTs,
          seconds: Math.max(0, (doneToday.endTs ?? doneToday.startTs) - doneToday.startTs),
          sets: of(doneToday.id).filter((s) => s.completed && s.type !== "warmup").length,
        }
      : null,
    suggested: routine
      ? {
          routineId: routine.id,
          name: routine.name,
          exercises: new Set(items.filter((i) => i.routineId === routine.id).map((i) => i.exerciseId)).size,
          lastTs: done.find((s) => s.routineId === routine.id)?.startTs ?? null,
        }
      : null,
  };
}
