// The chart explorer `/chart?metric=&r=&d=&compare=` (halo src/screens/chart/ChartExplorer.tsx): one metric full screen
// over its whole history (W / M / 6M / 1Y / All) or one day's minutes, with pinch-zoom and pan, a hold-to-inspect
// crosshair and readout, the window's average, low and high, its normal range and goal, and a second metric on its own
// axis to compare against. A day shows the metric's own picture of it beside the day's heart rate: Day Strain building
// up, stress or the Energy Bank with heart rate on the right axis; resting and average heart rate as a labelled line on
// the heart rate; workouts lit on it; the night's heart rate over its stage lanes. Our chrome: the detail header row, the
// range as the kit's segmented control, the window's numbers and the chart on cards. The pickers are the route sheet
// /chart-metric (./MetricPage.tsx).
import * as React from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { groupLabel } from "@/lib/metricLabels";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronsUpDown, Plus, X } from "lucide-react-native";
import { DATA_COLORS, recoveryColor, STRESS_COLOR, stressLevel } from "@/lib/bands";
import { bandColor, type Band } from "@/lib/charts";
import { formatValue, MISSING, type FormatKey } from "@/lib/format";
import { CHART_METRICS, chartDef, DAY_VIEW, getChartDay, getChartSeries, type ChartDayVM, type ChartDef, type ChartSeriesVM, type DayView } from "@/queries/chart";
import { useScreen } from "@/screens/useScreen";
import { trendGoal, useGoals } from "@/state/goals";
import { LABEL } from "@/ui/metrics/primitives";
import { wholeTick } from "@/ui/charts/ChartFrame";
import { zoneBands } from "@/ui/charts/spans";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import type { Palette } from "@/ui/palette";
import { Press } from "@/ui/Press";
import { Segmented } from "@/ui/Segmented";
import { DateSwitcher } from "@/ui/shells/DateSwitcher";
import { DetailHeaderRow } from "@/ui/shells/DetailHeader";
import { EmptyState } from "@/ui/shells/EmptyState";
import { useShellCalendar } from "@/ui/shells/ShellStatus";
import { Skeleton } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { ExplorerChart } from "./ExplorerChart";
import { useChartFonts } from "./fonts";
import {
  alignDaily,
  compareDomain,
  compareIndex,
  DAILY_RANGES,
  dailySeries,
  DAY_COMPARE,
  dayCompareView,
  dayReference,
  daySeries,
  dayWhy,
  deltaText,
  drawsBars,
  extentOf,
  gainNotes,
  inWorkouts,
  levelsFor,
  NO_COMPARE,
  noteFor,
  parseRange,
  pointLabels,
  rangeAria,
  rangeLabel,
  runningStats,
  STAGE_NAME,
  stageNotes,
  summaryOf,
  unitText,
  valueText,
  windowFor,
  windowText,
  workoutNotes,
  workoutWindow,
  yDomain,
  type Range,
  type Series,
  type SeriesColor,
} from "./model";
import { push } from "@/ui/navigate";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
type Paint = { line: string; bands: Band[] | null; barColors: string[]; group: (v: number) => number; point: (v: number) => string };

/** A single-hue series' colour: Strain's blue, Sleep's, else the first chart colour. */
const hueOf = (c: Palette, x: SeriesColor) => (x === "strain" ? c.strain : x === "sleep" ? c.sleep : x === "band" ? c["recovery-green"] : x === "stress" ? c["stress-high"] : x === "zones" ? c["recovery-red"] : c["chart-5"]);

/** How a series is coloured: band and stress metrics by value (a gradient line, bars in three colours), heart rate by zone. */
function paintOf(colorBy: SeriesColor, c: Palette, css: (v: string) => string, zones: ChartDayVM["zones"], view?: DayView): Paint {
  if (colorBy === "band") {
    const bands = [0, 34, 67].map((from) => ({ from, color: css(DATA_COLORS[recoveryColor(from)].css) }));
    return { line: bands[2].color, bands, barColors: bands.map((b) => b.color), group: (v) => (v >= 67 ? 2 : v >= 34 ? 1 : 0), point: (v) => bandColor(v, bands) };
  }
  if (colorBy === "stress") {
    const bands = [0, 30, 60].map((from) => ({ from, color: css(DATA_COLORS[STRESS_COLOR[stressLevel(from)]].css) }));
    return { line: bands[1].color, bands, barColors: bands.map((b) => b.color), group: (v) => (v >= 2 ? 2 : v >= 1 ? 1 : 0), point: (v) => bandColor(v, bands) };
  }
  if (colorBy === "zones") {
    const bands = zoneBands(zones).map((b) => ({ ...b, color: css(b.color) }));
    const heart = hueOf(c, "zones");
    return { line: c["foreground-secondary"], bands: zones.length ? bands : null, barColors: [heart], group: () => 0, point: (v) => (zones.length ? bandColor(v, bands) : heart) };
  }
  const line = hueOf(c, view === "sleep" ? "sleep" : colorBy);
  return { line, bands: null, barColors: [line], group: () => 0, point: () => line };
}

/** A compare line's colour: the metric's own hue, unless the primary already wears it. */
const compareColorOf = (primary: SeriesColor, compare: SeriesColor, c: Palette) => (hueOf(c, compare) !== hueOf(c, primary) ? hueOf(c, compare) : c["chart-4"]);

const tickText = (format: FormatKey) => (format === "duration" ? (v: number) => formatValue(format, v) : wholeTick((v) => formatValue(format, v)));

/** One of the window's numbers, as Trend View's headline: the caps label, then the value in the numeric face, its unit small. */
function Stat({ label, value, format, unit, text }: { label: string; value: number | null | undefined; format: FormatKey; unit?: string; text?: string }) {
  const { t } = useTranslation("trends");
  const s = value === undefined ? MISSING : (text ?? formatValue(format, value));
  const has = s !== MISSING && value !== null;
  return (
    <View accessible accessibilityLabel={t("statAria", { label, value: has ? (text ?? valueText(value, format, unit)) : t("noValue") })} className="min-w-0 flex-1">
      <Text className={cn(LABEL, "text-muted-foreground")}>{label}</Text>
      <Text className="font-numeric text-[28px] font-bold leading-8 tabular-nums" numberOfLines={1}>
        {has ? s : MISSING}
        {has && unit ? <Text className="text-[13px] font-semibold text-muted-foreground">{unitText(unit)}</Text> : null}
      </Text>
    </View>
  );
}

/** A legend entry in TrendLegend's style: the series' swatch (a line, a dashed line, a block or a dot) and its caps name. */
function LegendKey({ color, label, mark = "line" }: { color: string; label: string; mark?: "line" | "dash" | "block" | "dot" }) {
  return (
    <View className="min-h-6 flex-row items-center gap-1.5">
      {mark === "line" && <View style={{ width: 12, height: 3, borderRadius: 1.5, backgroundColor: color }} />}
      {mark === "dash" && (
        <View style={{ width: 12, flexDirection: "row", justifyContent: "space-between" }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: 3, height: 2, borderRadius: 1, backgroundColor: color }} />
          ))}
        </View>
      )}
      {mark === "block" && <View className="size-2.5 rounded-xs" style={{ backgroundColor: color }} />}
      {mark === "dot" && <View className="size-2.5 rounded-full" style={{ backgroundColor: color }} />}
      <Text className={cn(LABEL, "text-[11px] text-foreground-secondary")}>{label}</Text>
    </View>
  );
}

/** The compare control: a caps text action, as Trend View's links. */
const COMPARE = "min-h-11 flex-row items-center gap-1.5";

export default function ChartExplorer() {
  const { t } = useTranslation("trends");
  const params = useLocalSearchParams<{ metric?: string; r?: string; d?: string; compare?: string }>();
  const { c, css } = useTheme();
  const insets = useSafeAreaInsets();
  const fonts = useChartFonts();
  const { today } = useShellCalendar();
  const { goals } = useGoals();

  const def: ChartDef = chartDef(params.metric) ?? chartDef(CHART_METRICS[0].key)!;
  const range: Range = parseRange(typeof params.r === "string" ? params.r : undefined, !!def.day);
  const mode = range === "day" ? "day" : "daily";
  const view = mode === "day" ? def.day! : null;
  const d = typeof params.d === "string" && DAY_RE.test(params.d) && params.d <= today ? params.d : today;
  const rawParam = typeof params.compare === "string" && params.compare ? params.compare : undefined;
  const rawCompare = chartDef(rawParam);
  const picked = rawCompare && rawCompare.key !== def.key ? rawCompare : null;
  // Daily: any other metric. A day: another of the clock-sharing day views, by default the day's heart rate beside
  // Strain, stress and the Energy Bank ("none" turns that off).
  const cmpView: DayView | null = view ? dayCompareView(view, rawParam === NO_COMPARE ? NO_COMPARE : (picked?.day ?? null)) : null;
  const cmp: ChartDef | null = mode === "daily" ? picked : cmpView ? chartDef(DAY_COMPARE.find((x) => x.view === cmpView)?.key) : null;

  // Only the keys given change; a null clears that param (replaced in place, so Back leaves the screen).
  const setParams = (next: { r?: Range; compare?: string | null }) => {
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(next)) out[key] = val ?? "";
    router.setParams(out);
  };
  // Clearing the compare: a day view remembers "none" (its default would come back otherwise).
  const clearCompare = () => setParams({ compare: mode === "day" ? NO_COMPARE : null });
  const pick = (kind: "metric" | "compare") =>
    push(`/chart-metric?for=${kind}&metric=${encodeURIComponent(def.key)}&r=${range}${params.d ? `&d=${params.d}` : ""}${rawParam ? `&compare=${encodeURIComponent(rawParam)}` : ""}`);

  // --- Data ---
  const series = useScreen((ctx) => (mode === "daily" ? getChartSeries(def.key, ctx) : Promise.resolve(null)), ["chartSeries", mode === "daily" ? def.key : null]);
  const day = useScreen((ctx) => (view ? getChartDay(view, d, ctx) : Promise.resolve(null)), ["chartDay", view, d]);
  const cmpSeries = useScreen((ctx) => (mode === "daily" && cmp ? getChartSeries(cmp.key, ctx) : Promise.resolve(null)), ["chartSeries", mode === "daily" ? (cmp?.key ?? null) : null]);
  const cmpDay = useScreen((ctx) => (mode === "day" && cmpView ? getChartDay(cmpView, d, ctx) : Promise.resolve(null)), ["chartDay", mode === "day" ? cmpView : null, d]);
  const dailyVm: ChartSeriesVM | null = mode === "daily" && series.data?.key === def.key ? series.data : null;
  const dayVm: ChartDayVM | null = view && day.data?.view === view && day.data.day === d ? day.data : null;
  const cmpDailyVm = mode === "daily" && cmp && cmpSeries.data?.key === cmp.key ? cmpSeries.data : null;
  const cmpDayVm = mode === "day" && cmpView && cmpDay.data?.view === cmpView && cmpDay.data.day === d ? cmpDay.data : null;
  const error = mode === "daily" ? series.error : day.error;

  const title = view ? DAY_VIEW[view].label : def.label;
  const unit = view ? DAY_VIEW[view].unit : def.unit;
  const format = view ? DAY_VIEW[view].format : def.format;
  const workouts = view === "hr" && def.key === "workouts";

  // --- The model: series, colours, the readout's text ---
  const model = React.useMemo(() => {
    let primary: Series | null = null;
    let compare: Series | null = null;
    let days: string[] | null = null;
    let end = 0;
    let extent: { min: number; max: number; minSpan: number } | null = null;
    if (mode === "daily" && dailyVm) {
      primary = dailySeries(def, dailyVm);
      days = dailyVm.days;
      end = Math.max(0, days.indexOf(d) >= 0 ? days.indexOf(d) : days.length - 1);
      extent = extentOf("daily", primary);
      if (cmp && cmpDailyVm)
        compare = {
          ...dailySeries(cmp, cmpDailyVm),
          xs: primary.xs,
          ys: alignDaily(dailyVm, cmpDailyVm),
          partial: alignDaily(dailyVm, { ...cmpDailyVm, values: cmpDailyVm.partial.map((p) => (p ? 1 : null)) }).map((x) => x === 1),
        };
    } else if (mode === "day" && dayVm && view) {
      primary = daySeries(dayVm, title, unit, format);
      extent = extentOf("day", primary, dayVm.from, dayVm.to);
      // A compare with nothing on this day (no Energy Bank yet) draws no line and no axis.
      if (cmpView && cmpDayVm && cmpDayVm.ys.some((y) => y !== null)) compare = daySeries(cmpDayVm, DAY_VIEW[cmpView].label, DAY_VIEW[cmpView].unit, DAY_VIEW[cmpView].format);
    }
    if (!primary || !extent) return null;
    const paint = paintOf(primary.colorBy, c, css, dayVm?.zones ?? [], view ?? undefined);
    const comparePaint = compare ? compareColorOf(primary.colorBy, compare.colorBy, c) : c["chart-4"];
    // Heart rate beside Day Strain keeps its zone colours (Strain builds only in the zones); beside stress or the Energy
    // Bank it is one quiet colour, so the primary's own colours stay the ones that mean something.
    const compareBands = compare && view === "strain" && cmpView === "hr" && cmpDayVm?.zones.length ? zoneBands(cmpDayVm.zones).map((b) => ({ ...b, color: css(b.color) })) : null;
    const compareColors = compare && compareBands ? compare.ys.map((v) => (v === null ? comparePaint : bandColor(v, compareBands))) : null;
    const baseline = dailyVm?.baseline ?? null;
    // The shaded range: the normal range (daily), or the day's Strain Target under Day Strain.
    const shade = baseline ? { lo: baseline.mean - baseline.sd, hi: baseline.mean + baseline.sd, label: i18n.t("trends:shadeNormal") } : view === "strain" && dayVm?.band ? { ...dayVm.band, label: i18n.t("trends:shadeStrainTarget", { lo: formatValue("int", dayVm.band.lo), hi: formatValue("pct", dayVm.band.hi) }) } : null;
    const goalY = mode === "daily" ? trendGoal(goals, def.key) : null;
    // A heart-rate day draws its metric's own value as a labelled line: the day's resting heart rate, or its average.
    const ref = view === "hr" && dayVm ? dayReference(def.key, dayVm.refs) : null;
    const goal = goalY !== null ? { y: goalY, label: i18n.t("trends:goalLine", { value: formatValue(format, goalY) }) } : mode === "daily" ? (dailyVm?.reference ?? null) : ref ? { y: ref.y, label: i18n.t("trends:refLine", { label: ref.label, value: valueText(ref.y, format, unit) }) } : null;
    const cIdx = compare ? compareIndex(mode, primary, compare) : primary.xs.map(() => -1);
    const dates = pointLabels(mode, primary.xs, days, today);
    const values = primary.ys.map((v) => (v === null ? i18n.t("trends:noData") : valueText(v, format, unit)));
    const compares = compare ? cIdx.map((j) => (j < 0 ? MISSING : valueText(compare!.ys[j], compare!.format, compare!.unit))) : [];
    // What a day view says of each point from its own data (else the window's: the normal range, the goal or the average).
    const refNotes = ref ? primary.ys.map((v) => noteFor(v, format, unit, { reference: ref })) : null;
    const viewNotes: (string | null)[] | null =
      !dayVm || !view ? null : view === "sleep" ? stageNotes(primary.xs, dayVm.stages, dayVm.bed, dayVm.wake) : view === "strain" ? gainNotes(primary) : workouts ? workoutNotes(primary.xs, dayVm.spans).map((w, i) => w ?? refNotes?.[i] ?? null) : refNotes;
    const colors = primary.ys.map((v) => (v === null ? c["muted-foreground"] : paint.point(v)));
    // Group 3: today's running total, drawn faded in its own colour.
    const barGroup = primary.ys.map((v, i) => (v === null ? 0 : primary!.partial?.[i] ? 3 : paint.group(v)));
    const partialAt = primary.partial?.findIndex(Boolean) ?? -1;
    const partialColor = partialAt >= 0 && primary.ys[partialAt] !== null ? paint.point(primary.ys[partialAt]!) : null;
    // Day Strain so far is the number this view is about: its latest point is marked with its value.
    let latest: { index: number; text: string } | null = null;
    if (primary.cumulative) for (let i = primary.ys.length - 1; i >= 0 && !latest; i--) if (primary.ys[i] !== null) latest = { index: i, text: valueText(primary.ys[i], format, unit) };
    const hot = workouts && dayVm ? inWorkouts(primary.xs, dayVm.spans) : null;
    // A day names both series in the readout; a daily chart leaves the metric to the header and names the compare.
    const names = mode === "day" ? { primary: primary.label, compare: compare?.label ?? null } : compare ? { primary: null, compare: compare.label } : null;
    const home = mode === "day" ? ((workouts && dayVm ? workoutWindow(dayVm.spans, extent) : null) ?? { start: extent.min, span: extent.max - extent.min }) : null;
    const dataKey = `${mode}|${primary.key}|${days?.length ?? primary.xs.length}|${dayVm?.day ?? ""}|${compare?.key ?? ""}|${compare ? compare.ys.length : 0}`;
    return { primary, compare, days, end, extent, home, paint, comparePaint, compareBands, compareColors, baseline, shade, goal, ref, personalGoal: goalY !== null, cIdx, dates, values, compares, viewNotes, colors, barGroup, partialColor, latest, hot, names, dataKey, levels: levelsFor(mode, days, extent.min, extent.max) };
  }, [mode, dailyVm, dayVm, cmp, cmpView, cmpDailyVm, cmpDayVm, def, d, view, title, unit, format, c, css, goals, today, workouts]);

  // --- The viewport JS knows about: the range's window, then wherever a gesture settled ---
  const home = React.useMemo(() => (!model ? null : (model.home ?? windowFor(range, model.primary, model.end))), [model, range]);
  const viewKey = model ? `${model.dataKey.split("|").slice(0, 4).join("|")}|${range}` : "";
  const [settled, setSettled] = React.useState<{ key: string; start: number; span: number } | null>(null);
  const v = model && home ? (settled && settled.key === viewKey ? settled : { key: viewKey, ...home }) : null;
  const onViewport = React.useCallback((start: number, span: number) => setSettled({ key: viewKey, start, span }), [viewKey]);
  const win = React.useMemo(() => (v ? { start: v.start, span: v.span } : { start: 0, span: 1 }), [v?.start, v?.span]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Axes and summary for the visible window (refit when a gesture settles, never per frame) ---
  const axes = React.useMemo(() => {
    if (!model || !v) return null;
    const from = v.start;
    const to = v.start + v.span;
    const bars = drawsBars(model.primary, v.span);
    const domain = yDomain(model.primary, from, to, { bars, extra: [model.goal?.y, model.shade?.lo, model.shade?.hi], count: 3 });
    const domain2 = model.compare ? compareDomain(model.compare, from, to, domain.ticks.length) : null;
    const stats = summaryOf(model.primary, from, to);
    const running = model.primary.cumulative ? runningStats(model.primary, from, to) : null;
    const cStats = model.compare ? summaryOf(model.compare, from, to) : null;
    const yLabels = domain.ticks.map(tickText(format));
    const y2Labels = domain2 && model.compare ? domain2.ticks.map(tickText(model.compare.format)) : [];
    // Each point against the normal range, else the goal, else the window's average (a day view's own note first).
    const basis = { baseline: model.baseline, goal: model.goal && model.personalGoal && !model.baseline ? model.goal.y : null, average: stats.avg };
    const notes = model.primary.ys.map((y, i) => (model.primary.partial?.[i] ? i18n.t("trends:soFarToday") : (model.viewNotes?.[i] ?? noteFor(y, format, unit, basis))));
    return { from, to, domain, domain2, stats, running, cStats, yLabels, y2Labels, notes };
  }, [model, v?.start, v?.span, format, unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const readout = React.useMemo(() => (model && axes ? { dates: model.dates, values: model.values, compares: model.compares, notes: axes.notes, colors: model.colors, compareColors: model.compareColors } : null), [model, axes]);

  // --- Layout ---
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const ranges: Range[] = def.day ? ["day", ...DAILY_RANGES] : [...DAILY_RANGES];
  const canCompare = mode === "daily" || (view !== null && view !== "sleep");
  const empty = model ? model.primary.ys.every((y) => y === null) : false;
  // A day's line beside it (heart rate by default) is waited for, so both draw in together, once.
  const loading = (!model && !error) || (mode === "day" && !!cmpView && !cmpDayVm && !cmpDay.error);
  // The compare's day loaded with nothing on it: the chart has no second line, so neither does the header.
  const cmpEmpty = !!cmpDayVm && cmpDayVm.ys.every((y) => y === null);
  const subtitle = mode === "daily" ? groupLabel(def.group) : view ? dayWhy(view, def.key, cmp && !cmpEmpty ? cmpView : null) : undefined;
  const windowLabel = model && axes ? windowText(mode, axes.from, axes.to, model.days, today) : "";
  const compareName = mode === "day" && cmpView ? DAY_VIEW[cmpView].label : (cmp?.label ?? "");
  const primaryColor = model?.paint.bands ? model.paint.bands[model.paint.bands.length - 1].color : (model?.paint.line ?? c["chart-5"]);
  const stageColor = { awake: c["stage-awake"], rem: c["stage-rem"], light: c["stage-light"], deep: c["stage-deep"] } as const;

  // The window's numbers: a running total (Day Strain) as where it stood, what it gained and the compare's average;
  // everything else as its average, low and high.
  const stats = !axes ? (
    <>
      <Stat label={t("stat.average")} value={undefined} format={format} unit={unit} />
      <Stat label={t("stat.low")} value={undefined} format={format} unit={unit} />
      <Stat label={t("stat.high")} value={undefined} format={format} unit={unit} />
    </>
  ) : axes.running ? (
    <>
      <Stat label={t("stat.strain")} value={axes.running.end} format={format} unit={unit} />
      <Stat label={t("stat.gained")} value={axes.running.gained} format={format} unit={unit} text={axes.running.gained === null ? undefined : deltaText(axes.running.gained, format, unit)} />
      {model?.compare && cmpView ? <Stat label={t("avgOf", { what: t(`dayShort.${cmpView}`) })} value={axes.cStats?.avg ?? null} format={model.compare.format} unit={model.compare.unit} /> : <Stat label={t("stat.start")} value={axes.running.start} format={format} unit={unit} />}
    </>
  ) : (
    <>
      <Stat label={t("stat.average")} value={axes.stats.avg} format={format} unit={unit} />
      <Stat label={t("stat.low")} value={axes.stats.min} format={format} unit={unit} />
      <Stat label={t("stat.high")} value={axes.stats.max} format={format} unit={unit} />
    </>
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <DetailHeaderRow
        title={def.label}
        subtitle={subtitle}
        backHref="/"
        action={
          <Press activeScale={0.96} accessibilityRole="button" accessibilityLabel={t("changeMetricNamed", { label: def.label })} onPress={() => (haptic.tap(), pick("metric"))} hitSlop={8} className="h-9 flex-row items-center gap-1 rounded-full bg-secondary px-3">
            <Text className="text-[13px] font-semibold">{t("metricButton")}</Text>
            <Icon icon={ChevronsUpDown} size={16} tone="foreground-secondary" strokeWidth={2} />
          </Press>
        }
      />
      <View className="flex-1 gap-4 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        <View className="gap-4 px-4">
          <Segmented label={t("range")} fill value={range} options={ranges.map((r) => ({ value: r, label: rangeLabel(r), accessibilityLabel: rangeAria(r) }))} onChange={(r) => setParams({ r })} />
          {mode === "day" && (
            <View className="items-center">
              <DateSwitcher mode="day" />
            </View>
          )}
          {/* The visible window's numbers (refreshed when a gesture settles), as Trend View's headline. */}
          <View className="gap-3">
            <Text className="text-[13px] font-medium leading-[18px] tabular-nums text-foreground-secondary">{windowLabel || " "}</Text>
            <View className="flex-row gap-3">{stats}</View>
          </View>
        </View>

        {/* The chart on the ground, as Trend View's: its legend above it at the right, then the plot, at most 340 tall. */}
        <View accessibilityHint={t("zoomHint")} className="min-h-[220px] max-h-[340px] flex-1 px-4">
          <View className="flex-1" onLayout={(e) => setBox({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) })}>
            {error && !model ? (
              <View className="flex-1 justify-center px-4">
                <EmptyState body={t("chartLoadError")} />
              </View>
            ) : loading || !fonts || !box.w || !axes || !readout || !model || !home ? (
              <View className="flex-1 px-3 py-1">
                <Skeleton className="flex-1 rounded-xl" />
              </View>
            ) : empty ? (
              <View className="flex-1 justify-center px-4">
                <EmptyState body={view ? t(`emptyDay.${view}`) : t("emptyMetric", { label: def.label.toLowerCase() })} />
              </View>
            ) : (
              <ExplorerChart
                width={box.w}
                height={box.h}
                mode={mode}
                primary={model.primary}
                compare={model.compare}
                extent={model.extent}
                window={win}
                home={home}
                domain={axes.domain}
                domain2={axes.domain2}
                yLabels={axes.yLabels}
                y2Labels={axes.y2Labels}
                levels={model.levels}
                baseline={model.shade ? [model.shade.lo, model.shade.hi] : null}
                goal={model.goal}
                spans={dayVm?.spans ?? []}
                emphasis={workouts ? "workouts" : null}
                stages={dayVm?.stages ?? []}
                bed={dayVm?.bed ?? null}
                wake={dayVm?.wake ?? null}
                now={dayVm?.now ?? null}
                readout={readout}
                names={model.names}
                compareIdx={model.cIdx}
                lineColor={model.paint.line}
                bands={model.paint.bands}
                hot={model.hot}
                barGroup={model.barGroup}
                partialColor={model.partialColor}
                barColors={model.paint.barColors}
                compareColor={model.comparePaint}
                compareBands={model.compareBands}
                latest={model.latest}
                dataKey={model.dataKey}
                onViewport={onViewport}
                fonts={fonts}
              />
            )}
          </View>
        </View>

        <View className="gap-2 px-4">
          {/* The legend: every series and line on the chart by name, then the compare (or the action that adds one). */}
          <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
            <LegendKey color={primaryColor} label={title} />
            {model?.ref && model.goal && <LegendKey color={c["chart-cursor"]} label={model.goal.label} mark="dash" />}
            {workouts && <LegendKey color={c.strain} label={t("legendWorkouts")} mark="block" />}
            {view === "sleep" && (dayVm?.stages.length ?? 0) > 0 && (["awake", "rem", "light", "deep"] as const).map((s) => <LegendKey key={s} color={stageColor[s]} label={STAGE_NAME[s]} mark="dot" />)}
            {canCompare &&
              (cmp ? (
                <Press activeScale={0.96} accessibilityRole="button" accessibilityLabel={t("stopComparing", { name: compareName })} onPress={() => (haptic.tap(), clearCompare())} className={cn(COMPARE, "shrink")}>
                  <View style={{ width: 12, height: 3, borderRadius: 1.5, backgroundColor: model?.compareBands ? model.compareBands[model.compareBands.length - 1].color : (model?.comparePaint ?? c["chart-4"]) }} />
                  <Text className={cn(LABEL, "shrink text-[11px] text-foreground-secondary")}>
                    {compareName}
                    {axes?.cStats?.avg != null && model?.compare ? (
                      <Text className="text-muted-foreground">{t("compareAvg", { value: valueText(axes.cStats.avg, model.compare.format, model.compare.unit) })}</Text>
                    ) : cmpEmpty ? (
                      <Text className="text-muted-foreground">{t("compareNone")}</Text>
                    ) : null}
                  </Text>
                  <Icon icon={X} size={14} tone="muted-foreground" strokeWidth={2} />
                </Press>
              ) : (
                <Press activeScale={0.96} accessibilityRole="button" accessibilityLabel={t("compareAria")} onPress={() => (haptic.tap(), pick("compare"))} className={COMPARE}>
                  <Text className={cn(LABEL, "text-[13px]")}>{t("compare")}</Text>
                  <Icon icon={Plus} size={16} tone="foreground" strokeWidth={2.25} />
                </Press>
              ))}
          </View>
          {model?.shade && <Text className="text-[13px] leading-5 text-muted-foreground">{model.shade.label}</Text>}
        </View>
      </View>
    </View>
  );
}
