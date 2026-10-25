import { generateId, type UIMessage } from "ai";

export function workoutChatSeed(workoutId: string | undefined, question: string, preview: string | undefined): UIMessage[] {
  if (!workoutId || !preview) return [];
  return [
    { id: generateId(), role: "user", parts: [{ type: "text", text: question }], metadata: { workoutId } },
    { id: generateId(), role: "assistant", parts: [{ type: "text", text: preview }] },
  ];
}

export function selectedWorkout(messages: UIMessage[]): string | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const id = (m.metadata as { workoutId?: unknown } | undefined)?.workoutId;
    if (typeof id === "string" && id.length > 0 && id.length <= 100) return id;
  }
  return null;
}
