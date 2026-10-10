// The check-in's pure logic, from pulse's (app)/journal/CheckIn.tsx: which answers Save writes, and the heading.
// Tested in Node (checkin.test.ts).
import { formatDay } from "@/lib/format";

export type Values = Record<string, number | undefined>;
export type Answer = { tag: string; value: boolean | null; detail: number | null };

/**
 * The answers Save writes: each tag whose answer or follow-up differs from the saved one, as yes/no, or null where
 * a saved answer was cleared (the action deletes it, so it reads as "not answered", not "no").
 */
export function changedEntries(values: Values, details: Values, saved: Record<string, number>, savedDetails: Record<string, number>): Answer[] {
  const tags = new Set([...Object.keys(values), ...Object.keys(details)]);
  return [...tags]
    .filter((t) => values[t] !== saved[t] || (values[t] && details[t] !== savedDetails[t]))
    .map((t) => ({ tag: t, value: values[t] === undefined ? null : values[t]! > 0, detail: values[t] ? (details[t] ?? null) : null }));
}

export const heading = (day: string, today: string) =>
  day === today ? `What’s happening today, ${formatDay(day, { month: "long", day: "numeric" })}?` : `What happened on ${formatDay(day, { weekday: "long", month: "long", day: "numeric" })}?`;
