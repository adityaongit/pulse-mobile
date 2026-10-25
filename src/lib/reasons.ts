import { i18n } from "@/i18n/config";
import { Activity, HeartPulse, Hourglass, RefreshCw, Watch, type LucideIcon } from "lucide-react";

// The single source of reason copy (spec §5.14) and the metric shape every view model uses (§4.8).

export const REASON_CODES = [
  "calibrating",
  "no_hrv_last_night",
  "awaiting_sleep_sync",
  "insufficient_hr_data",
  "band_not_worn",
  "no_data",
  "missing_autonomic_signals",
  "baseline_warming_up",
  "calibration_required",
  "calibration_expired",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type MetricTag = "stale_baseline" | "updated";

/** One nullable metric in a view model. `undefined` (the whole metric) means still loading. */
export type Metric<T> = {
  value: T | null;
  reason: ReasonCode | null;
  provisional: boolean;
  tags?: MetricTag[];
  /** For `calibrating`. */
  nightsLeft?: number;
};

// `short` and `long` are getters so the copy resolves when it is read, in the language then in use.
type ReasonEntry = { icon: LucideIcon | null; readonly short: string; long: (nightsLeft?: number) => string };

export const REASONS: Record<ReasonCode, ReasonEntry> = {
  calibrating: {
    icon: Hourglass,
    get short() {
      return i18n.t("reasons:calibrating.short");
    },
    long: (n) => (n === undefined ? i18n.t("reasons:calibrating.long") : i18n.t("reasons:calibrating.longNights", { count: n })),
  },
  no_hrv_last_night: {
    icon: HeartPulse,
    get short() {
      return i18n.t("reasons:noHrvLastNight.short");
    },
    long: () => i18n.t("reasons:noHrvLastNight.long"),
  },
  awaiting_sleep_sync: {
    icon: RefreshCw,
    get short() {
      return i18n.t("reasons:awaitingSleepSync.short");
    },
    long: () => i18n.t("reasons:awaitingSleepSync.long"),
  },
  insufficient_hr_data: {
    icon: Activity,
    get short() {
      return i18n.t("reasons:insufficientHrData.short");
    },
    long: () => i18n.t("reasons:insufficientHrData.long"),
  },
  band_not_worn: {
    icon: Watch,
    get short() {
      return i18n.t("reasons:bandNotWorn.short");
    },
    long: () => i18n.t("reasons:bandNotWorn.long"),
  },
  no_data: {
    icon: null,
    get short() {
      return i18n.t("reasons:noData.short");
    },
    long: () => i18n.t("reasons:noData.long"),
  },
  missing_autonomic_signals: {
    icon: HeartPulse,
    get short() {
      return i18n.t("reasons:missingAutonomicSignals.short");
    },
    long: () => i18n.t("reasons:missingAutonomicSignals.long"),
  },
  baseline_warming_up: {
    icon: Hourglass,
    get short() {
      return i18n.t("reasons:baselineWarmingUp.short");
    },
    long: (n) =>
      n === undefined
        ? i18n.t("reasons:baselineWarmingUp.long")
        : i18n.t("reasons:baselineWarmingUp.longNights", { count: n }),
  },
  calibration_required: {
    icon: HeartPulse,
    get short() {
      return i18n.t("reasons:calibrationRequired.short");
    },
    long: () => i18n.t("reasons:calibrationRequired.long"),
  },
  calibration_expired: {
    icon: RefreshCw,
    get short() {
      return i18n.t("reasons:calibrationExpired.short");
    },
    long: () => i18n.t("reasons:calibrationExpired.long"),
  },
};

/** Any unknown or missing code falls back to `no_data`. */
export function normalizeReason(code: string | null | undefined): ReasonCode {
  return (REASON_CODES as readonly string[]).includes(code ?? "") ? (code as ReasonCode) : "no_data";
}

export function reasonCopy(code: string | null | undefined, nightsLeft?: number) {
  const key = normalizeReason(code);
  const r = REASONS[key];
  return { code: key, icon: r.icon, short: r.short, long: r.long(nightsLeft) };
}

/** Tags shown next to a number, with the explanation used in tooltips and info sheets. Getters: resolved at use. */
export const TAG_COPY = {
  provisional: {
    get label() {
      return i18n.t("reasons:tag.provisionalLabel");
    },
    get explain() {
      return i18n.t("reasons:tag.provisionalExplain");
    },
  },
  stale_baseline: {
    get label() {
      return i18n.t("reasons:tag.staleBaselineLabel");
    },
    get explain() {
      return i18n.t("reasons:tag.staleBaselineExplain");
    },
  },
  updated: {
    get label() {
      return i18n.t("reasons:tag.updatedLabel");
    },
    get explain() {
      return i18n.t("reasons:tag.updatedExplain");
    },
  },
};
