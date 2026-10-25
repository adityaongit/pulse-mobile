import { shownValue } from "@/lib/units";
import type { DayRow } from "./common";

const MONITOR_VITALS = {
  rhr: { key: "restingHr", unit: "bpm" },
  hrv: { key: "hrv", unit: "ms" },
  resp: { key: "resp", unit: "rpm" },
  skin: { key: "skinTempDev", unit: "°C" },
} as const;

export function monitorVital(key: string, row: DayRow | undefined) {
  if (!(key in MONITOR_VITALS)) return undefined;
  const spec = MONITOR_VITALS[key as keyof typeof MONITOR_VITALS];
  const monitor = row?.healthMonitor;
  const reading = monitor?.reason === null ? monitor.vitals.find((v) => v.key === spec.key) : undefined;
  const shown = (v: number) => shownValue(spec.unit, v, key === "skin");
  return {
    value: reading?.value == null ? null : shown(reading.value),
    baseline: reading?.range ? {
      mean: shown((reading.range.low + reading.range.high) / 2),
      sd: (shown(reading.range.high) - shown(reading.range.low)) / 2,
    } : null,
  };
}
