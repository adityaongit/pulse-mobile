// HRV Status (version 19), from halo src/screens/health/HrvStatusCard.tsx (its fields and copy) drawn with Pulse's kit:
// the 7-day average of overnight HRV against your usual range, and the last 4 weeks' nights as bars against that range
// in one Skia canvas. On Health and on Recovery; it loads its own query, so neither page's query changes.
import type { ReactNode } from "react";
import { View } from "react-native";
import { RoundedRect } from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { formatValue } from "@/lib/format";
import { todayOf } from "@/queries/common";
import { getHrvStatus, type HrvStatusVM } from "@/queries/training";
import { ChartFigure, PlotCanvas } from "@/ui/charts/ChartFrame";
import { alpha } from "@/ui/color";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { Divided } from "@/ui/Divided";
import { MetricState } from "@/ui/shells/MetricState";
import { SectionShell } from "@/ui/shells/SectionShell";
import type { InfoContent } from "@/ui/shells/InfoButton";
import { Skeleton } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { Hero, LINE, SOURCE_NOTE, StatRow } from "../strain/TrainingCards";
import { useScreen } from "../useScreen";

function P({ children }: { children: ReactNode }) {
  return <Text className="text-[15px] leading-[22px] text-foreground-body">{children}</Text>;
}

// Getters: the card's text resolves when it opens, in the language then in use.
export const HRV_STATUS_INFO: InfoContent = {
  get title() {
    return i18n.t("health:hrv.infoTitle");
  },
  get body() {
    return (
      <>
        <P>{i18n.t("health:hrv.info1")}</P>
        <P>{i18n.t("health:hrv.info2")}</P>
        <P>{i18n.t("health:hrv.info3")}</P>
        {SOURCE_NOTE}
      </>
    );
  },
};

const H = 72;
const TONE_COLOR = { optimal: "optimal", warning: "warning", alert: "recovery-red", neutral: "foreground-secondary" } as const;

/** The last 28 nights as bars against the usual range (a soft band) and the Low line; the last 7 in the status colour. */
function Nights({ vm }: { vm: HrvStatusVM }) {
  const { t } = useTranslation("health");
  const { c } = useTheme();
  const values = vm.nights.flatMap((p) => (p.v == null ? [] : [p.v]));
  const lo = Math.min(vm.lowLine, ...values) * 0.9;
  const hi = Math.max(vm.band.high, ...values) * 1.05;
  const y = (v: number) => H - ((v - lo) / Math.max(1e-6, hi - lo)) * H;
  const ink = c[TONE_COLOR[vm.tone]];
  return (
    <ChartFigure summary={t("hrv.nights", { low: Math.round(vm.band.low), high: Math.round(vm.band.high) })} height={H}>
      {({ width }) => {
        const n = vm.nights.length;
        const step = width / Math.max(1, n);
        const bw = Math.max(2, step - 3);
        return (
          <PlotCanvas width={width} height={H}>
            <RoundedRect x={0} y={y(vm.band.high)} width={width} height={Math.max(2, y(vm.band.low) - y(vm.band.high))} r={6} color={alpha(c.optimal, 0.16)} />
            <RoundedRect x={0} y={y(vm.lowLine)} width={width} height={1} r={0} color={c["chart-grid"]} />
            {vm.nights.map((p, i) =>
              p.v == null ? null : <RoundedRect key={i} x={i * step + (step - bw) / 2} y={Math.min(H - 3, y(p.v))} width={bw} height={Math.max(3, H - y(p.v))} r={2} color={i >= n - 7 ? ink : alpha(c.foreground, 0.22)} />,
            )}
          </PlotCanvas>
        );
      }}
    </ChartFigure>
  );
}

const skeleton = <Skeleton className="h-48 w-full rounded-lg" />;

/** HRV Status for day `d` (none: today). */
export function HrvStatusCard({ d }: { d?: string }) {
  const { t } = useTranslation("health");
  const m = useScreen((ctx) => getHrvStatus(d ?? todayOf(ctx), ctx), ["hrv-status", d ?? null]).data;
  return (
    <SectionShell variant="card" title={t("title.hrvStatus")} info={HRV_STATUS_INFO}>
      <MetricState
        metric={m}
        skeleton={skeleton}
        renderReason={(r, meta) => <ReasonPlaceholder reason={r} nightsLeft={meta.nightsLeft} size="md" copy={r === "calibrating" ? t("hrv.calibrating") : undefined} />}
      >
        {(v) => (
          <View className="gap-3">
            <View className="gap-3">
              <Hero
                value={formatValue("int", v.weekAverage)}
                unit="ms"
                band={v.status}
                caption={t("hrv.avg7")}
                spoken={t("hrv.spoken", { status: v.status, avg: Math.round(v.weekAverage) })}
              />
              <Text className={LINE}>{v.line}</Text>
            </View>
            <Divided>
              <StatRow label={t("hrv.lastNight")} value={formatValue("int", v.lastNight)} unit="ms" spoken={v.lastNight == null ? t("hrv.noHrv") : t("hrv.lastNightAria", { value: Math.round(v.lastNight) })} />
              <StatRow
                label={t("hrv.usualRange")}
                value={`${formatValue("int", v.band.low)}–${formatValue("int", v.band.high)}`}
                unit="ms"
                spoken={t("hrv.usualRangeAria", { low: Math.round(v.band.low), high: Math.round(v.band.high) })}
              />
            </Divided>
            <Nights vm={v} />
          </View>
        )}
      </MetricState>
    </SectionShell>
  );
}
