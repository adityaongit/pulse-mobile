import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronRight, HeartPulse, Plus } from "lucide-react-native";
import type { BloodPressureAhaCategory } from "@/data/types";
import type { ChipTone } from "@/lib/bands";
import type { VascularCorridorRow } from "@/pipeline/types";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import { CAPTION, LABEL, StatusChip, ValueUnit } from "@/ui/metrics/primitives";
import { push } from "@/ui/navigate";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";

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

export function VascularCard({
  corridor,
  day,
}: {
  corridor: VascularCorridorRow | null | undefined;
  day?: string;
}) {
  const { t } = useTranslation("health");

  if (!corridor) return null;

  const isCalibrated =
    corridor.mode === "calibrated" &&
    corridor.systolic.value != null &&
    corridor.diastolic.value != null;

  const calStatus = corridor.calibration.status;
  const calTone: ChipTone =
    calStatus === "fresh" ? "optimal" : calStatus === "aging" ? "warning" : "neutral";

  const calLabel =
    calStatus === "fresh"
      ? t("vascular.calibrationStatus.fresh", {
          days: corridor.calibration.daysSinceCalibration ?? 0,
          halfWidth: corridor.calibration.halfWidthMmHg ?? 4,
        })
      : calStatus === "aging"
        ? t("vascular.calibrationStatus.aging", {
            days: corridor.calibration.daysSinceCalibration ?? 15,
            halfWidth: corridor.calibration.halfWidthMmHg ?? 6,
          })
        : calStatus === "expired"
          ? t("vascular.calibrationStatus.stale")
          : t("vascular.calibrationStatus.uncalibrated");

  const deltaSbp = corridor.autonomicDelta.sbpDeltaMmHg;
  const deltaDbp = corridor.autonomicDelta.dbpDeltaMmHg;
  const hasDelta = deltaSbp != null && deltaDbp != null;

  const primaryReading = `${corridor.systolic.value}/${corridor.diastolic.value}`;
  const corridorRangeText = `${t("vascular.systolicShort")} ${corridor.systolic.lower}–${corridor.systolic.upper} · ${t("vascular.diastolicShort")} ${corridor.diastolic.lower}–${corridor.diastolic.upper}`;
  const ppBadge = corridor.pulsePressure.value != null ? `PP ${corridor.pulsePressure.value}` : null;
  const mapBadge =
    corridor.meanArterialPressure.value != null ? `MAP ${corridor.meanArterialPressure.value}` : null;
  const deltaBadge = hasDelta ? `Δ ${formatSigned(deltaSbp)}/${formatSigned(deltaDbp)}` : null;
  const uncalibratedDeltaText = hasDelta
    ? `${formatSigned(deltaSbp)} / ${formatSigned(deltaDbp)}`
    : "-- / --";
  const detailHref = day ? `/health/vascular?d=${day}` : "/health/vascular";
  const calibrateHref = day ? `/health/vascular?d=${day}&calibrate=1` : "/health/vascular?calibrate=1";

  return (
    <Card className="p-4">
      <Press
        onPress={() => push(detailHref)}
        accessibilityRole="button"
        accessibilityLabel={t("vascular.detailTitle")}
        className="gap-2.5"
      >
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-2">
            <Icon icon={HeartPulse} size={18} tone="optimal" />
            <Text className={`${LABEL} text-foreground`}>
              {isCalibrated ? t("vascular.title") : t("vascular.uncalibratedTitle")}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            {isCalibrated && corridor.ahaCategory ? (
              <StatusChip tone={ahaTone(corridor.ahaCategory)}>
                {t(ahaI18nKey(corridor.ahaCategory))}
              </StatusChip>
            ) : (
              <StatusChip tone={calTone}>{calLabel}</StatusChip>
            )}
            <Icon icon={ChevronRight} size={16} tone="muted-foreground" />
          </View>
        </View>

        {isCalibrated ? (
          <View className="gap-2">
            <View className="flex-row items-baseline justify-between gap-2">
              <ValueUnit
                value={primaryReading}
                unit={t("vascular.mmHgUnit")}
                className="font-numeric text-2xl font-bold leading-none text-foreground"
              />
              <Text className="font-numeric text-xs font-semibold tabular-nums text-muted-foreground">
                {corridorRangeText}
              </Text>
            </View>

            <View className="flex-row flex-wrap items-center justify-between gap-2 pt-0.5">
              <Text className={CAPTION}>{calLabel}</Text>
              <View className="flex-row items-center gap-3">
                {ppBadge ? (
                  <Text className="font-numeric text-xs font-semibold tabular-nums text-muted-foreground">
                    {ppBadge}
                  </Text>
                ) : null}
                {mapBadge ? (
                  <Text className="font-numeric text-xs font-semibold tabular-nums text-muted-foreground">
                    {mapBadge}
                  </Text>
                ) : null}
                {deltaBadge ? (
                  <Text className="font-numeric text-xs font-bold tabular-nums text-foreground">
                    {deltaBadge}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : (
          <View className="gap-2">
            <View className="flex-row items-baseline justify-between gap-2">
              <ValueUnit
                value={uncalibratedDeltaText}
                unit={`Δ ${t("vascular.mmHgUnit")}`}
                className="font-numeric text-xl font-bold leading-none text-foreground"
              />
              <Text className={CAPTION}>{t("vascular.autonomicShiftSub")}</Text>
            </View>

            <Text className={CAPTION}>{t("vascular.uncalibratedSubtitle")}</Text>
          </View>
        )}
      </Press>

      {!isCalibrated ? (
        <Press
          onPress={() => push(calibrateHref)}
          accessibilityRole="button"
          accessibilityLabel={t("vascular.calibrateCta")}
          className="mt-3 flex-row items-center justify-center gap-1.5 rounded-lg bg-optimal-bg px-3 py-2"
        >
          <Icon icon={Plus} size={14} tone="optimal-text" />
          <Text className="text-xs font-bold text-optimal-text">{t("vascular.calibrateCta")}</Text>
        </Press>
      ) : null}
    </Card>
  );
}
