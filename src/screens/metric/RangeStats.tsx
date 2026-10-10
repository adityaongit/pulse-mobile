// The history card's range in words and numbers (web: metric/[key]/RangeStats.tsx). It follows the route's `r`, which the
// range toggle above sets, so it changes at once.
import { DAY, formatDay, type FormatKey } from "@/lib/format";
import type { GoodDirection } from "@/lib/bands";
import type { Metric } from "@/lib/reasons";
import { type TrendRange } from "@/lib/url";
import type { RangeStats as Stats } from "@/queries/metric";
import { Divided } from "@/screens/trends/parts";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { SectionShell } from "@/ui/shells/SectionShell";

const RANGE: Record<TrendRange, { label: string; prior: string }> = {
  w: { label: "Last 7 days", prior: "the 7 days before" },
  m: { label: "Last 30 days", prior: "the 30 days before" },
  "6m": { label: "Last 6 months", prior: "the 6 months before" },
  "1y": { label: "Last 12 months", prior: "the year before" },
};

type Props = { ranges: Record<TrendRange, Stats>; format: FormatKey; unit?: string; direction: GoodDirection; total: boolean };

const metric = (v: number | null): Metric<number> => (v === null ? { value: null, reason: "no_data", provisional: false } : { value: v, reason: null, provisional: false });

/** The card itself, for one range. */
export function RangeStatsCard({ ranges, format, unit, direction, total, range }: Props & { range: TrendRange }) {
  const s = ranges[range];
  const r = RANGE[range];
  const row = { variant: "row" as const, format, unit };
  return (
    <SectionShell variant="card" title={r.label}>
      <Divided>
        <KeyStatRow {...row} label="Daily average" caption={`vs. ${r.prior}`} metric={metric(s.average)} average={s.prior} averageLabel={r.prior} direction={direction} />
        {total && <KeyStatRow {...row} label="Total" metric={metric(s.total)} direction="none" />}
        <KeyStatRow {...row} label="Highest" caption={s.high ? formatDay(s.high.day, DAY.short) : undefined} metric={metric(s.high?.value ?? null)} direction="none" />
        <KeyStatRow {...row} label="Lowest" caption={s.low ? formatDay(s.low.day, DAY.short) : undefined} metric={metric(s.low?.value ?? null)} direction="none" />
        <KeyStatRow variant="row" format="int" unit={`of ${s.days}`} label="Days with data" metric={metric(s.withData)} direction="none" />
      </Divided>
    </SectionShell>
  );
}
