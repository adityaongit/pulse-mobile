import { generateId, type UIMessage } from "ai";
import { z } from "zod";

const Day = z.iso.date();

export function sleepChatSeed(day: string | undefined, question: string, preview: string | undefined): UIMessage[] {
  if (!day || !preview) return [];
  return [
    { id: generateId(), role: "user", parts: [{ type: "text", text: question }], metadata: { sleepDay: day } },
    { id: generateId(), role: "assistant", parts: [{ type: "text", text: preview }] },
  ];
}

export function selectedSleep(messages: UIMessage[]): string | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const day = (m.metadata as { sleepDay?: unknown } | undefined)?.sleepDay;
    if (typeof day === "string" && Day.safeParse(day).success) return day;
  }
  return null;
}
