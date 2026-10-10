// Reports archive `/reports` (web: (app)/reports/page.tsx, loading.tsx; More, U21): one period kind at a time (Weekly /
// Monthly), newest first. Weeks are grouped by month and only the last few months show until "Show earlier weeks"; months
// are grouped by year. `?view=` and `?all=` live in the route's params, so Back and a link keep them.
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { DAY, formatDay, formatValue, rangeLabel } from "@/lib/format";
import { getReportArchive, type ReportArchiveVM, type ReportListItem } from "@/queries/reports";
import { LoadError } from "@/screens/trends/parts";
import { useScreen } from "@/screens/useScreen";
import { MiniRing } from "@/ui/metrics/MiniRing";
import { Segmented } from "@/ui/Segmented";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { LinkList, LinkListSkeleton, MORE_COLUMN, type LinkListRow } from "@/ui/shells/LinkList";
import { haptic } from "@/ui/haptics";
import { Text } from "@/ui/Text";

/** The period's average Recovery as the reference app's 22 px ring and its value. */
function Aside({ r }: { r: ReportListItem }) {
  return (
    <View className="shrink-0 flex-row items-center gap-2">
      <MiniRing variant="recovery" value={r.recovery} />
      <Text accessibilityLabel={`Average Recovery ${formatValue("int", r.recovery)}${r.recovery !== null ? " percent" : ""}`} className="w-9 text-right font-numeric text-[15px] font-bold leading-5 tabular-nums">
        {formatValue("int", r.recovery)}
        {r.recovery !== null && "%"}
      </Text>
    </View>
  );
}

/** Month groups of weeks shown before "Show earlier weeks": about a quarter. */
const RECENT_MONTHS = 3;

type View_ = "weeks" | "months";
type Group = { title: string; rows: LinkListRow[] };

/** Consecutive items sharing a key become one titled group, keeping the newest-first order. */
function groupRows(items: ReportListItem[], key: (r: ReportListItem) => string, row: (r: ReportListItem) => LinkListRow): Group[] {
  const groups: Group[] = [];
  for (const r of items) {
    const title = key(r);
    if (groups.at(-1)?.title !== title) groups.push({ title, rows: [] });
    groups.at(-1)!.rows.push(row(r));
  }
  return groups;
}

const weekRow = (r: ReportListItem): LinkListRow => ({ label: rangeLabel(r.start, r.end), href: `/reports/${r.period}`, aside: <Aside r={r} />, description: r.partial ? "Partial week" : undefined });
const monthRow = (r: ReportListItem): LinkListRow => ({ label: formatDay(r.start, { month: "long" }), href: `/reports/${r.period}`, aside: <Aside r={r} />, description: r.partial ? "Partial month" : undefined });

/** A first week can exist before any month has data, and vice versa: fall back to the kind that has rows. */
const viewOf = (vm: ReportArchiveVM | undefined, q?: string): View_ => (vm && ((q === "months" && vm.months.length) || !vm.weeks.length) ? "months" : "weeks");

/** The groups the screen draws, once per loaded archive and view. */
function groupsOf(vm: ReportArchiveVM, view: View_) {
  return view === "weeks" ? groupRows(vm.weeks, (r) => formatDay(r.start, DAY.monthYear), weekRow) : groupRows(vm.months, (r) => r.start.slice(0, 4), monthRow);
}

export default function ReportsScreen() {
  const { view: q, all: allParam } = useLocalSearchParams<{ view?: string; all?: string }>();
  const { data: vm, error, reload } = useScreen(getReportArchive, []);
  const view = viewOf(vm, q);
  const groups = useMemo(() => (vm ? groupsOf(vm, view) : []), [vm, view]);
  if (error && !vm) return <LoadError title="Reports" reload={reload} />;
  if (!vm) return <Loading />;

  const empty = !vm.weeks.length && !vm.months.length;
  const shown = view === "weeks" && allParam !== "1" ? groups.slice(0, RECENT_MONTHS) : groups;
  return (
    <DetailShell
      title="Reports"
      primary={
        empty ? (
          <EmptyState body="No reports yet. Your first weekly report appears once a week has data." />
        ) : (
          // One 640 px column like More and Settings: two columns of uneven month groups left holes.
          <View className={MORE_COLUMN}>
            <Segmented
              label="Report period"
              fill
              value={view}
              options={[{ value: "weeks", label: "Weekly" }, { value: "months", label: "Monthly" }]}
              onChange={(v) => router.setParams({ view: v === "weeks" ? "" : "months", all: "" })}
              textClassName="text-[13px] font-bold uppercase tracking-[0.1em]"
            />
            {shown.map((g) => (
              <LinkList key={g.title} title={g.title} rows={g.rows} />
            ))}
            {shown.length < groups.length && (
              <Pressable accessibilityRole="button" onPress={() => (haptic.tap(), router.setParams({ all: "1" }))} className="mx-auto h-11 items-center justify-center rounded-full px-5 active:bg-foreground/[0.06]">
                <Text className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/85">Show earlier weeks</Text>
              </Pressable>
            )}
          </View>
        )
      }
    />
  );
}

const rows = (n: number) => Array.from({ length: n }, () => ({ label: "" }));

/** Reports archive: the view switch and two month groups at their final size (spec §5.19). */
function Loading() {
  return (
    <DetailShell
      loading
      title="Reports"
      primary={
        <View accessibilityElementsHidden className={MORE_COLUMN}>
          <View className="h-11 rounded-lg bg-muted" />
          <LinkListSkeleton title="" rows={rows(4)} />
          <LinkListSkeleton title="" rows={rows(4)} />
        </View>
      }
    />
  );
}
