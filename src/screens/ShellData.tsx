// What the shells need to know about "now", read from the database once for the whole app: today and the first day with
// data in the person's time zone, and the calendar panel's month loader, for every DateSwitcher. Mounted once in the root
// layout inside AppProviders (whose value is only the device's today until this has read the database). It reloads on
// `dataChanged()` like a screen does; it cannot use `useScreen` itself because that hook needs a screen to focus.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadCalendarMonth } from "@/actions/calendar";
import { store } from "@/data/store";
import { ctxOf, firstDay, todayOf } from "@/queries/common";
import { ShellCalendarProvider, useShellCalendar, type ShellCalendar } from "@/ui/shells/ShellStatus";
import { useDataVersion } from "./useScreen";

const loadMonth = (month: string) => loadCalendarMonth(store, month);

type Read = { today: string; firstDay: string | null; timeZone: string };

export function ShellData({ children }: { children: ReactNode }) {
  const root = useShellCalendar();
  const version = useDataVersion();
  // Without a profile (before onboarding) there is nothing to read: the device's today stands in.
  const [data, setData] = useState<Read>();
  useEffect(() => {
    let live = true;
    ctxOf(store)
      .then(async (ctx) => ({ today: todayOf(ctx), firstDay: await firstDay(ctx), timeZone: ctx.timeZone }))
      .then(
        (d) => live && setData(d),
        () => live && setData(undefined),
      );
    return () => {
      live = false;
    };
  }, [version]);
  const value = useMemo<ShellCalendar>(() => ({ today: data?.today ?? root.today, firstDay: data?.firstDay, timeZone: data?.timeZone, loadMonth }), [data, root.today]);
  return <ShellCalendarProvider value={value}>{children}</ShellCalendarProvider>;
}
