// Home's pieces of the activity flow (docs/workout-tracker/whoop-ui.md § Where it starts): the START ACTIVITY button
// beside ADD ACTIVITY, and the workouts recorded on the phone among the day's activities.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Timer } from "lucide-react-native";
import { localDay } from "@/lib/time";
import { appStore } from "@/state/app";
import { workoutRecorder } from "@/live/workoutRecorder";
import { activityView } from "@/live/activityView";
import type { RecordedWorkout, WorkoutType } from "@/live/workout";
import { ActivityCard, type ActivityKind } from "@/ui/metrics/ActivityCard";
import { activityName } from "../workout/activityKit";
import { strainSetupOf } from "../workout/LiveActivityScreen";
import { CardButtonLink } from "./parts";

const KIND: Record<WorkoutType, ActivityKind> = { walk: "walk", run: "run", cycle: "ride", strength: "strength", hiit: "workout", other: "workout" };

/** START ACTIVITY, or RESUME ACTIVITY while one is running. */
export function StartActivityButton() {
  const { t } = useTranslation("workouts");
  const state = useSyncExternalStore(workoutRecorder.subscribe, workoutRecorder.getSnapshot, workoutRecorder.getSnapshot);
  return <CardButtonLink href={state.active ? "/workout/live" : "/workout/start"} icon={Timer} label={t(state.active ? "home.resume" : "home.start")} className="min-w-0 flex-1 px-3" compact />;
}

export type RecordedRow = { session: RecordedWorkout; strain: number; start: number };

/**
 * The day's recorded workouts with their Strain, for Home to place among the imported activities by start time. One
 * Pulse saved to Health Connect is left out when the import lists it: by its id, or, when the import's dedup kept
 * another app's copy of the same session instead, by overlapping that activity. A phone-only one always stays, so it
 * can still be opened and deleted.
 */
export function useRecordedRows(day: string, timeZone: string, imported: readonly { id: string; start: number; end: number }[]): RecordedRow[] {
  const state = useSyncExternalStore(workoutRecorder.subscribe, workoutRecorder.getSnapshot, workoutRecorder.getSnapshot);
  const [rows, setRows] = useState<RecordedRow[]>([]);
  useEffect(() => {
    let live = true;
    const sessions = state.history.filter((s) => s.status === "completed" && localDay(s.startedAt / 1000, timeZone) === day && !(s.hcId && imported.some((a) => a.id === s.hcId || overlaps(s, a))));
    void Promise.all(sessions.map(async (session) => ({ session, start: session.startedAt, strain: activityView(await appStore().workouts.samples(session.id), strainSetupOf(session), null).activityStrain })))
      .then((r) => { if (live) setRows(r); }).catch(() => {});
    return () => { live = false; };
  }, [state.history, day, timeZone, imported]);
  return rows;
}

export function RecordedActivityCard({ row, timeZone }: { row: RecordedRow; timeZone: string }) {
  const { session, strain } = row;
  return (
    <ActivityCard
      name={activityName(session.type)}
      kind={KIND[session.type]}
      strain={{ value: strain, reason: null, provisional: false }}
      start={session.startedAt}
      end={session.endedAt ?? session.updatedAt}
      href={`/workout/${session.id}`}
      timeZone={timeZone}
    />
  );
}

/** More than half of the recorded session inside the imported one. */
function overlaps(s: RecordedWorkout, a: { start: number; end: number }) {
  const end = s.endedAt ?? s.updatedAt;
  const shared = Math.min(end, a.end) - Math.max(s.startedAt, a.start);
  return shared > (end - s.startedAt) / 2;
}
