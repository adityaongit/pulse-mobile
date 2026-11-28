// Day Strain as it builds through a day, for the chart explorer's Strain day view. It is the day's stored Daily Strain
// (a percent, src/core/engine/strain.ts) run minute by minute, on the same inputs and math as stage 1's engineDay
// (src/pipeline/stage1.ts): the waking units (minute heart rate labelled awake, start to start capped at 30 minutes,
// zone 0 left out), each workout's units from its raw heart rate (uncapped), and the steps taken awake. Each segment
// counts from its start; the last point is exactly the day's Strain.
import { contextAt, minuteHr, type Span, type Timeline, within } from "@/core/engine/context";
import { dayStrain, PASSIVE_GAP_S, segmentsOf, units, zonesOf } from "@/core/engine/strain";
import type { HrSample } from "@/core/scoring/types";

/**
 * What the day's stored Strain was scored with: its value (null: no Strain), the max HR, the last reading scored and the
 * person's own zone lower bounds when the day was scored on them (EngineDayAggs.strain.zones).
 */
export type StrainInputs = { value: number | null; maxHr: number; lastHrTs: number | null; zones?: number[] };

/** A running Day Strain: x minutes from the day's start, y the Strain (a percent) of everything before that minute. */
export type StrainCurve = { xs: number[]; ys: number[] };

const EMPTY: StrainCurve = { xs: [], ys: [] };
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Day Strain at each whole minute of [start, end) (unix seconds), from the minute of the first reading. `hr`: the raw
 * samples over the day and its workouts; `steps`: the day's step minutes; `tl`: the sleep and workout timeline the
 * samples are labelled by; `workouts`: the day's own workouts (their heart rate counts in full). The curve runs to the
 * end of the day, or (`toLast`, today) to the minute after the last reading. Only the readings stage 1 scored count
 * (up to the row's last one).
 */
export function strainCurve(
  hr: readonly HrSample[],
  steps: readonly { ts: number; v: number }[],
  tl: Timeline,
  s1: StrainInputs | null,
  start: number,
  end: number,
  toLast = false,
  workouts: readonly Span[] = [],
): StrainCurve {
  if (!s1 || s1.value == null) return EMPTY;
  const scored = s1.lastHrTs == null ? hr : hr.filter((s) => s.ts <= s1.lastHrTs!);
  const zones = zonesOf(s1.maxHr, s1.zones);
  // Unit credits at their segment's start, and awake step minutes, both summed in stage 1's order for the last point.
  const credits: { ts: number; u: number }[] = [];
  const awake = within(minuteHr(scored), start, end).filter((m) => contextAt(tl, m.ts) === "awake");
  const passiveSegs = segmentsOf(awake, PASSIVE_GAP_S);
  passiveSegs.forEach((g, i) => credits.push({ ts: awake[i].ts, u: units([g], zones, true) }));
  const passive = units(passiveSegs, zones, true);
  let workoutUnits = 0;
  for (const w of workouts) {
    const xs = scored.filter((s) => s.ts >= w.startTs && s.ts < w.endTs);
    const segs = segmentsOf(xs);
    segs.forEach((g, i) => credits.push({ ts: xs[i].ts, u: units([g], zones) }));
    workoutUnits += units(segs, zones);
  }
  const stepMins = steps.filter((s) => s.ts >= start && s.ts < end && contextAt(tl, s.ts, false) === "awake");
  const awakeSteps = stepMins.reduce((n, s) => n + s.v, 0);
  credits.sort((a, b) => a.ts - b.ts);

  // From the first reading or awake step minute of the day.
  const day = within(scored, start, end);
  const firstTs = Math.min(day[0]?.ts ?? Infinity, stepMins[0]?.ts ?? Infinity);
  if (!Number.isFinite(firstTs)) return EMPTY;
  // Today ends at the last reading (the "now" the chart marks); later steps still count in the last point.
  const lastTs = day.at(-1)?.ts ?? stepMins.at(-1)!.ts;
  const dayMinutes = Math.round((end - start) / 60);
  const firstMinute = Math.max(0, Math.floor((firstTs - start) / 60));
  const lastMinute = toLast ? Math.min(dayMinutes, Math.floor((lastTs - start) / 60) + 1) : dayMinutes;
  const xs: number[] = [];
  const ys: number[] = [];
  let u = 0;
  let n = 0;
  let i = 0;
  let j = 0;
  for (let m = firstMinute; m <= lastMinute; m++) {
    const t = start + m * 60;
    while (i < credits.length && credits[i].ts < t) u += credits[i++].u;
    while (j < stepMins.length && stepMins[j].ts < t) n += stepMins[j++].v;
    xs.push(m);
    ys.push(round2(dayStrain(n, u)));
  }
  // Everything counts by the last point, summed as stage 1 sums it.
  ys[ys.length - 1] = round2(dayStrain(awakeSteps, passive + workoutUnits));
  return { xs, ys };
}
