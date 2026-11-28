import { workoutRecorder } from "@/live/workoutRecorder";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { todayIn } from "@/lib/url";
import { LiveBleProvider } from "@/state/liveBle";
import { LiveHrTicker } from "@/state/liveHr";
import { ShellCalendarProvider } from "./shells/ShellStatus";
import { usePureBlack } from "./theme";
import { ToastHost } from "./Toast";

/**
 * What the kit's components need above them, once, at the root:
 * - GestureHandlerRootView: gestures (chart scrubbing) only work inside one.
 * - SafeAreaProvider: the headers and the check-in button read the notch and home-indicator insets (each screen shell nests its own, see ScreenScroll).
 * - ShellCalendarProvider: today, the first day with data and the time zone, for the date switcher and the charts. The
 *   value here is the device's today with no first day; the data layer replaces it once the database is read.
 * - LiveBleProvider: live heart rate over Bluetooth (src/state/liveBle.tsx), display-only.
 * - LiveHrTicker: the minute-by-minute Health Connect heart-rate read (src/state/liveHr.tsx); renders nothing.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => workoutRecorder.mount(), []);
  const [calendar] = useState(() => ({ today: todayIn() }));
  // Pure black: global.css's `.pure-black` turns the ground tokens to #000 for every view below. `.ground-root` sets a
  // variable from the first render, so NativeWind wraps this view in its variable provider once; adding a variable class
  // later would swap the root view's type and remount the app, losing the navigation context.
  const black = usePureBlack();
  return (
    <GestureHandlerRootView style={styles.root}>
      <View className={black ? "ground-root pure-black flex-1" : "ground-root flex-1"}>
        <SafeAreaProvider>
          <ShellCalendarProvider value={calendar}>
            <LiveBleProvider>{children}</LiveBleProvider>
            <ToastHost />
            <LiveHrTicker />
          </ShellCalendarProvider>
        </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
