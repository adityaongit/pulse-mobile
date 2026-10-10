// View-model → kit-prop mappers shared by the screens (Home, Recovery, Strain, Activity, Sleep, Health, Trends). Ported
// from pulse src/app/(app)/_lib/view.tsx: the mappers are unchanged; icons come from lucide-react-native and are drawn as
// the kit draws stat icons (20 px, muted); the legend strip is React Native text.
import type { ReactNode } from "react"
import { View } from "react-native"
import {
  Activity,
  ChartSpline,
  Armchair,
  BedDouble,
  CircleGauge,
  BatteryCharging,
  Building2,
  CalendarCheck,
  ChartNoAxesColumn,
  Droplet,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  Gauge,
  GlassWater,
  Heart,
  HeartPulse,
  Hourglass,
  Moon,
  Mountain,
  Percent,
  Route,
  Syringe,
  Thermometer,
  ThermometerSun,
  Timer,
  Utensils,
  Waves,
  Weight,
  Wheat,
  Wind,
  PersonStanding,
  Zap,
  type LucideIcon,
} from "lucide-react-native"
import type { EnergySeries } from "@/ui/charts/EnergyBankChart"
import type { HrSeries } from "@/ui/charts/IntradayHrChart"
import type { StressSeries } from "@/ui/charts/StressChart"
import type { TrendPoint } from "@/ui/charts/TrendChart"
import type { KeyStatRowProps } from "@/ui/metrics/KeyStatRow"
import { DeltaMark } from "@/ui/metrics/primitives"
import { cn } from "@/ui/cn"
import { Icon } from "@/ui/Icon"
import { Text } from "@/ui/Text"
import type { FormatKey } from "@/lib/format"
import { dayHref, RANGE_DAYS, type TrendRange } from "@/lib/url"
import type { EnergyBankVM, HrChart, KeyStat, Metric, StressDayChart, Trend } from "@/queries/types"

export { CAPTION, LABEL } from "@/ui/metrics/primitives"
/** The inset legend strip under a summary card (spec §7.2, §7.3, §7.5). */
export const LEGEND = "mt-1 mb-3 rounded-lg bg-inset px-3 py-2 text-xs leading-4 font-medium text-foreground-secondary"

/** The strip under a score's rows: the two arrows and "Today vs. prior 30 days" (Strain) or "last 30 days" (Recovery). */
export function TodayVsLegend({ period }: { period: string }) {
  return (
    <View className={cn(LEGEND, "flex-row items-center gap-2")}>
      <View accessibilityElementsHidden className="flex-row items-center gap-1">
        <DeltaMark dir="up" tone="good" />
        <DeltaMark dir="down" tone="bad" />
      </View>
      <Text className="text-xs font-medium leading-4 text-foreground-secondary">
        <Text className="text-xs font-semibold leading-4 text-foreground">Today</Text> vs. {period}
      </Text>
    </View>
  )
}

/** Maps a metric's value, keeping its reason and tags. */
export const mapMetric = <A, B>(m: Metric<A>, f: (a: A) => B): Metric<B> =>
  ({ ...m, value: m.value === null ? null : f(m.value) })

const FORMAT_BY_UNIT: Record<string, FormatKey> = { ms: "int", bpm: "int", rpm: "decimal1", "%": "int", kcal: "grouped", "°C": "signed1", min: "duration" }

export const STAT_ICON: Record<string, LucideIcon> = {
  hrv: Activity,
  rhr: Heart,
  avgHr: Heart,
  maxHr: HeartPulse,
  resp: Wind,
  sleep: Moon,
  calories: Zap,
  steps: Footprints,
  spo2: Droplet,
  skin: Thermometer,
  stress: ChartSpline,
  zones13: HeartPulse,
  zones45: HeartPulse,
  strength: Dumbbell,
  pace: Gauge,
  // Sleep summary rows carry an icon each, as the reference app's do [latest-sleep-1] (spec §11 F20).
  hours: Hourglass,
  consistency: CalendarCheck,
  efficiency: ChartNoAxesColumn,
  restorative: BatteryCharging,
  // Trend View metrics that have no summary row of their own (spec §11 R29).
  recovery: CircleGauge,
  hours_need: Hourglass,
  time_in_bed: BedDouble,
  sleep_stress: ChartSpline,
  strain: Flame,
  // Extra metrics (src/lib/extraMetrics.ts) and the body measurements.
  distance: Route,
  floors: Building2,
  elevation: Mountain,
  active_minutes: Timer,
  light_minutes: Timer,
  azm: HeartPulse,
  active_calories: Flame,
  sedentary_minutes: Armchair,
  avg_hr: Heart,
  water: GlassWater,
  calories_in: Utensils,
  protein: Utensils,
  carbs: Wheat,
  fat: Droplets,
  glucose: Syringe,
  core_temp: ThermometerSun,
  swim_strokes: Waves,
  weight: Weight,
  body_fat: Percent,
  // The reference app's My Dashboard rows (spec §11 R41).
  restorative_pct: BatteryCharging,
  debt: BedDouble,
  zones_all: HeartPulse,
  vo2max: Gauge,
  lean_mass: PersonStanding,
}

/** A stat's icon as the kit's rows draw it (20 px, muted), or undefined for a key without one. */
export const statIcon = (key: string): ReactNode => (STAT_ICON[key] ? <Icon icon={STAT_ICON[key]} size={20} tone="muted-foreground" /> : undefined)

/**
 * KeyStat → KeyStatRow props. Minutes render as h:mm with no unit; unitless counts are grouped.
 * `link` adds `?d=` to the stat's detail route.
 */
export function statProps(s: KeyStat, link?: { d: string; today: string }, icons = true): Omit<KeyStatRowProps, "variant"> {
  return {
    label: s.label,
    icon: icons ? statIcon(s.key) : undefined,
    metric: s.metric,
    unit: s.unit === "min" ? undefined : s.unit,
    format: s.format ?? (s.unit ? (FORMAT_BY_UNIT[s.unit] ?? "decimal1") : "grouped"),
    average: s.average,
    sd: s.sd,
    direction: s.direction,
    status: s.status,
    chip: s.chip,
    caption: s.caption,
    href: s.href && link ? dayHref(s.href, link.d, link.today) : undefined,
  }
}

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** Trend → TrendChart data, plus each range's average against the range before it. */
export function trendProps(t: Trend) {
  const pts: TrendPoint[] = t.points.map((p) => ({ date: p.day, value: p.value, provisional: p.provisional }))
  const deltas: Partial<Record<TrendRange, number | null>> = {}
  for (const r of ["w", "m"] as const) {
    const n = RANGE_DAYS[r]
    const now = mean(pts.slice(-n).map((p) => p.value))
    const prior = mean(pts.slice(-2 * n, -n).map((p) => p.value))
    deltas[r] = now === null || prior === null ? null : Math.round((now - prior) * 10) / 10
  }
  return { data: { value: pts, reason: null, provisional: false } satisfies Metric<TrendPoint[]>, deltas, baseline: t.baseline, target: t.target }
}

/** HrChart → IntradayHrChart series. Naps draw as sleep spans; the open top zone ends at max HR. */
export const hrSeries = (m: Metric<HrChart>, maxHr: number): Metric<HrSeries> =>
  mapMetric(m, (h) => ({
    points: h.points.map((p) => ({ t: p.t, bpm: p.v })),
    zones: h.zones.map((z) => ({ zone: z.zone, label: z.label, min: z.min, max: z.max ?? maxHr })),
    spans: h.spans.map((s) => ({ kind: s.kind === "workout" ? "workout" : "sleep", label: s.label, start: s.start, end: s.end })),
    now: h.now ?? undefined,
  }))

/** Drains closer than this to a bigger one are left unlabelled on the chart, so labels never overlap. */
const DRAIN_GAP_MS = 90 * 60_000

/** A day's stress line as the chart draws it: naps count as sleep spans (Stress Monitor, Home's tile). */
export const stressSeries = (m: Metric<StressDayChart>): Metric<StressSeries> =>
  mapMetric(m, (c) => ({
    points: c.points.map((p) => ({ t: p.t, value: p.v })),
    spans: c.spans.map((s) => ({ ...s, kind: s.kind === "nap" ? "sleep" : s.kind })),
    now: c.now ?? undefined,
  }))

export function energySeries(e: EnergyBankVM): EnergySeries {
  const drains: NonNullable<EnergySeries["drains"]> = []
  for (const d of [...e.drains].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)))
    if (drains.every((k) => Math.abs(k.t - d.start) >= DRAIN_GAP_MS)) drains.push({ t: d.start, amount: Math.abs(d.amount), label: d.label })
  return { points: e.curve.map((p) => ({ t: p.t, value: p.v })), drains, naps: e.naps }
}
