// The habits' view models: the cards for today, one habit's history and score, and the editor. The score, streak and
// period maths live in src/core/habits/logic.ts so the home-screen widgets can use them without React.
import { dayState, habitStats, lastDays, scoreSeries, type DayState, type HabitStats } from "@/core/habits/logic";
import type { Habit, HabitEntry } from "@/core/habits/types";
import type { Exercise } from "@/data/types";
import { addDays } from "@/lib/time";
import type { QueryCtx } from "./ctx";

export type HabitDay = { day: string; state: DayState };

export type HabitCardVM = {
  habit: Habit;
  stats: HabitStats;
  /** The last `count` days, newest first (today first), for the list's grid. */
  days: HabitDay[];
};

export type HabitsVM = {
  today: string;
  /** The list's days, newest first (today first). */
  days: string[];
  habits: HabitCardVM[];
  archived: HabitCardVM[];
  /** The month's workouts by day (days with none are absent). */
  activity: Record<string, ActivityDayVM>;
  /** Days with a workout this week, Monday to today. */
  activityWeek: number;
};

/** The kinds the Activity row tells apart. Health Connect's types fold into these, so strength training and weightlifting
 *  are one kind, not two rows. */
export type ActivityKind = "walk" | "run" | "ride" | "strength" | "elliptical" | "racket" | "swim" | "yoga" | "other";

export function activityKind(type: string): ActivityKind {
  if (/BADMINTON|TENNIS|SQUASH|PADEL|TABLE_TENNIS/.test(type)) return "racket";
  if (/SWIM/.test(type)) return "swim";
  if (/ELLIPTICAL/.test(type)) return "elliptical";
  if (/BIK|CYCL|RIDE/.test(type)) return "ride";
  if (/WALK|HIK/.test(type)) return "walk";
  if (/RUN/.test(type)) return "run";
  if (/STRENGTH|WEIGHT|CALISTHEN|HIIT/.test(type)) return "strength";
  if (/YOGA|PILATES|STRETCH/.test(type)) return "yoga";
  return "other";
}

/** One workout on the Activity row's day sheet. */
export type ActivityItemVM = { id: string; kind: ActivityKind; type: string; name: string | null; startTs: number; endTs: number };

/** One day of the Activity row: the kinds done (each once, the day's first first) and every session, oldest first. */
export type ActivityDayVM = { kinds: ActivityKind[]; items: ActivityItemVM[] };

/** The list's grid holds a month of days; older ones scroll out of view. */
const LIST_DAYS = 30;

/** The month's workouts by day, for the one Activity row. */
function activityDays(exercises: readonly Exercise[], from: string): Record<string, ActivityDayVM> {
  const out: Record<string, ActivityDayVM> = {};
  const sorted = exercises.filter((e) => e.day >= from).sort((a, b) => a.startTs - b.startTs);
  for (const e of sorted) {
    const day = (out[e.day] ??= { kinds: [], items: [] });
    const kind = activityKind(e.type);
    if (!day.kinds.includes(kind)) day.kinds.push(kind);
    day.items.push({ id: e.id, kind, type: e.type, name: e.name, startTs: e.startTs, endTs: e.endTs });
  }
  return out;
}

/** The Monday on or before a civil day. */
function monday(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** The cards for a set of habits and their entries: the tab's grid, and the widget that lists today. */
export function habitCards(habits: readonly Habit[], entries: readonly HabitEntry[], today: string, count = 7): HabitCardVM[] {
  const days = lastDays(today, count).reverse();
  return habits.map((habit) => {
    const stats = habitStats(habit, entries, today);
    const mine = entries.filter((e) => e.habitId === habit.id);
    const byDay = new Map(mine.map((e) => [e.day, e]));
    return {
      habit,
      stats,
      days: days.map((day) => ({ day, state: dayState(habit, byDay, day) })),
    };
  });
}

export async function getHabits(ctx: QueryCtx): Promise<HabitsVM> {
  const [habits, entries, exercises] = await Promise.all([ctx.store.habits(), ctx.store.habitEntries(), ctx.store.allExercises()]);
  const active = habits.filter((h) => !h.archived);
  const archived = habits.filter((h) => h.archived);
  const activity = activityDays(exercises, addDays(ctx.today, -(LIST_DAYS - 1)));
  return {
    today: ctx.today,
    days: lastDays(ctx.today, LIST_DAYS).reverse(),
    habits: habitCards(active, entries, ctx.today, LIST_DAYS),
    archived: habitCards(archived, entries, ctx.today),
    activity,
    activityWeek: Object.keys(activity).filter((d) => d >= monday(ctx.today)).length,
  };
}

export type HabitDetailVM = {
  habit: Habit;
  stats: HabitStats;
  /** The last 180 days, oldest first, for the history calendar. */
  days: HabitDay[];
  /** The last 90 scores, oldest first, for the chart. */
  scores: { day: string; value: number }[];
};

export async function getHabit(ctx: QueryCtx, id: string): Promise<HabitDetailVM | null> {
  const [habits, entries] = await Promise.all([ctx.store.habits(), ctx.store.habitEntries()]);
  const habit = habits.find((h) => h.id === id);
  if (!habit) return null;
  const mine = entries.filter((e) => e.habitId === id);
  const stats = habitStats(habit, mine, ctx.today);
  const byDay = new Map(mine.map((e) => [e.day, e]));
  const from = addDays(ctx.today, -179);
  const days: HabitDay[] = [];
  for (let day = from; day <= ctx.today; day = addDays(day, 1)) {
    days.push({ day, state: dayState(habit, byDay, day) });
  }
  const series = scoreSeries(habit, new Map(mine.map((e) => [e.day, e])), addDays(ctx.today, -89), ctx.today);
  return {
    habit,
    stats,
    days,
    scores: [...series.entries()].map(([day, value]) => ({ day, value })),
  };
}

export type HabitEditorVM = { habit: Habit | null };

export async function getHabitEditor(ctx: QueryCtx, id?: string): Promise<HabitEditorVM> {
  if (!id) return { habit: null };
  return { habit: (await ctx.store.habits()).find((h) => h.id === id) ?? null };
}
