import { Activity, Bike, Dumbbell, Footprints, HeartPulse, Hourglass, PersonStanding, RefreshCw, Timer, Watch, createLucideIcon, type LucideIcon } from "lucide-react-native";
import type { ReasonCode } from "@/lib/reasons";

// src/lib/reasons.ts and src/lib/bands.ts are copies of the web files and their icons come from lucide-react (the
// web package). The kit draws the same glyphs from lucide-react-native through these maps, keyed by the same codes.

export const REASON_ICON: Record<ReasonCode, LucideIcon | null> = {
  calibrating: Hourglass,
  no_hrv_last_night: HeartPulse,
  awaiting_sleep_sync: RefreshCw,
  insufficient_hr_data: Activity,
  band_not_worn: Watch,
  no_data: null,
  missing_autonomic_signals: HeartPulse,
  baseline_warming_up: Hourglass,
  calibration_required: Hourglass,
  calibration_expired: RefreshCw,
};

export type ActivityKind = "run" | "ride" | "walk" | "strength" | "workout";
export const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  run: PersonStanding,
  ride: Bike,
  walk: Footprints,
  strength: Dumbbell,
  workout: Timer,
};

/** The reference app's Home glyph: a house outline framing a rising line chart. Lucide's house, door swapped for a chart. */
export const HomeChart = createLucideIcon("home-chart", [
  ["path", { d: "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", key: "frame" }],
  ["path", { d: "m7 16 3-3 2.5 2.5L17 11", key: "chart" }],
]);
