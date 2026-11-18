// The entry (package.json `main`). The background task is defined here, outside React and before the router, so a
// headless launch (WorkManager waking Pulse with no UI) finds it: expo-task-manager needs defineTask in global scope.
// The widget task handler and configuration screen are registered for the same reason: Android may start them without
// the app's UI.
import "@/background/task";
import "@/background/places";
import "expo-router/entry";
import { registerWidgetConfigurationScreen, registerWidgetTaskHandler } from "react-native-android-widget";
import { HabitWidgetConfig } from "@/widgets/config";
import { widgetTaskHandler } from "@/widgets/task";

registerWidgetTaskHandler(widgetTaskHandler);
registerWidgetConfigurationScreen(HabitWidgetConfig);
