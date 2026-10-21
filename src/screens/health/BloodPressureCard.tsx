import { useState } from "react";
import { View } from "react-native";
import { ChevronRight, Info, Stethoscope } from "lucide-react-native";
import { Circle, Group, Path } from "@shopify/react-native-skia";
import type { BloodPressureCategory } from "@/core/scoring/bloodPressure";
import { formatDay, DAY } from "@/lib/format";
import type { BloodPressurePoint, BloodPressureSummary } from "@/queries/bloodPressure";
import { Card } from "@/ui/Card";
import { ChartFigure, DashedLine, PlotCanvas } from "@/ui/charts/ChartFrame";
import { linearScale, linePath, type Point } from "@/ui/charts/geometry";
import { Icon } from "@/ui/Icon";
import { StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { push } from "@/ui/navigate";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { vitalHref } from "./vitals";

const CATEGORY_CHIP: Record<BloodPressureCategory, { tone: "optimal" | "warning" | "alert"; text: string }> = {
  normal: { tone: "optimal", text: "Normal" },
  elevated: { tone: "warning", text: "Elevated" },
  stage1: { tone: "warning", text: "Stage 1" },
  stage2: { tone: "alert", text: "Stage 2" },
  crisis: { tone: "alert", text: "Crisis" },
};

const CATEGORY_DOT: Record<BloodPressureCategory, string> = {
  normal: "#10b981",
  elevated: "#f59e0b",
  stage1: "#f97316",
  stage2: "#ef4444",
  crisis: "#dc2626",
};

const STAGES: { cat: BloodPressureCategory; label: string; range: string }[] = [
  { cat: "normal", label: "Normal", range: "< 120 and < 80 mmHg" },
  { cat: "elevated", label: "Elevated", range: "120–129 and < 80 mmHg" },
  { cat: "stage1", label: "Stage 1", range: "130–139 or 80–89 mmHg" },
  { cat: "stage2", label: "Stage 2", range: "140+ or 90+ mmHg" },
  { cat: "crisis", label: "Hypertensive Crisis", range: "> 180 and/or > 120 mmHg" },
];

const CHART_H = 140;
const PAD_X = 28;
const PAD_Y = 16;

/** Dual-value 30-day systolic and diastolic trend chart with 120 / 80 mmHg reference lines. */
function TrendPlot({ history }: { history: BloodPressurePoint[] }) {
  const { c } = useTheme();

  const pointsWithData = history.filter((p) => p.systolic !== null && p.diastolic !== null);
  if (!pointsWithData.length) {
    return (
      <View className="h-28 items-center justify-center rounded-lg bg-secondary/30 px-4">
        <Text className="text-center text-xs font-medium text-muted-foreground">
          No blood pressure readings recorded in the last 30 days.
        </Text>
      </View>
    );
  }

  return (
    <ChartFigure summary="30-day blood pressure trend: systolic and diastolic readings" height={CHART_H}>
      {({ width, height }) => {
        const plotW = width - PAD_X * 2;

        // Y range covers both systolic and diastolic with margin
        const allSys = pointsWithData.map((p) => p.systolic!);
        const allDia = pointsWithData.map((p) => p.diastolic!);
        const minY = Math.min(60, Math.min(...allDia) - 10);
        const maxY = Math.max(160, Math.max(...allSys) + 10);

        const scaleY = linearScale([minY, maxY], [height - PAD_Y, PAD_Y]);
        const stepX = plotW / (history.length - 1);
        const getX = (i: number) => PAD_X + i * stepX;

        // Build systolic and diastolic line segments
        const sysCoords: Point[] = [];
        const diaCoords: Point[] = [];
        history.forEach((p, i) => {
          const x = getX(i);
          sysCoords.push({ x, y: p.systolic });
          diaCoords.push({ x, y: p.diastolic });
        });

        const y120 = scaleY(120);
        const y80 = scaleY(80);

        return (
          <View className="relative" style={{ width, height }}>
            <PlotCanvas width={width} height={height}>
              {/* Threshold reference lines: 120 (sys) and 80 (dia) */}
              <DashedLine x1={PAD_X} y1={y120} x2={width - PAD_X} y2={y120} color={c["chart-grid"]} dash={[3, 4]} />
              <DashedLine x1={PAD_X} y1={y80} x2={width - PAD_X} y2={y80} color={c["chart-grid"]} dash={[3, 4]} />

              {/* Systolic line (rose) */}
              <Path
                path={linePath(
                  sysCoords.map((pt) => ({ x: pt.x, y: pt.y !== null ? scaleY(pt.y) : null })),
                )}
                style="stroke"
                strokeWidth={2}
                color="#f43f5e"
              />
              {/* Diastolic line (blue) */}
              <Path
                path={linePath(
                  diaCoords.map((pt) => ({ x: pt.x, y: pt.y !== null ? scaleY(pt.y) : null })),
                )}
                style="stroke"
                strokeWidth={2}
                color="#3b82f6"
              />

              {/* Data point dots */}
              {history.map((p, i) => {
                if (p.systolic === null || p.diastolic === null || !p.category) return null;
                const cx = getX(i);
                const cySys = scaleY(p.systolic);
                const cyDia = scaleY(p.diastolic);
                const dotColor = CATEGORY_DOT[p.category];
                return (
                  <Group key={p.day}>
                    <Circle cx={cx} cy={cySys} r={4} color={dotColor} />
                    <Circle cx={cx} cy={cySys} r={2} color="#ffffff" />
                    <Circle cx={cx} cy={cyDia} r={4} color="#3b82f6" />
                    <Circle cx={cx} cy={cyDia} r={2} color="#ffffff" />
                  </Group>
                );
              })}
            </PlotCanvas>

            {/* Reference labels on the right gutter */}
            <Text
              style={{ position: "absolute", right: 2, top: y120 - 7 }}
              className="text-[9px] font-semibold text-muted-foreground"
            >
              120
            </Text>
            <Text
              style={{ position: "absolute", right: 2, top: y80 - 7 }}
              className="text-[9px] font-semibold text-muted-foreground"
            >
              80
            </Text>
          </View>
        );
      }}
    </ChartFigure>
  );
}

export function BloodPressureCard({
  summary,
  day,
  today,
}: {
  summary: BloodPressureSummary;
  day: string;
  today: string;
}) {
  const [showGuidelines, setShowGuidelines] = useState(false);
  const latest = summary.latest.value;
  const chip = latest ? CATEGORY_CHIP[latest.category] : null;
  const detailUrl = vitalHref("bp", day, today);

  const totalInWindow = Object.values(summary.distribution).reduce((a, b) => a + b, 0);

  return (
    <Card className="gap-5 p-4">
      {/* Header with deep navigation link */}
      <Press
        activeScale={0.98}
        accessibilityRole="button"
        accessibilityLabel={`Blood pressure detail: ${latest ? `${latest.systolic}/${latest.diastolic} mmHg, ${chip?.text}` : "No reading"}`}
        onPress={() => push(detailUrl)}
        className="flex-row items-center justify-between"
      >
        <View className="flex-row items-center gap-2">
          <Icon icon={Stethoscope} size={20} tone="muted-foreground" strokeWidth={1.75} />
          <Text className="text-xs font-bold uppercase tracking-[0.1em] text-foreground-secondary">
            Blood Pressure
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Text className="text-xs font-medium text-muted-foreground">Detail</Text>
          <Icon icon={ChevronRight} size={16} tone="muted-foreground" />
        </View>
      </Press>

      {/* Primary Metric Display */}
      {latest ? (
        <View className="gap-2">
          <View className="flex-row items-baseline justify-between">
            <ValueUnit
              value={`${latest.systolic}/${latest.diastolic}`}
              unit="mmHg"
              className="font-numeric text-4xl font-bold leading-10 tracking-[-0.01em]"
              unitClassName="text-sm font-medium leading-5 text-foreground-secondary"
            />
            {chip && (
              <StatusChip tone={chip.tone} textClassName="text-xs font-bold">
                {chip.text}
              </StatusChip>
            )}
          </View>

          {/* Reading metadata */}
          <Text className="text-xs font-medium leading-4 text-muted-foreground">
            {summary.isToday ? "Today" : formatDay(day, DAY.short)} at {latest.time}
            {latest.bodyPosition ? ` · ${latest.bodyPosition}` : ""}
            {latest.measurementLocation ? ` · ${latest.measurementLocation}` : ""}
            {summary.readings.length > 1 ? ` · ${summary.readings.length} readings on day` : ""}
          </Text>
        </View>
      ) : (
        <View className="gap-1.5 py-1">
          <View className="flex-row items-baseline justify-between">
            <Text className="font-numeric text-3xl font-bold text-muted-foreground">--/--</Text>
            {summary.latestPrior ? (
              <StatusChip tone="neutral" textClassName="text-xs">
                Prior: {summary.latestPrior.systolic}/{summary.latestPrior.diastolic}
              </StatusChip>
            ) : (
              <StatusChip tone="neutral" textClassName="text-xs">
                No data
              </StatusChip>
            )}
          </View>
          <Text className="text-xs font-medium leading-4 text-muted-foreground">
            {summary.latestPrior
              ? `No reading on ${formatDay(day, DAY.short)}. Most recent: ${summary.latestPrior.systolic}/${summary.latestPrior.diastolic} mmHg on ${formatDay(summary.latestPrior.day, DAY.short)}.`
              : "No blood pressure reading recorded on this day. Record readings in Health Connect to track trends."}
          </Text>
        </View>
      )}

      {/* 30-Day Trend Visualization */}
      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-bold uppercase tracking-[0.08em] text-foreground-secondary">
            30-Day Trend
          </Text>
          <View className="flex-row items-center gap-3">
            <View className="flex-row items-center gap-1">
              <View className="size-2 rounded-full bg-[#f43f5e]" />
              <Text className="text-[10px] font-semibold text-muted-foreground">Systolic</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <View className="size-2 rounded-full bg-[#3b82f6]" />
              <Text className="text-[10px] font-semibold text-muted-foreground">Diastolic</Text>
            </View>
          </View>
        </View>

        <TrendPlot history={summary.history} />
      </View>

      {/* 30-Day Category Distribution (when historical readings exist) */}
      {totalInWindow > 0 && (
        <View className="gap-1.5 rounded-lg bg-secondary/30 p-2.5">
          <Text className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            30-Day Category Breakdown ({totalInWindow} {totalInWindow === 1 ? "reading" : "readings"})
          </Text>
          <View className="flex-row flex-wrap gap-2 pt-1">
            {summary.distribution.normal > 0 && (
              <Text className="text-xs font-medium text-optimal-text">
                {summary.distribution.normal} Normal
              </Text>
            )}
            {summary.distribution.elevated > 0 && (
              <Text className="text-xs font-medium text-warning-text">
                {summary.distribution.elevated} Elevated
              </Text>
            )}
            {summary.distribution.stage1 > 0 && (
              <Text className="text-xs font-medium text-warning-text">
                {summary.distribution.stage1} Stage 1
              </Text>
            )}
            {summary.distribution.stage2 > 0 && (
              <Text className="text-xs font-medium text-alert-text">
                {summary.distribution.stage2} Stage 2
              </Text>
            )}
            {summary.distribution.crisis > 0 && (
              <Text className="text-xs font-medium text-recovery-red-text">
                {summary.distribution.crisis} Crisis
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Day Readings List (if multiple readings on the day) */}
      {summary.readings.length > 1 && (
        <View className="gap-2 border-t border-border pt-3">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Readings on {formatDay(day, DAY.short)}
          </Text>
          <View className="gap-1.5">
            {summary.readings.map((r) => {
              const rChip = CATEGORY_CHIP[r.category];
              return (
                <View key={r.id} className="flex-row items-center justify-between py-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-numeric text-sm font-semibold">{r.time}</Text>
                    <Text className="font-numeric text-base font-bold text-foreground">
                      {r.systolic}/{r.diastolic} <Text className="text-xs font-normal text-muted-foreground">mmHg</Text>
                    </Text>
                  </View>
                  <StatusChip tone={rChip.tone} textClassName="text-[10px]">
                    {rChip.text}
                  </StatusChip>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Educational & Clinical Guideline Section (AHA/ACC) */}
      <View className="gap-2 border-t border-border pt-3">
        <Press
          activeScale={0.98}
          accessibilityRole="button"
          onPress={() => setShowGuidelines((prev) => !prev)}
          className="flex-row items-center justify-between py-1"
        >
          <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            AHA/ACC Classification Guidelines
          </Text>
          <Text className="text-xs font-medium text-foreground-secondary">
            {showGuidelines ? "Hide" : "Show"}
          </Text>
        </Press>

        {showGuidelines && (
          <View className="gap-2 rounded-lg bg-secondary/30 p-3">
            {STAGES.map((s) => (
              <View key={s.cat} className="flex-row items-center justify-between py-1 border-b border-border/50">
                <View className="flex-row items-center gap-2">
                  <View className="size-2 rounded-full" style={{ backgroundColor: CATEGORY_DOT[s.cat] }} />
                  <Text className="text-xs font-semibold">{s.label}</Text>
                </View>
                <Text className="font-numeric text-xs text-muted-foreground">{s.range}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Medical Safety Disclaimer (Mandatory) */}
      <View className="flex-row items-start gap-2.5 rounded-lg border border-border/80 bg-secondary/20 p-3">
        <View className="mt-0.5">
          <Icon icon={Info} size={15} tone="muted-foreground" />
        </View>
        <Text className="flex-1 text-[11px] leading-4 text-muted-foreground">
          Pulse is not a diagnostic device. Consult a physician for diagnosis and medical management of blood pressure.
        </Text>
      </View>
    </Card>
  );
}
