// More `/more` (spec §7.14, U21): everything that isn't configuration. Ported from pulse (app)/more/page.tsx and
// loading.tsx: "Account & settings" (Profile, Data source, App, each a row to `/settings?s=`), Reports, Trends, Journal,
// Help, Your data, then About. The account row is Profile (no accounts); Coach opens the coach's settings.
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Activity, Archive, Bluetooth, BotMessageSquare, BookOpen, CalendarDays, CalendarRange, ChartLine, Database, ListChecks, Palette, Plug, Target, UserRound, Wind } from "lucide-react-native";
import { i18n } from "@/i18n/config";
import { formatDay, rangeLabel } from "@/lib/format";
import { SCORING_VERSION } from "@/pipeline";
import { APP_VERSION, getMore } from "@/queries/settings";
import { LinkList, LinkListSkeleton, MORE_COLUMN, type LinkListRow } from "@/ui/shells/LinkList";
import { PageShell } from "@/ui/shells/PageShell";
import { useScreen } from "../useScreen";
import { About } from "./About";
import { SCORE_DOCS } from "./howItWorksContent";

/** Each part of Settings is a row here, as the reference app's "Account & settings". Notifications sit under App. */
const settingsRows = (): LinkListRow[] => [
  { icon: UserRound, label: i18n.t("more:row.profile"), href: "/settings?s=profile" },
  { icon: Plug, label: i18n.t("more:row.dataSource"), href: "/settings?s=source" },
  { icon: Palette, label: i18n.t("more:row.app"), href: "/settings?s=app" },
  { icon: Bluetooth, label: i18n.t("more:row.liveHeartRate"), href: "/settings?s=live" },
  { icon: BotMessageSquare, label: i18n.t("more:row.coach"), href: "/coach/settings" },
  { icon: Target, label: i18n.t("more:row.goals"), href: "/settings?s=goals" },
];

/** Both sessions that run on the band's live heart rate (halo's "Live" group). */
const liveLinks = (): LinkListRow[] => [
  { icon: Wind, label: i18n.t("more:row.breathe"), description: i18n.t("more:row.breatheHint"), href: "/breathe" },
  { icon: Activity, label: i18n.t("more:row.liveWorkout"), description: i18n.t("more:row.liveWorkoutHint"), href: "/workout-live" },
];

/** The More tab's key; Home prefetches it with getMore. */
export const MORE_KEY = ["more"] as const;

export function MoreScreen() {
  const { t } = useTranslation("more");
  const settings = settingsRows();
  const live = liveLinks();
  const { data: vm } = useScreen(getMore, MORE_KEY);
  if (!vm)
    return (
      <PageShell loading title={t("title")}>
        <View className={MORE_COLUMN}>
          <LinkListSkeleton title={t("group.accountSettings")} rows={settings} />
          <LinkListSkeleton
            title={t("group.reports")}
            rows={[
              { icon: CalendarRange, label: t("row.weeklyReport") },
              { icon: CalendarDays, label: t("row.monthlyReport") },
              { icon: Archive, label: t("row.allReports") },
            ]}
          />
          <LinkListSkeleton title={t("group.trends")} rows={[{ icon: ChartLine, label: t("row.trends") }]} />
          <LinkListSkeleton title={t("group.live")} rows={live} />
          <LinkListSkeleton title={t("group.journal")} rows={[{ icon: ListChecks, label: t("row.behaviours") }]} />
          <LinkListSkeleton title={t("group.help")} rows={[{ icon: BookOpen, label: t("row.howPulseWorks") }]} />
          <LinkListSkeleton title={t("group.yourData")} rows={[{ icon: Database, label: t("row.export") }]} />
          <About version={APP_VERSION} scoringVersion={SCORING_VERSION} />
        </View>
      </PageShell>
    );

  const reports: LinkListRow[] = [
    ...(vm.latestWeek ? [{ icon: CalendarRange, label: t("row.weeklyReport"), aside: rangeLabel(vm.latestWeek.start, vm.latestWeek.end), href: `/reports/${vm.latestWeek.period}` }] : []),
    ...(vm.latestMonth ? [{ icon: CalendarDays, label: t("row.monthlyReport"), aside: formatDay(vm.latestMonth.start, { month: "long" }), href: `/reports/${vm.latestMonth.period}` }] : []),
    { icon: Archive, label: t("row.allReports"), aside: vm.reportCount ? String(vm.reportCount) : undefined, href: "/reports" },
  ];
  return (
    <PageShell title={t("title")}>
      {/* One column, as Settings: a list reads top to bottom. */}
      <View className={MORE_COLUMN}>
        <LinkList title={t("group.accountSettings")} rows={settings} />
        <LinkList title={t("group.reports")} rows={reports} />
        <LinkList title={t("group.trends")} rows={[{ icon: ChartLine, label: t("row.trends"), aside: t("row.trendsAside"), href: "/trends" }]} />
        <LinkList title={t("group.live")} rows={live} />
        <LinkList title={t("group.journal")} rows={[{ icon: ListChecks, label: t("row.behaviours"), aside: t("row.behavioursAside", { shown: vm.behaviours.shown, total: vm.behaviours.total }), href: "/more/behaviours" }]} />
        <LinkList title={t("group.help")} rows={[{ icon: BookOpen, label: t("row.howPulseWorks"), aside: t("row.scoresAside", { count: SCORE_DOCS.length }), href: "/more/how-it-works" }]} />
        <LinkList title={t("group.yourData")} rows={[{ icon: Database, label: t("row.export"), aside: t("row.exportAside"), href: "/more/data" }]} />
        <About version={vm.version} scoringVersion={vm.scoringVersion} />
      </View>
    </PageShell>
  );
}
