// The calendar panel's month fetch (pulse src/server/actions/calendar.ts, a read-only Server Function). The kit's
// ShellCalendar `loadMonth` takes a month and returns its days: this is that function over the Store.
import type { Store } from "../data/repos";
import { getCalendarMonth } from "../queries/calendar";
import { ctxOf } from "../queries/common";
import type { CalendarDayVM } from "../queries/types";

export async function loadCalendarMonth(store: Store, month: string): Promise<CalendarDayVM[]> {
  return (await getCalendarMonth(await ctxOf(store), month)).days;
}
