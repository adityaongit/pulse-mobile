// Temporary timing diagnostics (logcat tag ReactNativeJS, prefix "[PulsePerf]"): when a navigation is asked for, when
// the new screen mounts and counts as open, how long each view model takes, how long sync and scoring run, and every
// stretch the JS thread was blocked for more than 60 ms. Read with `adb logcat | grep PulsePerf`; switch off with ON.
import { AppState } from "react-native";
import { traced } from "./telemetry";

const ON = typeof __DEV__ !== "undefined" && __DEV__;
const T0 = Date.now();

export function perf(event: string, ...detail: unknown[]) {
  if (!ON) return;
  console.log("[PulsePerf]", Date.now() - T0, event, ...detail);
}

/**
 * Times an async step: `await timed("pipeline (app)", () => run())`. In a traced session it is also a Sentry span
 * (docs/telemetry.md): "sync-health-connect (app)" becomes `sync.health_connect` with `owner: app`.
 */
export async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const [, step, owner] = /^(.*?)(?: \((\w+)\))?$/.exec(label) ?? [label, label];
  try {
    return await traced(step.replace("-", ".").replace(/-/g, "_"), owner ? { owner } : {}, run);
  } finally {
    perf(label, `${Date.now() - t}ms`);
  }
}

let monitoring = false;
/**
 * Logs each time the JS thread could not run a 100 ms tick on time: the length of the stall. Time spent in the
 * background (when Android pauses the app's timers) isn't a stall: the clock restarts when the app comes back.
 */
export function startLagMonitor() {
  if (!ON || monitoring) return;
  monitoring = true;
  let last = Date.now();
  let active = AppState.currentState === "active";
  AppState.addEventListener("change", (next) => {
    perf("app-state", next);
    active = next === "active";
    last = Date.now();
  });
  setInterval(() => {
    const now = Date.now();
    const late = now - last - 100;
    if (active && late > 60) perf("js-blocked", `${late}ms`);
    last = now;
  }, 100);
}
