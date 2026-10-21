// Home's My Dashboard catalogue: every metric the Home view model can show, grouped as the editor lists them
// (spec §7.1 row 8, §11 CD1, CD2). Stored keys are these keys; never rename one.
import type { GoodDirection } from "./bands"
import { EXTRA_METRICS, type ExtraKey } from "./extraMetrics"
import type { FormatKey } from "./format"
import { type LabelKey, groupLabel, labelRecord, withLabel } from "./metricLabels"
import { metricHref } from "./url"

const GROUP_DEFS = [
  { key: "recovery" },
  { key: "activity" },
  { key: "body" },
  { key: "nutrition" },
  { key: "vitals" },
] as const
export type DashboardGroup = (typeof GROUP_DEFS)[number]["key"]
/** Group headings in editor order; `label` is a getter (metrics namespace). */
export const DASHBOARD_GROUPS = GROUP_DEFS.map((g) => Object.defineProperty({ ...g }, "label", { get: () => groupLabel(g.key), enumerable: true }) as typeof g & { readonly label: string })

/** The eight v1 rows; their units and reasons live in the Home query (`keyStats`). */
const CORE = [
  { key: "hrv", group: "recovery" },
  { key: "rhr", group: "recovery" },
  { key: "resp", group: "vitals" },
  { key: "sleep", group: "recovery" },
  { key: "calories", group: "activity" },
  { key: "steps", group: "activity" },
  { key: "spo2", group: "vitals" },
  { key: "skin", group: "vitals" },
] as const

/**
 * The reference app's other rows (dashboard-03..09). Keys match the Trend View each opens where there is one;
 * "(weekly)" rows total the 7 days ending on the day and compare with the same 7-day total over the prior 30 days.
 */
const SCORED = [
  { key: "recovery", group: "recovery" },
  { key: "consistency", group: "recovery" },
  { key: "hours", group: "recovery" },
  { key: "restorative_pct", group: "recovery" },
  { key: "restorative", group: "recovery" },
  { key: "debt", group: "recovery" },
  { key: "strain", group: "activity" },
  { key: "zones13", group: "activity" },
  { key: "zones45", group: "activity" },
  { key: "zones_all", group: "activity" },
  { key: "strength", group: "activity" },
  { key: "vo2max", group: "body" },
  { key: "lean_mass", group: "body" },
] as const
export type ScoredKey = (typeof SCORED)[number]["key"]

/** Stress Monitor: a chart tile rather than a row (the day's stress line), placed and reordered like any metric. */
const STRESS = { key: "stress", group: "recovery" } as const

/** Google's weight and body-fat readings (daily_metrics); each opens its detail screen. */
const BODY_DEFS = [
  { key: "weight", unit: "kg", format: "decimal1", direction: "neutral", href: metricHref("weight") },
  { key: "body_fat", unit: "%", format: "decimal1", direction: "neutral", href: metricHref("body_fat") },
] as const satisfies readonly { key: LabelKey; unit: string; format: FormatKey; direction: GoodDirection; href: string }[]
export const BODY_METRICS = BODY_DEFS.map(withLabel)
export type BodyKey = (typeof BODY_DEFS)[number]["key"]

export type DashboardKey = (typeof CORE)[number]["key"] | ScoredKey | typeof STRESS.key | BodyKey | ExtraKey

const ALL = (
  [
    ...CORE,
    ...SCORED,
    STRESS,
    ...BODY_METRICS.map((m) => ({ key: m.key, group: "body" as const })),
    ...EXTRA_METRICS.map((m) => ({ key: m.key, group: m.group })),
  ] as { key: DashboardKey & LabelKey; group: DashboardGroup }[]
).map(withLabel)

/** Every metric, in editor order: by group, then catalogue order within it. */
export const DASHBOARD_METRICS = DASHBOARD_GROUPS.flatMap((g) => ALL.filter((m) => m.group === g.key))

/** `DASHBOARD_LABEL[key]` resolves the name per read. */
export const DASHBOARD_LABEL: Record<DashboardKey, string> = labelRecord(ALL.map((m) => m.key))

export const isDashboardKey = (k: string): k is DashboardKey => Object.hasOwn(DASHBOARD_LABEL, k)

/** The default list, the reference app's (dashboard-03); installs that never saved a list follow it. */
export const DASHBOARD_DEFAULT: DashboardKey[] = ["hrv", "sleep", "consistency", "hours", "stress", "rhr", "vo2max", "steps"]

/** The default for an account that has never synced heart rate (phone only, no Fitbit band): what its phone counts. */
export const PHONE_DEFAULT: DashboardKey[] = ["steps", "distance", "calories", "active_minutes", "active_calories", "floors"]

/** Phone Home's lead card (spec §11 CD2): what a phone records without a band. */
export const PHONE_STATS: DashboardKey[] = ["steps", "distance", "calories", "active_minutes"]
