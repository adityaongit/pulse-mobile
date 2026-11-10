// Shake to report (docs/telemetry.md § Shake to report): while the app is in front, telemetry is on and the switch in
// Settings › App › Privacy is on, the accelerometer listens at 20 Hz and a shake opens the report page. Off otherwise,
// so no sensor runs in the background. Never during onboarding, on the report page itself, or while a workout records
// (running shakes the phone).
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { router, usePathname, type Href } from "expo-router";
import { Accelerometer } from "expo-sensors";
import { onShakeEnabled } from "@/lib/telemetry";
import { shakeDetector } from "@/lib/shake";
import { workoutRecorder } from "@/live/workoutRecorder";
import { haptic } from "@/ui/haptics";

export function ShakeToReport() {
  const pathname = usePathname();
  const where = useRef(pathname);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    where.current = pathname;
  }, [pathname]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  useEffect(() => onShakeEnabled(setEnabled), []);
  useEffect(() => {
    if (!active || !enabled) return;
    const shake = shakeDetector();
    Accelerometer.setUpdateInterval(50);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      if (!shake(Date.now(), x, y, z)) return;
      const from = where.current;
      if (from.startsWith("/onboarding") || from === "/report" || workoutRecorder.getSnapshot().active) return;
      // Straight to the router: navigate's push drops a second push within 500 ms, and a shake is not a double tap
      // (the detector's cooldown already keeps it to one).
      haptic.warning();
      router.push(`/report?from=${encodeURIComponent(from)}` as Href);
    });
    return () => sub.remove();
  }, [active, enabled]);
  return null;
}
