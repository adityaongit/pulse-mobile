/** Personal workout records. Epochs split reconnects/pauses so missing HR is never filled across a gap. */
import { trimp, zoneOf, zonesOf } from "@/core/engine/strain";
import type { Metric } from "@/lib/reasons";

export const WORKOUT_TYPES = ["walk", "run", "cycle", "strength", "hiit", "other"] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];
export type WorkoutSample = { seq: number; t: number; elapsedMs: number; bpm: number; epoch: number; rrMs: number[] };
export type RecordedWorkout = {
  schemaVersion: 1;
  id: string;
  type: WorkoutType;
  status: "recording" | "paused" | "interrupted" | "completed";
  startedAt: number;
  endedAt: number | null;
  updatedAt: number;
  activeMs: number;
  revision: number;
  seq: number;
  epoch: number;
  deviceId: string;
  deviceName: string | null;
  timeZone: string;
  restingHr: number | null;
  maxHr: number | null;
  sex: "male" | "female" | null;
  estimatedMaxHr: boolean;
  algorithmVersion: 1;
  link: "connecting" | "live" | "lost" | "off";
  lastBpm: number | null;
  lastSampleAt: number | null;
  error: string | null;
};
export type WorkoutSummary = {
  activeMs: number;
  observedMs: number;
  avgHr: number | null;
  maxHr: number | null;
  zoneSeconds: number[];
  load: Metric<number>;
  /** A null bpm is a break in the chart, never an interpolated reading. */
  trace: { t: number; bpm: number | null }[];
};
export const MAX_WORKOUT_GAP_MS = 10_000;
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Native journal input validation also protects against a corrupt persisted record. */
export function parseRecordedWorkout(input: string | unknown): RecordedWorkout {
  const x = (typeof input === "string" ? JSON.parse(input) : input) as RecordedWorkout;
  if (!x || x.schemaVersion !== 1 || !/^[a-zA-Z0-9-]{1,80}$/.test(x.id) || !WORKOUT_TYPES.includes(x.type) ||
    !["recording", "paused", "interrupted", "completed"].includes(x.status) ||
    !finite(x.startedAt) || !finite(x.activeMs) || x.activeMs < 0 || !finite(x.revision) ||
    !finite(x.seq) || !finite(x.updatedAt) || (x.endedAt !== null && !finite(x.endedAt))) throw new Error("invalidSession");
  return x;
}
export function parseWorkoutSample(x: WorkoutSample): WorkoutSample {
  if (!x || !Number.isSafeInteger(x.seq) || x.seq < 1 || !finite(x.t) || !finite(x.elapsedMs) || x.elapsedMs < 0 ||
    !finite(x.bpm) || x.bpm < 30 || x.bpm > 240 || !Number.isSafeInteger(x.epoch) || !Array.isArray(x.rrMs) || !x.rrMs.every(finite)) throw new Error("invalidSample");
  return x;
}

/** Same pure TRIMP kernel as imported workouts; stricter validation/gap policy for a live sensor. */
export function summarizeWorkout(session: RecordedWorkout, samples: readonly WorkoutSample[]): WorkoutSummary {
  const validMax = finite(session.maxHr) && session.maxHr > 30 && session.maxHr <= 240;
  const calibrated = validMax && finite(session.restingHr) && session.restingHr >= 30 && session.restingHr < session.maxHr! &&
    (session.sex === "male" || session.sex === "female");
  const zones = validMax ? zonesOf(session.maxHr!) : null;
  let observedMs = 0;
  let sum = 0;
  let maxHr: number | null = null;
  let load = 0;
  const zoneSeconds = [0, 0, 0, 0, 0, 0];
  const trace: WorkoutSummary["trace"] = [];
  let previous: WorkoutSample | null = null;
  for (const raw of samples) {
    const p = raw;
    const chartTime = session.startedAt + p.elapsedMs;
    if (!finite(p.bpm) || p.bpm < 30 || p.bpm > 240 || !finite(p.elapsedMs)) { previous = null; continue; }
    if (previous && (p.seq <= previous.seq || p.elapsedMs <= previous.elapsedMs)) continue;
    const gap = previous ? p.elapsedMs - previous.elapsedMs : 0;
    const sameRun = previous !== null && p.epoch === previous.epoch && gap <= MAX_WORKOUT_GAP_MS;
    // Reject implausible jumps, and break continuity rather than rewarding a discarded artifact.
    if (sameRun && gap <= 12_000 && Math.abs(p.bpm - previous!.bpm) > 45) { previous = null; trace.push({ t: chartTime, bpm: null }); continue; }
    if (!sameRun && trace.length) trace.push({ t: chartTime - 1, bpm: null });
    if (sameRun) {
      observedMs += gap;
      sum += previous!.bpm * gap;
      if (zones) zoneSeconds[zoneOf(previous!.bpm, zones)] += gap / 1000;
      if (calibrated) load += trimp([{ bpm: previous!.bpm, seconds: gap / 1000 }], session.restingHr, session.maxHr!, session.sex!) ?? 0;
    }
    maxHr = Math.max(maxHr ?? 0, p.bpm);
    trace.push({ t: chartTime, bpm: p.bpm });
    previous = p;
  }
  const activeMs = Math.max(session.activeMs, samples.at(-1)?.elapsedMs ?? 0);
  const value = calibrated && observedMs > 0 ? load : null;
  return {
    activeMs, observedMs, avgHr: observedMs ? Math.round(sum / observedMs) : null, maxHr,
    zoneSeconds,
    load: { value, reason: value === null ? "no_data" : null, provisional: session.status !== "completed" || session.estimatedMaxHr || observedMs < activeMs * 0.9 },
    trace: thinTrace(trace),
  };
}

/** Preserve extrema and every gap while bounding chart work for multi-hour recordings. */
function thinTrace(points: WorkoutSummary["trace"]): WorkoutSummary["trace"] {
  const size = Math.max(1, Math.ceil(points.length / 400));
  const result: WorkoutSummary["trace"] = [];
  for (let i = 0; i < points.length; i += size) {
    const group = points.slice(i, i + size);
    if (group.some((p) => p.bpm === null)) { result.push(...group); continue; }
    const min = group.reduce((a, b) => a.bpm! < b.bpm! ? a : b);
    const max = group.reduce((a, b) => a.bpm! > b.bpm! ? a : b);
    const selected = [...new Set([group[0], min, max, group.at(-1)!])].sort((a, b) => a.t - b.t);
    result.push(...selected);
  }
  return result;
}
