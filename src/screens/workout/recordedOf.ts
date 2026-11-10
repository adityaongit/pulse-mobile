// The workout Pulse recorded behind an activity it saved to Health Connect and imported back: found by the Health
// Connect id the recording keeps. The activity page's menu uses it for Delete.
import { useEffect, useState, useSyncExternalStore } from "react";
import { appStore } from "@/state/app";
import { workoutRecorder } from "@/live/workoutRecorder";
import type { RecordedWorkout } from "@/live/workout";

export function useRecordedOf(activityId: string): { session: RecordedWorkout | null; busy: boolean } {
  const recorder = useSyncExternalStore(workoutRecorder.subscribe, workoutRecorder.getSnapshot, workoutRecorder.getSnapshot);
  const [session, setSession] = useState<RecordedWorkout | null>(null);
  useEffect(() => {
    let live = true;
    void appStore().workouts.list(1000).then((all) => { if (live) setSession(all.find((w) => w.hcId === activityId) ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [activityId, recorder.history]);
  return { session, busy: recorder.busy };
}
