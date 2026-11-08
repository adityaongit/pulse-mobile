// A small versioned projection of the existing Home query. No extra Health Connect reads or new scoring rules.
import { minuteMeanHr } from "@/core/algorithms/stress";
import { i18n } from "@/i18n/config";
import { getLocale } from "@/lib/locale";
import { reasonCopy, type Metric } from "@/lib/reasons";
import type { HomeVM } from "@/queries/types";

export const WIDGET_KEYS = ["recovery", "strain", "sleep", "steps", "calories", "hrv", "rhr", "stress", "heart_rate"] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];
export type WidgetMetric = {
  key: WidgetKey;
  label: string;
  value: number | null;
  display: string;
  unit: string;
  reason: string | null;
  provisional: boolean;
  href: string;
  color: string;
  progress: number | null;
  /** Latest stored sample, in Unix seconds; never the sync time. */
  observedAt?: number | null;
  trend?: (number | null)[];
};
export type WidgetSnapshot = {
  version: 1;
  day: string;
  timeZone: string;
  generatedAt: number;
  lastSyncTs: number | null;
  source: "health_connect" | "demo";
  metrics: WidgetMetric[];
  labels: Record<"demo" | "updated" | "stale" | "open" | "today" | "provisional" | "reading" | "oldReading" | "noReading" | "heartWindow", string>;
};

const SPEC: Record<WidgetKey, { unit: string; href: string; color: string; percent?: true; decimal?: true }> = {
  recovery: { unit: "%", href: "pulse://recovery", color: "#12c805", percent: true },
  strain: { unit: "%", href: "pulse://strain", color: "#0093e7", percent: true },
  sleep: { unit: "%", href: "pulse://sleep", color: "#7ba1bb", percent: true },
  steps: { unit: "", href: "pulse://metric/steps", color: "#00b377" },
  calories: { unit: "kcal", href: "pulse://metric/calories", color: "#d97900" },
  hrv: { unit: "ms", href: "pulse://metric/hrv", color: "#12c805", decimal: true },
  rhr: { unit: "bpm", href: "pulse://metric/rhr", color: "#3f92d3" },
  heart_rate: { unit: "bpm", href: "pulse://health/heart-rate", color: "#ff0026" },
  stress: { unit: "", href: "pulse://health/stress", color: "#d97900" },
};

export function widgetMetric(key: WidgetKey, metric: Metric<number>): WidgetMetric {
  const spec = SPEC[key];
  const value = metric.value !== null && Number.isFinite(metric.value) ? metric.value : null;
  return {
    key,
    label: i18n.t(`widgets:labels.${key}`),
    value,
    display: value === null ? "--" : new Intl.NumberFormat(getLocale(), { maximumFractionDigits: spec.decimal ? 1 : 0 }).format(value),
    unit: spec.unit,
    reason: value === null ? reasonCopy(metric.reason, metric.nightsLeft).short : null,
    provisional: metric.provisional,
    href: spec.href,
    color: key === "recovery" && value !== null ? (value < 34 ? "#ff0026" : value < 67 ? "#e5c300" : spec.color) : spec.color,
    // Pulse Strain is a percent and can exceed 100: retain the true label, cap only the track.
    progress: value !== null && spec.percent ? Math.max(0, Math.min(100, value)) : null,
  };
}

export function buildWidgetSnapshot(home: HomeVM, meta: Pick<WidgetSnapshot, "timeZone" | "generatedAt" | "lastSyncTs" | "source">, reading?: WidgetHeartReading): WidgetSnapshot {
  const source: Record<WidgetKey, Metric<number>> = {
    heart_rate: { value: null, reason: "no_data", provisional: false },
    recovery: home.dials.recovery,
    strain: home.dials.strain,
    sleep: home.dials.sleep,
    steps: home.cardStats.steps.metric,
    calories: home.cardStats.calories.metric,
    hrv: home.cardStats.hrv.metric,
    rhr: home.cardStats.rhr.metric,
    stress: { ...home.stress, value: home.stress.value?.value ?? null },
  };
  return {
    version: 1,
    day: home.day,
    ...meta,
    metrics: WIDGET_KEYS.map((key) => key === "heart_rate" ? heartRateMetric(reading, meta.generatedAt) : widgetMetric(key, source[key])),
    labels: {
      reading: i18n.t("widgets:state.reading"),
      oldReading: i18n.t("widgets:state.oldReading"),
      noReading: i18n.t("widgets:state.noReading"),
      heartWindow: i18n.t("widgets:state.heartWindow"),
      demo: i18n.t("widgets:state.demo"),
      updated: i18n.t("widgets:state.updated"),
      stale: i18n.t("widgets:state.stale"),
      open: i18n.t("widgets:state.open"),
      today: i18n.t("widgets:state.today"),
      provisional: i18n.t("widgets:state.provisional"),
    },
  };
}

export type WidgetHeartReading = {
  latest: { ts: number; bpm: number } | null;
  samples: { ts: number; bpm: number }[];
};

/** Same 30-minute window as Home, ending at the reading rather than pretending it ends now. */
export function heartRateMetric(reading: WidgetHeartReading | undefined, now: number): WidgetMetric {
  const latest = reading?.latest;
  const usable = !!latest && Number.isFinite(latest.bpm) && latest.bpm > 0 && Number.isFinite(latest.ts) && latest.ts > 0 && latest.ts <= now;
  const metric = widgetMetric("heart_rate", { value: usable ? latest.bpm : null, reason: usable ? null : "no_data", provisional: false });
  if (!usable) return { ...metric, observedAt: null, trend: [] };
  const end = Math.floor(latest.ts / 60) * 60 + 60;
  const samples = (reading?.samples ?? []).filter((s) => Number.isFinite(s.ts) && s.ts <= latest.ts && Number.isFinite(s.bpm) && s.bpm > 0);
  return { ...metric, observedAt: latest.ts, trend: minuteMeanHr(samples, end - 30 * 60, end).map((v) => v === null ? null : Math.round(v)) };
}
