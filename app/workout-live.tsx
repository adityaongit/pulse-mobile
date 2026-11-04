import { Redirect } from "expo-router";
import { useApp } from "@/state/app";
import { WorkoutRecorderScreen } from "@/screens/workout/WorkoutRecorderScreen";

// Keep existing notification/onboarding links working; an onboarded owner lands in the tab.
export default function WorkoutLink() {
  const onboarded = useApp((s) => s.onboarded);
  return onboarded ? <Redirect href="/(tabs)/workout" /> : <WorkoutRecorderScreen />;
}
