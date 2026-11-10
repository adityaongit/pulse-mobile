import { useSyncExternalStore } from "react";
import { Redirect, type Href } from "expo-router";
import { View } from "react-native";
import { workoutRecorder } from "@/live/workoutRecorder";

// The notification, Strain, More and onboarding link here: a running activity opens live, otherwise Start activity.
export default function WorkoutLink() {
  const state = useSyncExternalStore(workoutRecorder.subscribe, workoutRecorder.getSnapshot, workoutRecorder.getSnapshot);
  if (state.loading) return <View className="flex-1 bg-background" />;
  return <Redirect href={(state.active ? "/workout/live" : "/workout/start") as Href} />;
}
