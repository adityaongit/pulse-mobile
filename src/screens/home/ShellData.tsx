// What the shells need to know about "now", read from the database: today and the first day with data in the person's
// time zone, and the calendar panel's month loader. The root's provider only knows the device's today (src/ui/providers.tsx:
// "the data layer replaces it once the database is read"); a screen that draws a DateSwitcher wraps itself in this.
import { useMemo, type ReactNode } from "react";
import { loadCalendarMonth } from "@/actions/calendar";
import { store } from "@/data/store";
import { firstDay, todayOf } from "@/queries/common";
import { ShellCalendarProvider, useShellCalendar, type ShellCalendar } from "@/ui/shells/ShellStatus";
import { useScreen } from "../useScreen";

const loadMonth = (month: string) => loadCalendarMonth(store, month);

export function ShellData({ children }: { children: ReactNode }) {
  const root = useShellCalendar();
  const { data } = useScreen(async (ctx) => ({ today: todayOf(ctx), firstDay: await firstDay(ctx), timeZone: ctx.timeZone }), []);
  const value = useMemo<ShellCalendar>(() => ({ today: data?.today ?? root.today, firstDay: data?.firstDay, timeZone: data?.timeZone, loadMonth }), [data, root.today]);
  return <ShellCalendarProvider value={value}>{children}</ShellCalendarProvider>;
}
