// Where each Health Monitor vital opens (pulse VitalTiles.tsx's DETAIL_KEY): the full detail even without a reading,
// keeping the selected day.
import { dayHref, metricHref } from "@/lib/url";
import type { VitalKey } from "@/queries/types";

const DETAIL_KEY: Record<VitalKey, string> = { resp: "resp", spo2: "spo2", restingHr: "rhr", hrv: "hrv", skinTempDev: "skin" };

export const vitalHref = (key: VitalKey, day: string, today: string) => dayHref(metricHref(DETAIL_KEY[key]), day, today);
