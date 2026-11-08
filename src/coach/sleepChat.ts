import type { UIMessage } from "ai";
import { z } from "zod";

const Day = z.iso.date();


export function selectedSleep(messages: UIMessage[]): string | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const day = (m.metadata as { sleepDay?: unknown } | undefined)?.sleepDay;
    if (typeof day === "string" && Day.safeParse(day).success) return day;
  }
  return null;
}
