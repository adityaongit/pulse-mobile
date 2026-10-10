import { useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { todayIn } from "@/lib/url";
import { ShellCalendarProvider } from "./shells/ShellStatus";
import { ToastHost } from "./Toast";

/**
 * What the kit's components need above them, once, at the root:
 * - GestureHandlerRootView: gestures (chart scrubbing) only work inside one.
 * - SafeAreaProvider: the headers and the check-in button read the notch and home-indicator insets (each screen shell nests its own, see ScreenScroll).
 * - ShellCalendarProvider: today, the first day with data and the time zone, for the date switcher and the charts. The
 *   value here is the device's today with no first day; the data layer replaces it once the database is read.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [calendar] = useState(() => ({ today: todayIn() }));
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ShellCalendarProvider value={calendar}>
          {children}
          <ToastHost />
        </ShellCalendarProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
