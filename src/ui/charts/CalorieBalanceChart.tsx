import { Group, RoundedRect } from "@shopify/react-native-skia";
import { DATA_COLORS } from "@/lib/bands";
import { alpha } from "../color";
import { useTheme } from "../theme";
import { bandCenters, barWidth, linearScale, ticksIn } from "./geometry";
import { ChartFigure, ChartLabel, DashedLine, GridLines, labelGutter, Pill, PlotCanvas } from "./ChartFrame";

export type BalanceBar = {
  label: string;
  /** Calories eaten, coloured by `zone`; null draws no bar. */
  kcalIn: number | null;
  zone: "under" | "in" | "over" | null;
  /** Calories burned (grey); null draws no bar. */
  kcalOut: number | null;
};

export const ZONE_TOKEN = { under: "strain", in: "optimal", over: "warning" } as const;

const HEIGHT = 176;
const AXIS_H = 30;
const MAX_BAR = 14;

/** Seven days of calories in (coloured by zone) beside calories out (grey), with the goal dashed. No tooltip: the summary and the day labels carry it. */
export function CalorieBalanceChart({ summary, data, goal, goalLabel }: { summary: string; data: BalanceBar[]; goal: number; goalLabel: string }) {
  const { css, c } = useTheme();
  const margin = { top: 8, right: labelGutter([goalLabel], 12), bottom: 0, left: 12 };
  return (
    <ChartFigure summary={summary} height={HEIGHT}>
      {({ width, height }) => {
        const [x0, x1] = [margin.left, width - margin.right];
        const [y0, y1] = [margin.top, height - AXIS_H];
        const top = Math.max(...data.flatMap((d) => [d.kcalIn ?? 0, d.kcalOut ?? 0]), goal) || 1;
        const y = linearScale([0, top], [y1, y0]);
        const { step, centers } = bandCenters(data.length, x0, x1, 0.1);
        const bw = Math.min(barWidth(step, 0.1, MAX_BAR * 2) / 2, MAX_BAR);
        return (
          <>
            <PlotCanvas width={width} height={height}>
              <GridLines ys={ticksIn(0, top, 5).map(y)} x0={x0} x1={x1} />
              <DashedLine x1={x0} x2={x1} y1={y(goal)} y2={y(goal)} color={c["chart-cursor"]} />
              {data.map((d, i) => (
                <Group key={i}>
                  {d.kcalIn !== null && d.zone && d.kcalIn > 0 && <RoundedRect x={centers[i] - bw - 1} y={y(d.kcalIn)} width={bw} height={y1 - y(d.kcalIn)} r={3} color={css(DATA_COLORS[ZONE_TOKEN[d.zone]].css)} />}
                  {d.kcalOut !== null && d.kcalOut > 0 && <RoundedRect x={centers[i] + 1} y={y(d.kcalOut)} width={bw} height={y1 - y(d.kcalOut)} r={3} color={alpha(c.foreground, 0.28)} />}
                </Group>
              ))}
            </PlotCanvas>
            {data.map((d, i) => (
              <ChartLabel key={i} x={centers[i]} y={y1 + 16} anchor="middle" w={Math.max(36, step)}>{d.label}</ChartLabel>
            ))}
            <Pill x={x1 + 4} y={y(goal)} text={goalLabel} />
          </>
        );
      }}
    </ChartFigure>
  );
}
