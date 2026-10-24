// Data check, device part: reads the last `days` days of every checked type from Health Connect (all apps) and compares them with Pulse's stored rows. See dataCheckSummary.ts.
import type { Store } from "@/data/store";
import { addDays, localDay, localMidnight } from "@/lib/time";
import { permissionState, readAll, type ReadType } from "./connect";
import { CHECK_METRICS, formatReport, summarize, type DayCheck, type RawRecord } from "./dataCheckSummary";

export async function runDataCheck(store: Store, opts: { timeZone: string; days?: number; now?: Date }): Promise<{ days: DayCheck[]; text: string }> {
  const tz = opts.timeZone;
  const now = opts.now ?? new Date();
  const today = localDay(Math.floor(now.getTime() / 1000), tz);
  const n = opts.days ?? 10;
  const days = Array.from({ length: n }, (_, i) => addDays(today, -i));
  const range = { start: new Date(localMidnight(days[n - 1], tz) * 1000), end: now };
  const perms = await permissionState();
  const granted = new Set<string>(perms.granted);
  const raw: Partial<Record<ReadType, RawRecord[]>> = {};
  for (const cm of CHECK_METRICS) {
    if (!granted.has(cm.type) || raw[cm.type]) continue;
    raw[cm.type] = (await readAll(cm.type, range).catch(() => [])) as unknown as RawRecord[];
  }
  const sleepRaw = granted.has("SleepSession") ? ((await readAll("SleepSession", { start: new Date(range.start.getTime() - 86_400_000), end: now }).catch(() => [])) as unknown as RawRecord[]) : [];
  const [metrics, sessions, values] = await Promise.all([store.allMetrics(), store.allSessions(), store.dailyValues({ from: days[n - 1], to: today })]);
  const checked = summarize(raw, sleepRaw, metrics, sessions, days, tz, values);
  return { days: checked, text: formatReport(checked) };
}
