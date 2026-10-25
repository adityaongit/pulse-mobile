import { generateId, type UIMessage } from "ai";
import { z } from "zod";
import type { CoachActivity } from "./activity";
import { selectedWorkout } from "./workoutChat";
import { selectedSleep } from "./sleepChat";

const Activity = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workout"), id: z.string().min(1).max(100) }),
  z.object({ kind: z.literal("sleep"), id: z.iso.date() }),
  z.object({ kind: z.literal("nap"), id: z.string().min(1).max(100) }),
]);

export function activityChatSeed(activity: CoachActivity | undefined, question: string, preview: string | undefined): UIMessage[] {
  if (!activity || !preview) return [];
  return [
    { id: generateId(), role: "user", parts: [{ type: "text", text: question }], metadata: { activity } },
    { id: generateId(), role: "assistant", parts: [{ type: "text", text: preview }] },
  ];
}

export function selectedActivity(messages: UIMessage[]): CoachActivity | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const result = Activity.safeParse((message.metadata as { activity?: unknown } | undefined)?.activity);
    if (result.success) return result.data;
  }
  const workout = selectedWorkout(messages);
  if (workout) return { kind: "workout", id: workout };
  const sleep = selectedSleep(messages);
  return sleep ? { kind: "sleep", id: sleep } : null;
}
