// What a recorded workout starts from, read once at Start and kept on the session (the native journal keeps every
// field of the start config): the TRIMP calibration, today's Strain base and target for the live dial, and the body
// figures for calories. Reading it once means a sync during the workout can't count the same minutes twice.
import { addDays, wholeYears } from "@/lib/time";
import { loadDays, maxHrOf, type QueryCtx } from "@/queries/common";
import type { ActivityBody, ActivityStrainSetup } from "./activityView";
import type { WorkoutCalibration } from "./workoutRecorder";
import { workoutSetup } from "./workoutSetup";

export type WorkoutStart = WorkoutCalibration & {
  strainSetup: ActivityStrainSetup;
  /** Today's Strain Target (percent), when there is one. */
  target: [number, number] | null;
  body: ActivityBody | null;
};

export async function loadWorkoutStart(ctx: QueryCtx): Promise<WorkoutStart> {
  const setup = workoutSetup(await loadDays(ctx, addDays(ctx.today, -7), ctx.today), ctx.today, maxHrOf(ctx), ctx.profile.sex);
  const metrics = (await ctx.store.allMetrics()).filter((m) => m.day <= ctx.today).sort((a, b) => b.day.localeCompare(a.day));
  // TRIMP needs a recorded resting HR from the last week, never workoutSetup's default.
  const rhr = metrics.find((m) => m.rhrBpm !== null);
  const recentRhr = rhr && Date.parse(ctx.today) - Date.parse(rhr.day) <= 7 * 86_400_000 ? rhr.rhrBpm : null;
  const weightKg = metrics.find((m) => m.weightKg !== null)?.weightKg ?? null;
  const age = wholeYears(ctx.profile.birthDate, ctx.today);
  return {
    restingHr: recentRhr,
    maxHr: maxHrOf(ctx),
    sex: ctx.profile.sex,
    estimatedMaxHr: ctx.profile.maxHr == null,
    timeZone: ctx.timeZone,
    strainSetup: { restingHr: setup.restingHr, maxHr: setup.maxHr, base: setup.base, sex: setup.sex },
    target: setup.target,
    body: weightKg !== null && age > 0 ? { age, weightKg, sex: ctx.profile.sex } : null,
  };
}
