import type { UIMessage } from "ai";


export function selectedWorkout(messages: UIMessage[]): string | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const id = (m.metadata as { workoutId?: unknown } | undefined)?.workoutId;
    if (typeof id === "string" && id.length > 0 && id.length <= 100) return id;
  }
  return null;
}
