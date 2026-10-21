// The history card's range in words and numbers (web: metric/[key]/RangeStats.tsx). It follows the route's `r`, which the
// range toggle above sets, so it changes at once.
import { useTranslation } from "react-i18next";
import { DAY, formatDay, type FormatKey } from "@/lib/format";
import type { GoodDirection } from "@/lib/bands";
import type { Metric } from "@/lib/reasons";
import { type TrendRange } from "@/lib/url";
import type { RangeStats as Stats } from "@/queries/metric";
import { cardOf, Divided, period } from "@/screens/trends/parts";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { SectionShell } from "@/ui/shells/SectionShell";

type Props = { ranges: Record<TrendRange, Stats>; format: FormatKey; unit?: string; direction: GoodDirection; total: boolean };

const metric = (v: number | null): Metric<number> => (v === null ? { value: null, reason: "no_data", provisional: false } : { value: v, reason: null, provisional: false });

/** The card itself, for one range. */
export function RangeStatsCard({ ranges, format, unit, direction, total, range }: Props & { range: TrendRange }) {
  const s = ranges[range];
  const { t } = useTranslation("trends");
  const r = period(range);
  const row = { variant: "row" as const, format, unit };
  return (
    <SectionShell variant="card" {...cardOf(r.infoId, r.label)}>
      <Divided>
        <KeyStatRow {...row} label={t("rangeStats.dailyAverage")} caption={r.vsPrior} metric={metric(s.average)} average={s.prior} averageLabel={r.prior} direction={direction} />
        {total && <KeyStatRow {...row} label={t("rangeStats.total")} metric={metric(s.total)} direction="none" />}
        <KeyStatRow {...row} label={t("rangeStats.highest")} caption={s.high ? formatDay(s.high.day, DAY.short) : undefined} metric={metric(s.high?.value ?? null)} direction="none" />
        <KeyStatRow {...row} label={t("rangeStats.lowest")} caption={s.low ? formatDay(s.low.day, DAY.short) : undefined} metric={metric(s.low?.value ?? null)} direction="none" />
        <KeyStatRow variant="row" format="int" unit={t("rangeStats.ofTotal", { total: s.days })} label={t("rangeStats.daysWithData")} metric={metric(s.withData)} direction="none" />
      </Divided>
    </SectionShell>
  );
}
