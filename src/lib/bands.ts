// Band and tone logic for data colour (spec §2.3, §5.0). Colour is a data channel: every helper
// here returns a meaning first, and the token for it second.
import { i18n } from "@/i18n/config";
import { acwrBand, type AcwrBand } from "@/core/scoring/readiness";

/** Data tokens. `bg`/`text` are literal class names so Tailwind sees them; `css` is for Recharts props. */
export const DATA_COLORS = {
  "recovery-green": { bg: "bg-recovery-green", text: "text-recovery-green", css: "var(--recovery-green)" },
  "recovery-yellow": { bg: "bg-recovery-yellow", text: "text-recovery-yellow", css: "var(--recovery-yellow)" },
  // Red fills use --recovery-red; red text uses the lifted --recovery-red-text (contrast, spec §2.3 ◆).
  "recovery-red": { bg: "bg-recovery-red", text: "text-recovery-red-text", css: "var(--recovery-red)" },
  strain: { bg: "bg-strain", text: "text-strain-text", css: "var(--strain)" },
  sleep: { bg: "bg-sleep", text: "text-sleep", css: "var(--sleep)" },
  optimal: { bg: "bg-optimal", text: "text-optimal-text", css: "var(--optimal)" },
  warning: { bg: "bg-warning", text: "text-warning-text", css: "var(--warning)" },
  "stress-low": { bg: "bg-stress-low", text: "text-stress-low-text", css: "var(--stress-low)" },
  "stress-medium": { bg: "bg-stress-medium", text: "text-stress-medium-text", css: "var(--stress-medium)" },
  "stress-high": { bg: "bg-stress-high", text: "text-stress-high-text", css: "var(--stress-high)" },
  "stage-awake": { bg: "bg-stage-awake", text: "text-stage-awake", css: "var(--stage-awake)" },
  "stage-rem": { bg: "bg-stage-rem", text: "text-stage-rem", css: "var(--stage-rem)" },
  "stage-light": { bg: "bg-stage-light", text: "text-stage-light", css: "var(--stage-light)" },
  "stage-deep": { bg: "bg-stage-deep", text: "text-stage-deep", css: "var(--stage-deep)" },
  "energy-active": { bg: "bg-energy-active", text: "text-energy-active", css: "var(--energy-active)" },
  "energy-resting": { bg: "bg-energy-resting", text: "text-energy-resting", css: "var(--energy-resting)" },
  "chart-5": { bg: "bg-chart-5", text: "text-chart-5", css: "var(--chart-5)" },
  muted: { bg: "bg-muted-foreground", text: "text-muted-foreground", css: "var(--muted-foreground)" },
} as const;
export type DataColor = keyof typeof DATA_COLORS;

/** Each zone's fill, cool to hot as WHOOP colours them: grey-blue, blue, green, orange, red. */
export const ZONE_COLOR: Record<number, DataColor> = { 1: "sleep", 2: "strain", 3: "optimal", 4: "warning", 5: "recovery-red" };

/**
 * The colour of a Trend View part or breakdown band by its key (stack series, day bands, zones). Unknown keys, such
 * as strength activity types, take strain blue.
 */
export function partColor(key: string): string {
  const zone = /^z([1-5])$/.exec(key);
  if (zone) return DATA_COLORS[ZONE_COLOR[Number(zone[1])]].css;
  const strainBand = ["all_out", "strenuous", "moderate", "light"].indexOf(key);
  if (strainBand >= 0) return `var(--strain-band-${strainBand + 1})`;
  const named: Record<string, DataColor> = {
    optimal: "optimal",
    sufficient: "muted",
    poor: "warning",
    green: "recovery-green",
    yellow: "recovery-yellow",
    red: "recovery-red",
    rem: "stage-rem",
    asleep: "sleep",
    need: "optimal",
    deep: "stage-deep",
    low: "stress-low",
    medium: "stress-medium",
    high: "stress-high",
    // Calories and distance on Metric detail: the resting or everyday part under the active or workout part.
    resting: "energy-resting",
    everyday: "energy-resting",
    active: "energy-active",
    workouts: "energy-active",
  };
  return DATA_COLORS[named[key] ?? "strain"].css;
}

// --- Recovery (and Energy Bank, which bands exactly like Recovery) ---

export type RecoveryBand = "green" | "yellow" | "red";

/** ≥ 67 green, 34-66 yellow, below 34 red. 66.9 is yellow, 33.9 is red. */
export function recoveryBand(value: number): RecoveryBand {
  if (value >= 67) return "green";
  if (value >= 34) return "yellow";
  return "red";
}

// Getters: the word resolves when it is read (common namespace).
export const BAND_WORD: Record<RecoveryBand, string> = {
  get green() {
    return i18n.t("common:band.green");
  },
  get yellow() {
    return i18n.t("common:band.yellow");
  },
  get red() {
    return i18n.t("common:band.red");
  },
};
export const BAND_COLOR: Record<RecoveryBand, DataColor> = {
  green: "recovery-green",
  yellow: "recovery-yellow",
  red: "recovery-red",
};
export const recoveryColor = (value: number): DataColor => BAND_COLOR[recoveryBand(value)];

/** Dial fill: Recovery by band; Strain and Sleep have one hue each, whatever the value. */
export function dialColor(variant: "recovery" | "strain" | "sleep", value: number): DataColor {
  if (variant === "recovery") return recoveryColor(value);
  return variant;
}

// --- Stress 0-100 (the engine's levels: high from 60, medium from 30) ---

export type StressLevel = "low" | "medium" | "high";
export function stressLevel(value: number): StressLevel {
  if (value >= 60) return "high";
  if (value >= 30) return "medium";
  return "low";
}
export const STRESS_WORD: Record<StressLevel, string> = {
  get low() {
    return i18n.t("common:stressLevel.low");
  },
  get medium() {
    return i18n.t("common:stressLevel.medium");
  },
  get high() {
    return i18n.t("common:stressLevel.high");
  },
};
export const STRESS_COLOR: Record<StressLevel, DataColor> = {
  low: "stress-low",
  medium: "stress-medium",
  high: "stress-high",
};

// --- Direction-aware deltas (KeyStatRow, ContributorRow, TrendChart) ---

/** Which way is good. `neutral` still shows the arrow direction, never a good/bad tone. */
export type GoodDirection = "up" | "down" | "neutral" | "toward_zero";
export type Tone = "good" | "bad" | "neutral";
export type DeltaDir = "up" | "down" | "flat";

/** Good directions per metric (spec §5.0). U10 and U13 pick from here rather than restating them. */
export const GOOD_DIRECTION = {
  hrv: "up",
  resting_hr: "down",
  respiratory_rate: "down",
  sleep_performance: "up",
  hours: "up",
  consistency: "up",
  efficiency: "up",
  calories: "neutral",
  steps: "up",
  spo2: "up",
  skin_temp: "toward_zero",
  strain: "neutral",
  vo2max: "up",
  stress: "down",
  energy: "up",
} as const satisfies Record<string, GoodDirection>;

/**
 * Tone of `value` against `average`. Inside ±1 σ is neutral (dir "flat"); outside, the metric's good
 * direction decides. Without `sd` the band is zero: any difference gets a direction and a tone.
 */
export function deltaTone(
  direction: GoodDirection,
  value: number,
  average: number,
  sd = 0,
): { dir: DeltaDir; tone: Tone } {
  const diff = value - average;
  if (Math.abs(diff) <= Math.abs(sd)) return { dir: "flat", tone: "neutral" };
  const dir: DeltaDir = diff > 0 ? "up" : "down";
  if (direction === "neutral") return { dir, tone: "neutral" };
  if (direction === "toward_zero") return { dir, tone: Math.abs(value) < Math.abs(average) ? "good" : "bad" };
  return { dir, tone: (direction === "up") === (dir === "up") ? "good" : "bad" };
}

// --- Status chips (spec §5.0) ---

export type ChipTone = "optimal" | "warning" | "alert" | "neutral";
export const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  optimal: "bg-optimal/15 text-optimal-text",
  warning: "bg-warning/15 text-warning-text",
  alert: "bg-recovery-red/15 text-recovery-red-text",
  neutral: "bg-secondary text-foreground-secondary",
};

const ACWR_TONE: Record<AcwrBand, ChipTone> = { LOAD_RAMPING_DOWN: "neutral", LOAD_SWEET_SPOT: "optimal", LOAD_BUILDING_FAST: "warning", LOAD_SPIKING: "alert" };

/** Training load (ACWR) chip tone from the shared `acwrBand`: below 0.8 neutral, [0.8, 1.3) optimal, [1.3, 1.5) warning, then alert. */
export const acwrTone = (acwr: number): ChipTone => ACWR_TONE[acwrBand(acwr)];
