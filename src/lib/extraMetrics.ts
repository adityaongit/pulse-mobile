// Google Health daily roll-ups Pulse shows as they come, without scoring them (docs/research/google-health-coverage.md).
// One entry per metric: My Dashboard, Trends and the daily export all read this list, so adding a metric here
// (and its value path in src/server/sources/google/map.ts) is all it takes to show it.
import type { GoodDirection } from "./bands"
import type { FormatKey } from "./format"
import { type LabelKey, withLabel } from "./metricLabels"

export type ExtraMetric = {
  key: string
  label: string
  /** Shown after the value; minutes use h:mm via `format` instead. */
  unit?: string
  format: FormatKey
  direction: GoodDirection
  /** My Dashboard's editor group. Every extra opens its own detail screen, `/metric/<key>`. */
  group: "activity" | "nutrition" | "vitals"
  /** Accrues through the day: today is a gap in trends, not a low bar. */
  partialToday?: boolean
}

const DEFS = [
  { key: "distance", unit: "km", format: "decimal2", direction: "up", group: "activity", partialToday: true },
  { key: "floors", format: "grouped", direction: "up", group: "activity", partialToday: true },
  { key: "elevation", unit: "m", format: "int", direction: "up", group: "activity", partialToday: true },
  { key: "active_minutes", format: "duration", direction: "up", group: "activity", partialToday: true },
  { key: "light_minutes", format: "duration", direction: "up", group: "activity", partialToday: true },
  { key: "azm", format: "duration", direction: "up", group: "activity", partialToday: true },
  { key: "active_calories", unit: "kcal", format: "grouped", direction: "neutral", group: "activity", partialToday: true },
  { key: "sedentary_minutes", format: "duration", direction: "down", group: "activity", partialToday: true },
  { key: "avg_hr", unit: "bpm", format: "int", direction: "neutral", group: "activity" },
  { key: "water", unit: "ml", format: "grouped", direction: "up", group: "nutrition", partialToday: true },
  { key: "calories_in", unit: "kcal", format: "grouped", direction: "neutral", group: "nutrition", partialToday: true },
  { key: "protein", unit: "g", format: "int", direction: "neutral", group: "nutrition", partialToday: true },
  { key: "carbs", unit: "g", format: "int", direction: "neutral", group: "nutrition", partialToday: true },
  { key: "fat", unit: "g", format: "int", direction: "neutral", group: "nutrition", partialToday: true },
  { key: "glucose", unit: "mg/dL", format: "int", direction: "neutral", group: "vitals" },
  { key: "core_temp", unit: "°C", format: "decimal1", direction: "neutral", group: "vitals" },
  { key: "swim_strokes", format: "grouped", direction: "up", group: "activity", partialToday: true },
] as const satisfies readonly (Omit<ExtraMetric, "label" | "key"> & { key: LabelKey })[]

/** Entries carry a `label` getter (metrics namespace), resolved when read. */
export const EXTRA_METRICS = DEFS.map(withLabel)

export type ExtraKey = (typeof DEFS)[number]["key"]

export const EXTRA_KEYS = EXTRA_METRICS.map((m) => m.key) as ExtraKey[]

export const extraMetric = (key: ExtraKey): ExtraMetric => EXTRA_METRICS.find((m) => m.key === key)!
