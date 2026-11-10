// Shake to report (docs/telemetry.md § Shake to report): the accelerometer's readings, in g with gravity in, become a
// shake when three jolts past SHAKE_G land within WINDOW_MS. A phone at rest reads about 1 g and a brisk walk stays
// under 2 g; a deliberate shake passes 2.5 g several times a second. After a shake, COOLDOWN_MS of quiet.
export const SHAKE_G = 2.5;
export const JOLTS = 3;
export const WINDOW_MS = 1000;
export const COOLDOWN_MS = 3000;

/** A detector: feed it each reading (time in ms, x, y, z in g); it returns true on the reading that completes a shake. */
export function shakeDetector(): (t: number, x: number, y: number, z: number) => boolean {
  let jolts: number[] = [];
  let last = -Infinity;
  return (t, x, y, z) => {
    if (Math.hypot(x, y, z) < SHAKE_G || t - last < COOLDOWN_MS) return false;
    jolts = jolts.filter((j) => t - j < WINDOW_MS);
    jolts.push(t);
    if (jolts.length < JOLTS) return false;
    jolts = [];
    last = t;
    return true;
  };
}
