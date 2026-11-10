// Shake to report (docs/telemetry.md § Shake to report), after Square's Seismic: the accelerometer's readings, in g with
// gravity in, are "accelerating" past ACCEL_G (a phone at rest reads 1 g). A shake is when, over the last WINDOW_MS, at
// least MIN_SAMPLES readings arrived and three quarters of them were accelerating: a real shake keeps it up, a step's
// lone spike does not. After a shake, COOLDOWN_MS of quiet. Fed at 20 Hz (ShakeToReport.tsx).
export const ACCEL_G = 1.33;
export const WINDOW_MS = 500;
export const MIN_SAMPLES = 4;
export const COOLDOWN_MS = 3000;

/** A detector: feed it each reading (time in ms, x, y, z in g); it returns true on the reading that completes a shake. */
export function shakeDetector(): (t: number, x: number, y: number, z: number) => boolean {
  let samples: { t: number; on: boolean }[] = [];
  let last = -Infinity;
  return (t, x, y, z) => {
    samples = samples.filter((s) => t - s.t < WINDOW_MS);
    samples.push({ t, on: Math.hypot(x, y, z) > ACCEL_G });
    if (t - last < COOLDOWN_MS || samples.length < MIN_SAMPLES) return false;
    if (samples.filter((s) => s.on).length * 4 < samples.length * 3) return false;
    samples = [];
    last = t;
    return true;
  };
}
