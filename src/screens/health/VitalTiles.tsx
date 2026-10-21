// Health Monitor's five vital tiles with their note. Ported from pulse src/app/(app)/health/monitor/VitalTiles.tsx.
import type { ReactNode } from "react";
import { View } from "react-native";
import { Activity, Droplet, Heart, Thermometer, Wind, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { metricLabel } from "@/lib/metricLabels";
import type { FormatKey } from "@/lib/format";
import type { Vital, VitalKey } from "@/queries/types";
import { Icon } from "@/ui/Icon";
import { KeyStatRow, KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow";
import { Text } from "@/ui/Text";
import { vitalHref } from "./vitals";

const GLYPH: Record<VitalKey, LucideIcon> = { resp: Wind, spo2: Droplet, restingHr: Heart, hrv: Activity, skinTempDev: Thermometer };
// A tile's icon: 20 px, stroke 1.5, muted (the web's `[&_svg]:stroke-[1.5]`).
const ICON = (k: VitalKey): ReactNode => <Icon icon={GLYPH[k]} size={20} tone="muted-foreground" strokeWidth={1.5} />;
const FORMAT: Record<VitalKey, FormatKey> = { resp: "decimal1", spo2: "int", restingHr: "int", hrv: "int", skinTempDev: "signed1" };

/** Rows of two tiles (four vitals since SpO2 left: no wide last tile). */
function Grid({ tiles }: { tiles: ReactNode[] }) {
  const rows: ReactNode[][] = [];
  for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));
  return (
    <View className="gap-3">
      {rows.map((row, i) => (
        <View key={i} className="flex-row gap-3">
          {row.map((tile, j) => (
            <View key={j} className="min-w-0 flex-1">
              {tile}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function VitalTiles({ vitals, day, today }: { vitals: Vital[]; day: string; today: string }) {
  const { t } = useTranslation("health");
  return (
    <>
      <Grid
        tiles={vitals.map((x) => (
          <KeyStatRow
            key={x.key}
            variant="tile"
            icon={ICON(x.key)}
            label={x.key === "restingHr" || x.key === "hrv" ? x.short : x.label}
            metric={x.metric}
            unit={x.unit}
            format={FORMAT[x.key]}
            direction="none"
            chip={x.chip ?? undefined}
            href={vitalHref(x.key, day, today)}
          />
        ))}
      />
      <Text className="mt-3 text-xs font-medium leading-4 text-muted-foreground">{t("vitals.note")}</Text>
    </>
  );
}

const skeletonLabel = (): [VitalKey, string][] => [
  ["resp", metricLabel("resp")],
  ["restingHr", "RHR"],
  ["hrv", "HRV"],
  ["skinTempDev", metricLabel("skin")],
];

export function VitalTilesSkeleton() {
  const { t } = useTranslation("health");
  return (
    <>
      <Grid tiles={skeletonLabel().map(([k, l]) => <KeyStatRowSkeleton key={k} variant="tile" label={l} icon={ICON(k)} />)} />
      <Text className="mt-3 text-xs font-medium leading-4 text-muted-foreground">{t("vitals.note")}</Text>
    </>
  );
}
