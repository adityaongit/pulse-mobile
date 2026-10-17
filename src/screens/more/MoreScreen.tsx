// More `/more` (spec §7.14, U21): everything that isn't configuration. Ported from pulse (app)/more/page.tsx and
// loading.tsx: "Account & settings" (Profile, Data source, App, each a row to `/settings?s=`), Reports, Trends, Journal,
// Help, Your data, then About. The account row is Profile (no accounts); Coach opens the coach's settings.
import { View } from "react-native";
import { Activity, Archive, Bluetooth, BotMessageSquare, BookOpen, CalendarDays, CalendarRange, ChartLine, Database, ListChecks, Palette, Plug, Target, UserRound, Wind } from "lucide-react-native";
import { formatDay, rangeLabel } from "@/lib/format";
import { SCORING_VERSION } from "@/pipeline";
import { APP_VERSION, getMore } from "@/queries/settings";
import { LinkList, LinkListSkeleton, MORE_COLUMN, type LinkListRow } from "@/ui/shells/LinkList";
import { PageShell } from "@/ui/shells/PageShell";
import { useScreen } from "../useScreen";
import { About } from "./About";
import { SCORE_DOCS } from "./howItWorksContent";

/** Each part of Settings is a row here, as the reference app's "Account & settings". Notifications sit under App. */
const settings: LinkListRow[] = [
  { icon: UserRound, label: "Profile", href: "/settings?s=profile" },
  { icon: Plug, label: "Data source", href: "/settings?s=source" },
  { icon: Palette, label: "App", href: "/settings?s=app" },
  { icon: Bluetooth, label: "Live heart rate", href: "/settings?s=live" },
  { icon: BotMessageSquare, label: "Coach", href: "/coach/settings" },
  { icon: Target, label: "Goals", href: "/settings?s=goals" },
];

/** Both sessions that run on the band's live heart rate (halo's "Live" group). */
const LIVE_LINKS: LinkListRow[] = [
  { icon: Wind, label: "Breathe", description: "Paced breathing, with HRV before and after", href: "/breathe" },
  { icon: Activity, label: "Live workout", description: "Strain Coach on your band’s live heart rate", href: "/workout-live" },
];

/** The More tab's key; Home prefetches it with getMore. */
export const MORE_KEY = ["more"] as const;

export function MoreScreen() {
  const { data: vm } = useScreen(getMore, MORE_KEY);
  if (!vm)
    return (
      <PageShell loading title="More">
        <View className={MORE_COLUMN}>
          <LinkListSkeleton title="Account & settings" rows={settings} />
          <LinkListSkeleton
            title="Reports"
            rows={[
              { icon: CalendarRange, label: "Weekly report" },
              { icon: CalendarDays, label: "Monthly report" },
              { icon: Archive, label: "All reports" },
            ]}
          />
          <LinkListSkeleton title="Trends" rows={[{ icon: ChartLine, label: "Trends" }]} />
          <LinkListSkeleton title="Live" rows={LIVE_LINKS} />
          <LinkListSkeleton title="Journal" rows={[{ icon: ListChecks, label: "Behaviours" }]} />
          <LinkListSkeleton title="Help" rows={[{ icon: BookOpen, label: "How Pulse works" }]} />
          <LinkListSkeleton title="Your data" rows={[{ icon: Database, label: "Export" }]} />
          <About version={APP_VERSION} scoringVersion={SCORING_VERSION} />
        </View>
      </PageShell>
    );

  const reports: LinkListRow[] = [
    ...(vm.latestWeek ? [{ icon: CalendarRange, label: "Weekly report", aside: rangeLabel(vm.latestWeek.start, vm.latestWeek.end), href: `/reports/${vm.latestWeek.period}` }] : []),
    ...(vm.latestMonth ? [{ icon: CalendarDays, label: "Monthly report", aside: formatDay(vm.latestMonth.start, { month: "long" }), href: `/reports/${vm.latestMonth.period}` }] : []),
    { icon: Archive, label: "All reports", aside: vm.reportCount ? String(vm.reportCount) : undefined, href: "/reports" },
  ];
  return (
    <PageShell title="More">
      {/* One column, as Settings: a list reads top to bottom. */}
      <View className={MORE_COLUMN}>
        <LinkList title="Account & settings" rows={settings} />
        <LinkList title="Reports" rows={reports} />
        <LinkList title="Trends" rows={[{ icon: ChartLine, label: "Trends", aside: "Up to 1 year", href: "/trends" }]} />
        <LinkList title="Live" rows={LIVE_LINKS} />
        <LinkList title="Journal" rows={[{ icon: ListChecks, label: "Behaviours", aside: `${vm.behaviours.shown} of ${vm.behaviours.total} shown`, href: "/more/behaviours" }]} />
        <LinkList title="Help" rows={[{ icon: BookOpen, label: "How Pulse works", aside: `${SCORE_DOCS.length} scores`, href: "/more/how-it-works" }]} />
        <LinkList title="Your data" rows={[{ icon: Database, label: "Export", aside: "CSV, JSON", href: "/more/data" }]} />
        <About version={vm.version} scoringVersion={vm.scoringVersion} />
      </View>
    </PageShell>
  );
}
