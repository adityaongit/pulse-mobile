// STUB for the Coach stream (K). The activity screen's coach pill needs two things from it: whether the coach is set up
// (pulse `coachReady(db, userId)`, src/server/coach/store.ts) and the coach's one-line take on a workout (pulse
// POST /api/coach/workout). Until that stream lands, the coach reads as not set up, so the screen shows the templated
// insight card, exactly as the web does with no coach key. Replace both bodies; nothing else here changes.
import type { QueryCtx } from "@/queries/common"

/** Is the coach set up (a provider key stored)? STUB: false until the Coach stream replaces it. */
export async function coachReady(_ctx: QueryCtx): Promise<boolean> {
  return false
}

/** The coach's one-line take on workout `id`. STUB: rejects, which hides the pill. Replace with the Coach stream's tool call. */
export async function coachWorkoutGlance(_id: string): Promise<string> {
  throw new Error("coach_not_ready")
}
