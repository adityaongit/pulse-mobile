// The day-aware screens' loader: the web's `pageDay` (pulse (app)/_lib/day.ts) as a hook. The day is the route's `d`
// (the date switcher writes it); the query runs with the day resolved against the context's today, and the screen
// gets `today` and the time zone back so links and clock times use the owner's zone, not the device's.
import { useLocalSearchParams } from "expo-router";
import { parseDay } from "@/lib/url";
import { type QueryCtx, todayOf } from "@/queries/common";
import { useScreen } from "../useScreen";

export type DayView<T> = { d: string; today: string; timeZone: string; vm: T };

export function useDayScreen<T>(get: (day: string, ctx: QueryCtx) => Promise<T>) {
  const { d: raw } = useLocalSearchParams<{ d?: string }>();
  return useScreen(async (ctx): Promise<DayView<T>> => {
    const today = todayOf(ctx);
    const { d } = parseDay(raw, today);
    return { d, today, timeZone: ctx.timeZone, vm: await get(d, ctx) };
  }, [raw]);
}
