import { useState } from "react";
import { Modal, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Activity, HeartPulse, Plus, Trash2 } from "lucide-react-native";
import { Group, Path } from "@shopify/react-native-skia";
import type {
  BloodPressureAhaCategory,
  BloodPressurePosture,
  BloodPressureReadingRow,
} from "@/data/types";
import type { ChipTone } from "@/lib/bands";
import { clock, DAY, formatDay } from "@/lib/format";
import { dayHref } from "@/lib/url";
import {
  getVascular,
  type VascularDriverContributor,
  type VascularTrendPoint,
  type VascularTrendRange,
  type VascularViewModel,
} from "@/queries/vascular";
import { removeManualBloodPressure, saveManualBloodPressure } from "@/state/app";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ChartFigure, DashedLine, PlotCanvas } from "@/ui/charts/ChartFrame";
import { linearScale, linePath, type Point } from "@/ui/charts/geometry";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { CAPTION, LABEL, StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { Press } from "@/ui/Press";
import { Segmented } from "@/ui/Segmented";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { useDayScreen } from "./day";
import { ErrorView } from "./ErrorView";

const CHART_H = 180;
const PAD_X = 28;
const PAD_Y = 18;

const POSITIONS: readonly BloodPressurePosture[] = ["sitting", "supine", "standing"];

function ahaTone(category: BloodPressureAhaCategory | null): ChipTone {
  switch (category) {
    case "normal":
      return "optimal";
    case "elevated":
    case "stage1_hypertension":
    case "hypotension":
      return "warning";
    case "stage2_hypertension":
    case "hypertensive_crisis":
      return "alert";
    default:
      return "neutral";
  }
}

function ahaI18nKey(
  category: BloodPressureAhaCategory,
):
  | "vascular.aha.normal"
  | "vascular.aha.elevated"
  | "vascular.aha.stage_1"
  | "vascular.aha.stage_2"
  | "vascular.aha.crisis" {
  switch (category) {
    case "normal":
    case "hypotension":
      return "vascular.aha.normal";
    case "elevated":
      return "vascular.aha.elevated";
    case "stage1_hypertension":
      return "vascular.aha.stage_1";
    case "stage2_hypertension":
      return "vascular.aha.stage_2";
    case "hypertensive_crisis":
      return "vascular.aha.crisis";
  }
}

function formatSigned(val: number | null): string {
  if (val == null || !Number.isFinite(val)) return "--";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(1)}`;
}

/** Closed polygon SVG path for a corridor band between `upper` and `lower` points. */
function corridorBandPath(
  upper: readonly { x: number; y: number }[],
  lower: readonly { x: number; y: number }[],
): string {
  if (upper.length < 2 || upper.length !== lower.length) return "";
  const f = (n: number) => +n.toFixed(2);
  let d = `M${f(upper[0].x)},${f(upper[0].y)}`;
  for (let i = 1; i < upper.length; i++) {
    d += `L${f(upper[i].x)},${f(upper[i].y)}`;
  }
  for (let i = lower.length - 1; i >= 0; i--) {
    d += `L${f(lower[i].x)},${f(lower[i].y)}`;
  }
  return `${d}Z`;
}

/** Diamond marker path centered at (cx, cy) with radius `r`. */
function diamondPath(cx: number, cy: number, r = 5): string {
  const f = (n: number) => +n.toFixed(2);
  return `M${f(cx)},${f(cy - r)}L${f(cx + r)},${f(cy)}L${f(cx)},${f(cy + r)}L${f(cx - r)},${f(cy)}Z`;
}

function LongitudinalCorridorChart({
  series,
  calibrated,
}: {
  series: VascularTrendPoint[];
  calibrated: boolean;
}) {
  const { t } = useTranslation("health");
  const { c } = useTheme();

  const hasCalibratedPoints =
    calibrated && series.some((p) => p.sbpValue !== null && p.dbpValue !== null);
  const hasDeltaPoints = series.some((p) => p.sbpDeltaMmHg !== null && p.dbpDeltaMmHg !== null);

  if (!hasCalibratedPoints && !hasDeltaPoints) {
    return (
      <View className="h-36 items-center justify-center rounded-lg bg-secondary/30 px-4">
        <Text className="text-center text-xs font-medium text-muted-foreground">
          {t("bloodPressure.noReadings30d")}
        </Text>
      </View>
    );
  }

  return (
    <ChartFigure summary={t("vascular.trend.title")} height={CHART_H}>
      {({ width, height }) => {
        const plotW = width - PAD_X * 2;
        const stepX = series.length > 1 ? plotW / (series.length - 1) : 0;
        const getX = (i: number) => PAD_X + i * stepX;

        if (hasCalibratedPoints) {
          const sbpUpperVals = series
            .map((p) => p.sbpUpper ?? p.cuffSystolic ?? p.sbpValue)
            .filter((v): v is number => v !== null);
          const dbpLowerVals = series
            .map((p) => p.dbpLower ?? p.cuffDiastolic ?? p.dbpValue)
            .filter((v): v is number => v !== null);

          const minY = Math.min(55, ...(dbpLowerVals.length ? dbpLowerVals : [60])) - 6;
          const maxY = Math.max(150, ...(sbpUpperVals.length ? sbpUpperVals : [140])) + 6;
          const scaleY = linearScale([minY, maxY], [height - PAD_Y, PAD_Y]);

          const sbpRunUpper: { x: number; y: number }[] = [];
          const sbpRunLower: { x: number; y: number }[] = [];
          const dbpRunUpper: { x: number; y: number }[] = [];
          const dbpRunLower: { x: number; y: number }[] = [];
          const sbpLine: Point[] = [];
          const dbpLine: Point[] = [];

          series.forEach((p, i) => {
            const x = getX(i);
            sbpLine.push({ x, y: p.sbpValue !== null ? scaleY(p.sbpValue) : null });
            dbpLine.push({ x, y: p.dbpValue !== null ? scaleY(p.dbpValue) : null });
            if (p.sbpUpper !== null && p.sbpLower !== null) {
              sbpRunUpper.push({ x, y: scaleY(p.sbpUpper) });
              sbpRunLower.push({ x, y: scaleY(p.sbpLower) });
            }
            if (p.dbpUpper !== null && p.dbpLower !== null) {
              dbpRunUpper.push({ x, y: scaleY(p.dbpUpper) });
              dbpRunLower.push({ x, y: scaleY(p.dbpLower) });
            }
          });

          const sbpBandD = corridorBandPath(sbpRunUpper, sbpRunLower);
          const dbpBandD = corridorBandPath(dbpRunUpper, dbpRunLower);
          const sbpD = linePath(sbpLine, "monotone");
          const dbpD = linePath(dbpLine, "monotone");
          const y120 = scaleY(120);
          const y80 = scaleY(80);
          const refLabel120 = "120";
          const refLabel80 = "80";

          return (
            <View style={{ width, height }}>
              <PlotCanvas width={width} height={height}>
                <DashedLine
                  x1={PAD_X}
                  x2={width - PAD_X}
                  y1={y120}
                  y2={y120}
                  color={c.border}
                  dash={[3, 3]}
                />
                <DashedLine
                  x1={PAD_X}
                  x2={width - PAD_X}
                  y1={y80}
                  y2={y80}
                  color={c.border}
                  dash={[3, 3]}
                />
                {!!sbpBandD && <Path path={sbpBandD} color={c.strain} opacity={0.18} />}
                {!!dbpBandD && <Path path={dbpBandD} color={c.sleep} opacity={0.18} />}
                {!!sbpD && (
                  <Path
                    path={sbpD}
                    color={c.strain}
                    style="stroke"
                    strokeWidth={2}
                    strokeCap="round"
                  />
                )}
                {!!dbpD && (
                  <Path
                    path={dbpD}
                    color={c.sleep}
                    style="stroke"
                    strokeWidth={2}
                    strokeCap="round"
                  />
                )}
                {series.map((p, i) => {
                  if (p.cuffSystolic === null || p.cuffDiastolic === null) return null;
                  const x = getX(i);
                  return (
                    <Group key={p.date}>
                      <Path
                        path={diamondPath(x, scaleY(p.cuffSystolic), 5)}
                        color={c.optimal}
                      />
                      <Path
                        path={diamondPath(x, scaleY(p.cuffDiastolic), 5)}
                        color={c.optimal}
                      />
                    </Group>
                  );
                })}
              </PlotCanvas>
              <Text
                style={{ position: "absolute", left: 4, top: y120 - 7 }}
                className="font-numeric text-[10px] text-muted-foreground"
              >
                {refLabel120}
              </Text>
              <Text
                style={{ position: "absolute", left: 4, top: y80 - 7 }}
                className="font-numeric text-[10px] text-muted-foreground"
              >
                {refLabel80}
              </Text>
            </View>
          );
        }

        const deltas = series
          .flatMap((p) => [p.sbpDeltaMmHg, p.dbpDeltaMmHg])
          .filter((v): v is number => v !== null);
        const bound = Math.max(8, ...deltas.map((v) => Math.abs(v))) + 2;
        const scaleY = linearScale([-bound, bound], [height - PAD_Y, PAD_Y]);
        const yZero = scaleY(0);

        const sbpDeltaPts: Point[] = series.map((p, i) => ({
          x: getX(i),
          y: p.sbpDeltaMmHg !== null ? scaleY(p.sbpDeltaMmHg) : null,
        }));
        const dbpDeltaPts: Point[] = series.map((p, i) => ({
          x: getX(i),
          y: p.dbpDeltaMmHg !== null ? scaleY(p.dbpDeltaMmHg) : null,
        }));
        const sbpDeltaD = linePath(sbpDeltaPts, "monotone");
        const dbpDeltaD = linePath(dbpDeltaPts, "monotone");
        const zeroLabel = "0";

        return (
          <View style={{ width, height }}>
            <PlotCanvas width={width} height={height}>
              <DashedLine
                x1={PAD_X}
                x2={width - PAD_X}
                y1={yZero}
                y2={yZero}
                color={c.border}
                dash={[3, 3]}
              />
              {!!sbpDeltaD && (
                <Path
                  path={sbpDeltaD}
                  color={c.strain}
                  style="stroke"
                  strokeWidth={2}
                  strokeCap="round"
                />
              )}
              {!!dbpDeltaD && (
                <Path
                  path={dbpDeltaD}
                  color={c.sleep}
                  style="stroke"
                  strokeWidth={2}
                  strokeCap="round"
                />
              )}
            </PlotCanvas>
            <Text
              style={{ position: "absolute", left: 6, top: yZero - 7 }}
              className="font-numeric text-[10px] text-muted-foreground"
            >
              {zeroLabel}
            </Text>
          </View>
        );
      }}
    </ChartFigure>
  );
}

function DriverRow({ item }: { item: VascularDriverContributor }) {
  const { t } = useTranslation("health");

  const labelKey:
    | "vascular.drivers.rhr"
    | "vascular.drivers.hrv"
    | "vascular.drivers.sleepDebt"
    | "vascular.drivers.acwr"
    | "vascular.drivers.bmi" =
    item.key === "rhr"
      ? "vascular.drivers.rhr"
      : item.key === "hrv"
        ? "vascular.drivers.hrv"
        : item.key === "sleepDebt"
          ? "vascular.drivers.sleepDebt"
          : item.key === "acwr"
            ? "vascular.drivers.acwr"
            : "vascular.drivers.bmi";

  const dirKey:
    | "vascular.drivers.raising"
    | "vascular.drivers.lowering"
    | "vascular.drivers.neutral" =
    item.direction === "raising"
      ? "vascular.drivers.raising"
      : item.direction === "lowering"
        ? "vascular.drivers.lowering"
        : "vascular.drivers.neutral";

  const tone: ChipTone =
    item.direction === "raising"
      ? "warning"
      : item.direction === "lowering"
        ? "optimal"
        : "neutral";

  const rawText =
    item.rawDelta == null
      ? "--"
      : item.key === "rhr"
        ? `${formatSigned(item.rawDelta)} bpm`
        : item.key === "hrv"
          ? `${formatSigned(item.rawDelta)} ln`
          : item.key === "sleepDebt"
            ? `${item.rawDelta.toFixed(1)} h`
            : item.key === "acwr"
              ? `${item.rawDelta.toFixed(2)}x`
              : `${item.rawDelta.toFixed(1)}`;

  const effectText =
    item.sbpEffectMmHg != null && item.dbpEffectMmHg != null
      ? `${formatSigned(item.sbpEffectMmHg)} / ${formatSigned(item.dbpEffectMmHg)} ${t("vascular.mmHgUnit")}`
      : rawText;

  const pct =
    item.sbpEffectMmHg != null
      ? Math.min(100, Math.max(8, Math.round((Math.abs(item.sbpEffectMmHg) / 6) * 100)))
      : 12;

  return (
    <View className="gap-1.5 border-b border-border/40 pb-3 last:border-b-0 last:pb-0">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">{t(labelKey)}</Text>
          <Text className={CAPTION}>{rawText}</Text>
        </View>
        <View className="items-end gap-1">
          <Text className="font-numeric text-xs font-bold tabular-nums text-foreground">
            {effectText}
          </Text>
          <StatusChip tone={tone}>{t(dirKey)}</StatusChip>
        </View>
      </View>
      <View className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <View
          style={{ width: `${pct}%` }}
          className={cn(
            "h-full rounded-full",
            item.direction === "raising"
              ? "bg-strain"
              : item.direction === "lowering"
                ? "bg-optimal"
                : "bg-muted-foreground/40",
          )}
        />
      </View>
    </View>
  );
}

function CuffHistoryRow({
  reading,
  timeZone,
  onDelete,
}: {
  reading: BloodPressureReadingRow;
  timeZone: string;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation("health");
  const bpText = `${reading.systolicMmHg}/${reading.diastolicMmHg}`;
  const dateStr = formatDay(reading.date, DAY.monthDay);
  const timeStr = clock(reading.timestampMs, timeZone);
  const metaText = t("bloodPressure.readingMeta", { date: dateStr, time: timeStr });
  const sourceLabel =
    reading.source === "manual"
      ? t("vascular.sheet.sourceManual")
      : t("vascular.sheet.sourceHealthConnect");

  return (
    <View className="flex-row items-center justify-between border-b border-border/40 py-2.5 last:border-b-0">
      <View className="gap-0.5">
        <View className="flex-row items-baseline gap-2">
          <ValueUnit
            value={bpText}
            unit={t("vascular.mmHgUnit")}
            className="font-numeric text-base font-bold text-foreground"
          />
          {reading.pulseBpm != null ? (
            <ValueUnit
              value={`${reading.pulseBpm}`}
              unit="bpm"
              className="font-numeric text-xs font-semibold text-muted-foreground"
            />
          ) : null}
        </View>
        <Text className={CAPTION}>{metaText}</Text>
      </View>

      <View className="flex-row items-center gap-2">
        <StatusChip tone={reading.source === "manual" ? "optimal" : "neutral"}>
          {sourceLabel}
        </StatusChip>
        {reading.source === "manual" ? (
          <Press
            onPress={() => onDelete(reading.id)}
            accessibilityRole="button"
            accessibilityLabel={t("vascular.sheet.deleteAction")}
            className="rounded-lg p-1.5"
          >
            <Icon icon={Trash2} size={15} tone="muted-foreground" />
          </Press>
        ) : null}
      </View>
    </View>
  );
}

function CalibrationSheetModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("health");
  const { c } = useTheme();
  const [sysText, setSysText] = useState("118");
  const [diaText, setDiaText] = useState("76");
  const [pulseText, setPulseText] = useState("");
  const [posture, setPosture] = useState<BloodPressurePosture>("sitting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const sys = Number(sysText);
    const dia = Number(diaText);
    const pulse = pulseText.trim() ? Number(pulseText) : null;

    if (
      !Number.isFinite(sys) ||
      !Number.isFinite(dia) ||
      sys < 60 ||
      sys > 260 ||
      dia < 30 ||
      dia > 160 ||
      sys <= dia
    ) {
      setErrorMsg(t("vascular.sheet.errorRange"));
      return;
    }

    setErrorMsg(null);
    setSaving(true);
    try {
      await saveManualBloodPressure({
        systolicMmHg: sys,
        diastolicMmHg: dia,
        pulseBpm: pulse,
        posture,
      });
      onClose();
    } catch {
      setErrorMsg(t("vascular.sheet.errorRange"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className=" gap-4 rounded-t-3xl border-t border-border bg-card p-5 pb-8">
          <View className="gap-1">
            <Text className="text-lg font-bold text-foreground">{t("vascular.sheet.title")}</Text>
            <Text className={CAPTION}>{t("vascular.sheet.subtitle")}</Text>
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1 gap-1">
              <Text className={LABEL}>{t("vascular.sheet.systolicField")}</Text>
              <TextInput
                value={sysText}
                onChangeText={setSysText}
                keyboardType="number-pad"
                placeholder="120"
                placeholderTextColor={c["muted-foreground"]}
                className="h-11 rounded-xl border border-border bg-background px-3 font-numeric text-base font-bold text-foreground"
              />
            </View>
            <View className="flex-1 gap-1">
              <Text className={LABEL}>{t("vascular.sheet.diastolicField")}</Text>
              <TextInput
                value={diaText}
                onChangeText={setDiaText}
                keyboardType="number-pad"
                placeholder="80"
                placeholderTextColor={c["muted-foreground"]}
                className="h-11 rounded-xl border border-border bg-background px-3 font-numeric text-base font-bold text-foreground"
              />
            </View>
            <View className="flex-1 gap-1">
              <Text className={LABEL}>{t("vascular.sheet.pulseField")}</Text>
              <TextInput
                value={pulseText}
                onChangeText={setPulseText}
                keyboardType="number-pad"
                placeholder="62"
                placeholderTextColor={c["muted-foreground"]}
                className="h-11 rounded-xl border border-border bg-background px-3 font-numeric text-base font-bold text-foreground"
              />
            </View>
          </View>

          <View className="gap-1.5">
            <Text className={LABEL}>{t("vascular.sheet.positionField")}</Text>
            <Segmented
              value={posture}
              onChange={setPosture}
              fill
              label={t("vascular.sheet.positionField")}
              options={POSITIONS.map((p) => ({
                value: p,
                label: t(
                  p === "sitting"
                    ? "vascular.sheet.positions.sitting"
                    : p === "supine"
                      ? "vascular.sheet.positions.supine"
                      : "vascular.sheet.positions.standing",
                ),
              }))}
            />
          </View>

          {errorMsg ? (
            <Text className="text-xs font-semibold text-alert-text">{errorMsg}</Text>
          ) : null}

          <View className="mt-1 flex-row gap-3">
            <Button variant="outline" onPress={onClose} className="flex-1">
              {t("vascular.sheet.cancel")}
            </Button>
            <Button
              variant="default"
              onPress={() => void handleSave()}
              disabled={saving}
              className="flex-1"
            >
              {saving ? t("vascular.sheet.saving") : t("vascular.sheet.save")}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function VascularBody({
  vm,
  d,
  today,
  timeZone,
  initialCalibrate,
}: {
  vm: VascularViewModel;
  d: string;
  today: string;
  timeZone: string;
  initialCalibrate?: boolean;
}) {
  const { t } = useTranslation("health");
  const [range, setRange] = useState<VascularTrendRange>("30d");
  const [sheetOpen, setSheetOpen] = useState(!!initialCalibrate);

  const isCalibrated =
    vm.mode === "calibrated" && vm.systolic.value !== null && vm.diastolic.value !== null;

  const calStatus = vm.calibration.status;
  const calTone: ChipTone =
    calStatus === "fresh" ? "optimal" : calStatus === "aging" ? "warning" : "neutral";

  const calLabel =
    calStatus === "fresh"
      ? t("vascular.calibrationStatus.fresh", {
          days: vm.calibration.daysSinceCalibration ?? 0,
          halfWidth: vm.calibration.halfWidthMmHg ?? 4,
        })
      : calStatus === "aging"
        ? t("vascular.calibrationStatus.aging", {
            days: vm.calibration.daysSinceCalibration ?? 15,
            halfWidth: vm.calibration.halfWidthMmHg ?? 6,
          })
        : calStatus === "expired"
          ? t("vascular.calibrationStatus.stale")
          : t("vascular.calibrationStatus.uncalibrated");

  const series =
    range === "7d" ? vm.series7d : range === "30d" ? vm.series30d : vm.series90d;

  const deltaSbp = vm.autonomicDelta.sbpDeltaMmHg;
  const deltaDbp = vm.autonomicDelta.dbpDeltaMmHg;
  const hasDelta = deltaSbp !== null && deltaDbp !== null;
  const deltaDisplay = hasDelta
    ? `${formatSigned(deltaSbp)} / ${formatSigned(deltaDbp)}`
    : "-- / --";

  const primaryReading = `${vm.systolic.value}/${vm.diastolic.value}`;
  const sbpBandText = `${vm.systolic.lower}–${vm.systolic.upper} ${t("vascular.mmHgUnit")}`;
  const dbpBandText = `${vm.diastolic.lower}–${vm.diastolic.upper} ${t("vascular.mmHgUnit")}`;
  const ppValueText = vm.pulsePressure.value !== null ? `${vm.pulsePressure.value}` : "--";
  const mapValueText =
    vm.meanArterialPressure.value !== null ? `${vm.meanArterialPressure.value}` : "--";

  const handleDeleteCuff = async (id: string) => {
    await removeManualBloodPressure(id);
  };

  return (
    <>
      <DetailShell
        title={t("vascular.detailTitle")}
        backHref={dayHref("/health/monitor", d, today)}
        dateSwitcher={{ mode: "day" }}
        primary={
          <Card className="gap-4 p-4">
            <View className="flex-row items-center justify-between gap-2">
              <View className="flex-row items-center gap-2">
                <Icon icon={HeartPulse} size={18} tone="optimal" />
                <Text className={LABEL}>
                  {isCalibrated ? t("vascular.corridorLabel") : t("vascular.uncalibratedTitle")}
                </Text>
              </View>
              {isCalibrated && vm.ahaCategory ? (
                <StatusChip tone={ahaTone(vm.ahaCategory)}>
                  {t(ahaI18nKey(vm.ahaCategory))}
                </StatusChip>
              ) : (
                <StatusChip tone={calTone}>{calLabel}</StatusChip>
              )}
            </View>

            {isCalibrated ? (
              <View className="gap-4">
                <View className="flex-row items-baseline justify-between">
                  <ValueUnit
                    value={primaryReading}
                    unit={t("vascular.mmHgUnit")}
                    className="font-numeric text-4xl font-bold leading-none text-foreground"
                  />
                  <StatusChip tone={calTone}>{calLabel}</StatusChip>
                </View>

                <View className="flex-row gap-3">
                  <View className="flex-1 rounded-xl bg-secondary/40 p-3">
                    <Text className={CAPTION}>{t("vascular.systolicLabel")}</Text>
                    <Text className="mt-1 font-numeric text-base font-bold tabular-nums text-foreground">
                      {sbpBandText}
                    </Text>
                  </View>
                  <View className="flex-1 rounded-xl bg-secondary/40 p-3">
                    <Text className={CAPTION}>{t("vascular.diastolicLabel")}</Text>
                    <Text className="mt-1 font-numeric text-base font-bold tabular-nums text-foreground">
                      {dbpBandText}
                    </Text>
                  </View>
                </View>

                <View className="flex-row gap-3">
                  <View className="flex-1 rounded-xl bg-secondary/40 p-3">
                    <Text className={CAPTION}>{t("vascular.pulsePressureLabel")}</Text>
                    <ValueUnit
                      value={ppValueText}
                      unit={t("vascular.mmHgUnit")}
                      className="mt-1 font-numeric text-lg font-bold text-foreground"
                    />
                  </View>
                  <View className="flex-1 rounded-xl bg-secondary/40 p-3">
                    <Text className={CAPTION}>{t("vascular.mapLabel")}</Text>
                    <ValueUnit
                      value={mapValueText}
                      unit={t("vascular.mmHgUnit")}
                      className="mt-1 font-numeric text-lg font-bold text-foreground"
                    />
                  </View>
                </View>

                <View className="flex-row items-center justify-between rounded-xl bg-secondary/40 p-3">
                  <View>
                    <Text className="text-xs font-semibold text-foreground">
                      {t("vascular.autonomicShiftLabel")}
                    </Text>
                    <Text className={CAPTION}>{t("vascular.autonomicShiftSub")}</Text>
                  </View>
                  <ValueUnit
                    value={deltaDisplay}
                    unit={t("vascular.mmHgUnit")}
                    className="font-numeric text-base font-bold text-foreground"
                  />
                </View>
              </View>
            ) : (
              <View className="gap-3">
                <View className="flex-row items-baseline justify-between">
                  <ValueUnit
                    value={deltaDisplay}
                    unit={`Δ ${t("vascular.mmHgUnit")}`}
                    className="font-numeric text-3xl font-bold leading-none text-foreground"
                  />
                  <Text className={CAPTION}>{t("vascular.autonomicShiftSub")}</Text>
                </View>
                <Text className={CAPTION}>
                  {vm.systolic.reasonText ?? t("vascular.uncalibratedSubtitle")}
                </Text>
              </View>
            )}

            <Button variant="default" onPress={() => setSheetOpen(true)}>
              <View className="flex-row items-center gap-2">
                <Icon icon={Plus} size={16} tone="primary-foreground" />
                <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-primary-foreground">
                  {isCalibrated ? t("vascular.recalibrateCta") : t("vascular.calibrateCta")}
                </Text>
              </View>
            </Button>
          </Card>
        }
        secondary={[
          <SectionShell key="trend" variant="section" title={t("vascular.trend.title")}>
            <Card className="gap-3 p-4">
              <Text className={CAPTION}>
                {isCalibrated
                  ? t("vascular.trend.subtitleCalibrated")
                  : t("vascular.trend.subtitleUncalibrated")}
              </Text>
              <Segmented
                value={range}
                onChange={setRange}
                fill
                label={t("vascular.trend.title")}
                options={[
                  { value: "7d", label: t("vascular.trend.range7d") },
                  { value: "30d", label: t("vascular.trend.range30d") },
                  { value: "90d", label: t("vascular.trend.range90d") },
                ]}
              />
              <LongitudinalCorridorChart series={series} calibrated={isCalibrated} />
              <View className="flex-row flex-wrap items-center justify-center gap-4 pt-1">
                <View className="flex-row items-center gap-1.5">
                  <View className="size-2.5 rounded-full bg-strain" />
                  <Text className={CAPTION}>{t("vascular.systolicShort")}</Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <View className="size-2.5 rounded-full bg-sleep" />
                  <Text className={CAPTION}>{t("vascular.diastolicShort")}</Text>
                </View>
                {isCalibrated ? (
                  <View className="flex-row items-center gap-1.5">
                    <View className="size-2.5 rotate-45 bg-optimal" />
                    <Text className={CAPTION}>{t("vascular.trend.legendCuff")}</Text>
                  </View>
                ) : null}
              </View>
            </Card>
          </SectionShell>,

          <SectionShell key="drivers" variant="section" title={t("vascular.drivers.title")}>
            <Card className="gap-3 p-4">
              <Text className={CAPTION}>{t("vascular.drivers.subtitle")}</Text>
              {vm.contributors.map((item) => (
                <DriverRow key={item.key} item={item} />
              ))}
            </Card>
          </SectionShell>,

          <SectionShell key="history" variant="section" title={t("vascular.sheet.historyTitle")}>
            <Card className="p-4">
              {vm.cuffHistory.length === 0 ? (
                <View className="items-center gap-2 py-4">
                  <Icon icon={Activity} size={20} tone="muted-foreground" />
                  <Text className={CAPTION}>{t("vascular.sheet.historyEmpty")}</Text>
                </View>
              ) : (
                vm.cuffHistory.map((r) => (
                  <CuffHistoryRow
                    key={r.id}
                    reading={r}
                    timeZone={timeZone}
                    onDelete={(id) => void handleDeleteCuff(id)}
                  />
                ))
              )}
            </Card>
          </SectionShell>,
        ]}
        footer={
          <Text className="px-2 text-center text-xs leading-4 text-muted-foreground">
            {t("vascular.disclaimer")}
          </Text>
        }
      />

      <CalibrationSheetModal visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}

function VascularSkeleton() {
  const { t } = useTranslation("health");
  return (
    <DetailShell
      title={t("vascular.detailTitle")}
      backHref="/health/monitor"
      loading
      primary={
        <Card className="gap-3 p-4">
          <SkeletonText className="h-3 w-40" />
          <Skeleton className="h-10 w-36 rounded-lg" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </Card>
      }
      secondary={[
        <Card key="sk-trend" className="gap-3 p-4">
          <SkeletonText className="h-3 w-36" />
          <Skeleton className="h-44 w-full rounded-xl" />
        </Card>,
      ]}
    />
  );
}

export function VascularDetailScreen() {
  const { calibrate } = useLocalSearchParams<{ calibrate?: string }>();
  const { data, error, reload } = useDayScreen("vascular", (d, ctx) => getVascular(d, ctx));
  if (!data) return error ? <ErrorView detail retry={reload} /> : <VascularSkeleton />;
  const { vm, d, today, timeZone } = data;
  return (
    <VascularBody
      vm={vm}
      d={d}
      today={today}
      timeZone={timeZone}
      initialCalibrate={calibrate === "1"}
    />
  );
}
