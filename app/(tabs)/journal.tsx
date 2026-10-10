import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { DAY, formatDay } from "@/lib/format";
import { parseDay } from "@/lib/url";
import { addDays } from "@/time";
import { todayOf } from "@/queries/common";
import { getJournal } from "@/queries/journal";
import { getLog } from "@/queries/log";
import { CheckInCard } from "@/screens/journal/CheckInCard";
import { DayLog } from "@/screens/journal/DayLog";
import { History } from "@/screens/journal/History";
import { LoadError } from "@/screens/journal/LoadError";
import { LogTiles } from "@/screens/journal/LogTiles";
import { JournalSkeleton } from "@/screens/journal/skeleton";
import { WeekCard } from "@/screens/journal/WeekCard";
import { useScreen } from "@/screens/useScreen";
import { DayStrip } from "@/ui/metrics/DayStrip";
import { InsightCard } from "@/ui/metrics/InsightCard";
import { useSelectedDay } from "@/ui/shells/DateSwitcher";
import { PageShell } from "@/ui/shells/PageShell";
import { CollapsibleSection } from "@/ui/shells/CollapsibleSection";
import { ActionLink, SectionShell } from "@/ui/shells/SectionShell";

/** Journal `/journal?d=` (spec §7.11, journey 7). */
export default function Journal() {
  const { d: raw } = useLocalSearchParams<{ d?: string }>();
  const [, setDay] = useSelectedDay();
  const { data, error, loading, reload } = useScreen(async (ctx) => {
    const day = parseDay(raw, todayOf(ctx)).d;
    const [vm, log] = await Promise.all([getJournal(ctx, day), getLog(ctx, day)]);
    return { vm, log };
  }, [raw]);

  return (
    <View className="flex-1">
      <PageShell title="Journal" dateSwitcher={{ mode: "day" }} loading={loading && !data}>
        {data ? <Page vm={data.vm} log={data.log} onSelect={setDay} /> : error ? <LoadError retry={reload} /> : <JournalSkeleton />}
      </PageShell>
    </View>
  );
}

function Page({ vm, log, onSelect }: { vm: Awaited<ReturnType<typeof getJournal>>; log: Awaited<ReturnType<typeof getLog>>; onSelect: (day: string) => void }) {
  const { day: d, today } = vm;
  const date = formatDay(d, DAY.short);
  return (
    <>
      {/* Full-bleed: the strip scrolls edge to edge, its first tile keeps the 16 px gutter inside. */}
      <View className="-mx-4">
        <DayStrip indicator="journal" days={vm.strip.map((s) => ({ date: s.day, done: s.done }))} />
      </View>

      <View className="gap-8">
        {/* Log tiles first: a drink or a weigh-in is a two-tap job; then the check-in, then what the day holds (spec §11 LG1). */}
        <SectionShell variant="section" title="Log">
          <LogTiles vm={log} />
        </SectionShell>

        <CollapsibleSection id="check-in" title="Check-in">
          <CheckInCard dayLabel={date} day={d} today={today} checkIn={vm.checkIn} />
        </CollapsibleSection>

        <CollapsibleSection id="logged" title={`Logged ${d === today ? "today" : d === addDays(today, -1) ? "yesterday" : `on ${date}`}`}>
          <DayLog vm={log} />
        </CollapsibleSection>

        <CollapsibleSection id="insights" title="Insights" action={<ActionLink label="See all" href="/journal/insights" />}>
          <InsightCard body={vm.teaser.text} action={vm.teaser.ready ? { label: "See all insights", href: "/journal/insights" } : undefined} />
        </CollapsibleSection>

        <SectionShell variant="section" title="This week">
          <WeekCard week={log.week} day={d} />
        </SectionShell>

        <CollapsibleSection id="history" title="History">
          <History history={vm.history} day={d} today={today} onSelect={onSelect} />
        </CollapsibleSection>
      </View>
    </>
  );
}
