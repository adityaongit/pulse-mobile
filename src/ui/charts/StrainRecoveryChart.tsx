import { i18n } from "@/i18n/config";
import { RoundedRect } from "@shopify/react-native-skia";
import { recoveryBand } from "@/lib/bands";
import { DAY, formatDay, formatValue } from "@/lib/format";
import { alpha } from "../color";
import { Skeleton } from "../Skeleton";
import { useTheme } from "../theme";
import { ChartFigure, ChartLabel, GridLines, HollowDot, PlotCanvas } from "./ChartFrame";
import { bandCenters, barWidth, linePath, linearScale } from "./geometry";
import { placeLabels, runs } from "./labels";
import { StrokePath } from "./paint";

export type StrainRecoveryPoint = { day: string; strain: number | null; recovery: number | null };

// Text colours on the dark card: red labels use the lifted red (spec §2.3 ◆).
const BAND_TEXT = { green: "recovery-green", yellow: "recovery-yellow", red: "recovery-red-text" } as const;
const BAND_FILL = { green: "recovery-green", yellow: "recovery-yellow", red: "recovery-red" } as const;
const RIGHT_TICKS = [0, 33, 66, 100];
// Strain is a percent on the same thirds as Recovery; a day above 100 % draws at the top, its label the real value.
const LEFT_TICKS = [0, 33, 66, 100];
/**
 * How far today's lit column runs below the plot, behind the 40 px two-line day tick, with room under the date.
 * The bottom margin keeps it inside the chart: at 0 it clipped its last 4 px, square corners and all.
 */
const TODAY_TAIL = 48;
const HEIGHT = 232;

type Row = StrainRecoveryPoint & { weekday: string; dayOfMonth: string; date: string; today: boolean };

/** Height on the plot, 0 (floor) to 1 (top), so the two axes compare. */
const heightOf = (r: Row | undefined, k: "strain" | "recovery") => (r?.[k] == null ? null : k === "strain" ? Math.min(1, r.strain! / 100) : r.recovery! / 100);

/**
 * The web's preferred side for each label (labelDy's sign; placeLabels then keeps it off every other label and dot).
 * Each label sits where neither line runs: when the other series' dot is close, on the side away from it; otherwise
 * above a peak and under a valley, off its own line; on a slope, away from the other dot (Recovery above, Strain under
 * with one series missing, as the reference app draws them). Near the floor it always goes above, clear of the day ticks.
 */
function labelDy(rows: Row[], index: number, k: "strain" | "recovery") {
  const i = index;
  const self = heightOf(rows[i], k);
  const other = heightOf(rows[i], k === "strain" ? "recovery" : "strain");
  const near = [heightOf(rows[i - 1], k), heightOf(rows[i + 1], k)].filter((v): v is number => v !== null);
  const awayFromOther = other === null ? k === "recovery" : self !== null && self >= other;
  const above =
    self === null || (other !== null && Math.abs(self - other) < 0.15) ? awayFromOther
    : near.length && near.every((v) => v <= self) ? true
    : near.length && near.every((v) => v >= self) ? false
    : awayFromOther;
  return above || (self ?? 0) < 0.17 ? -10 : 20;
}

/**
 * The reference app's Home "Strain & Recovery" week: Strain on the left axis (0-100 %, blue), Recovery on the right
 * (0-100 %, band colours), hollow dots with value labels, today's column lit. Missing days are gaps, never interpolated.
 */
export function StrainRecoveryChart({ points, today }: { points: StrainRecoveryPoint[]; today: string }) {
  const { c, css } = useTheme();
  const rows: Row[] = points.map((p) => ({
    ...p,
    weekday: formatDay(p.day, { weekday: "short" }),
    dayOfMonth: formatDay(p.day, { day: "numeric" }),
    date: formatDay(p.day, DAY.short),
    today: p.day === today,
  }));
  const strains = points.map((p) => p.strain).filter((v): v is number => v !== null);
  const recs = points.map((p) => p.recovery).filter((v): v is number => v !== null);
  const range = (low: string | number, high: string | number) => i18n.t("ui:strainRecovery.range", { low, high });
  const summary = i18n.t("ui:strainRecovery.summary", {
    count: points.length,
    strain: strains.length ? range(formatValue("int", Math.min(...strains)), formatValue("int", Math.max(...strains))) : i18n.t("ui:strainRecovery.notRecorded"),
    recovery: recs.length ? range(Math.round(Math.min(...recs)), Math.round(Math.max(...recs))) : i18n.t("ui:strainRecovery.notRecorded"),
  });

  return (
    <ChartFigure summary={summary} height={HEIGHT}>
      {({ width, height }) => {
        const margin = { top: 20, right: 4, bottom: TODAY_TAIL - 40 + 2, left: 4 };
        const x0 = margin.left + 24;
        const x1 = width - margin.right - 40;
        const y0 = margin.top;
        const y1 = height - margin.bottom - 40;
        const { step, centers } = bandCenters(rows.length, x0, x1, 0.18);
        const bw = barWidth(step, 0.18);
        const strainScale = linearScale([0, 100], [y1, y0]);
        const ys = (v: number) => strainScale(Math.min(100, Math.max(0, v)));
        const yr = linearScale([0, 100], [y1, y0]);
        const rec = rows.map((r, i) => ({ x: centers[i], y: r.recovery === null ? null : yr(r.recovery) }));
        const str = rows.map((r, i) => ({ x: centers[i], y: r.strain === null ? null : ys(r.strain) }));
        const halo = c.card;
        const side = (i: number, k: "strain" | "recovery") => (labelDy(rows, i, k) < 0 ? ("above" as const) : ("below" as const));
        const labels = rows.flatMap((r, i) => [
          ...(r.recovery === null ? [] : [{ key: `rv${r.day}`, x: centers[i], y: yr(r.recovery), text: `${Math.round(r.recovery)}%`, prefer: side(i, "recovery"), color: css(`var(--${BAND_TEXT[recoveryBand(r.recovery)]})`) }]),
          ...(r.strain === null ? [] : [{ key: `sv${r.day}`, x: centers[i], y: ys(r.strain), text: formatValue("int", r.strain), prefer: side(i, "strain"), color: c["strain-text"] }]),
        ]);
        // Centre offsets equal to the web's baselines (10 above, 20 below the point) for 12 px text; the day ticks start 8 px under the plot.
        const placed = placeLabels(labels, { dots: labels.map((l) => ({ x: l.x, y: l.y, r: 5 })), lines: [...runs(rec), ...runs(str)], top: 0, bottom: y1 + 6, above: -14, below: 16 });
        return (
          <>
            <PlotCanvas width={width} height={height}>
              <GridLines ys={LEFT_TICKS.map(ys)} x0={x0} x1={x1} />
              {/* Today's column: a light band behind both series. It runs down behind the day ticks too, so "Sat 3" sits inside the lit column. */}
              {rows.map((r, i) => (r.today ? <RoundedRect key={r.day} x={centers[i] - bw / 2} y={y0} width={bw} height={y1 - y0 + TODAY_TAIL} r={6} color={alpha(c.foreground, 0.06)} /> : null))}
              <StrokePath path={linePath(rec, "linear")} width={1.5} paint={{ color: c["foreground-secondary"] }} opacity={0.35} />
              {rows.map((r, i) => (r.recovery === null ? null : <HollowDot key={`r${r.day}`} x={centers[i]} y={yr(r.recovery)} r={4} stroke={css(`var(--${BAND_FILL[recoveryBand(r.recovery)]})`)} />))}
              <StrokePath path={linePath(str, "linear")} width={2} paint={{ color: c.strain }} />
              {rows.map((r, i) => (r.strain === null ? null : <HollowDot key={`s${r.day}`} x={centers[i]} y={ys(r.strain)} r={4} stroke={c.strain} />))}
            </PlotCanvas>
            {LEFT_TICKS.map((v) => (
              <ChartLabel key={`l${v}`} x={x0 - 8} y={ys(v)} anchor="end" w={24} className="font-semibold" color={c["strain-text"]}>{String(v)}</ChartLabel>
            ))}
            {RIGHT_TICKS.map((v) => (
              <ChartLabel key={`r${v}`} x={x1 + 8} y={yr(v)} anchor="start" w={40} className="font-semibold" color={css(`var(--${BAND_TEXT[recoveryBand(v)]})`)}>{`${v}%`}</ChartLabel>
            ))}
            {/* Two-line day tick ("Fri" over "17"); today in white and bold. */}
            {rows.map((r, i) => (
              <ChartLabel key={`d${r.day}`} x={centers[i]} y={y1 + 8} top lines={2} className={r.today ? "font-bold text-foreground" : undefined} w={Math.max(36, step)}>
                {`${r.weekday}\n${r.dayOfMonth}`}
              </ChartLabel>
            ))}
            {/* Value labels where neither line runs. */}
            {labels.map((l, n) => (
              <ChartLabel key={l.key} x={l.x} y={placed[n]} className="font-bold" color={l.color} halo={halo}>{l.text}</ChartLabel>
            ))}
          </>
        );
      }}
    </ChartFigure>
  );
}

export function StrainRecoveryChartSkeleton() {
  return <Skeleton className="h-[232px] rounded-lg bg-skeleton" />;
}
StrainRecoveryChart.Skeleton = StrainRecoveryChartSkeleton;
