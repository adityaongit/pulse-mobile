// The DateSwitcher calendar's month of scores (spec §4.3).
import { addDays } from "../time";
import { finite, loadDays, type QueryCtx, toStrain } from "./common";
import type { CalendarMonthVM } from "./types";

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Recovery, Strain (0–21) and Sleep performance for every day of `month` ("YYYY-MM"). */
export async function getCalendarMonth(ctx: QueryCtx, month: string): Promise<CalendarMonthVM> {
  if (!MONTH.test(month)) throw new Error(`Bad month: ${month}`);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = await loadDays(ctx, `${month}-01`, addDays(`${month}-01`, last - 1));
  const num = (v: number | null | undefined) => (finite(v) ? v : null);
  return {
    month,
    days: [...rows.values()].map((r) => ({
      day: r.day,
      recovery: num(r.recovery?.value),
      strain: finite(r.s1?.effort) ? toStrain(r.s1.effort) : null,
      sleep: num(r.sleep?.performance),
    })),
  };
}
