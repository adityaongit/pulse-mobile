import { useEffect } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { cardInfo } from "@/ui/shells/cardInfo";
import { DAY, formatDay } from "@/lib/format";
import { addDays } from "@/lib/time";
import type { getJournal } from "@/queries/journal";
import type { getDayLog } from "@/queries/journalExtras";
import { CheckInCard } from "@/screens/journal/CheckInCard";
import { History } from "@/screens/journal/History";
import { LoadError } from "@/screens/journal/LoadError";
import { LogTiles } from "@/screens/journal/LogTiles";
import { journalKey, journalQuery, YESTERDAY_OFFERED_KEY } from "@/screens/journal/query";
import { JournalSkeleton } from "@/screens/journal/skeleton";
import { WeekCard } from "@/screens/journal/WeekCard";
import { useScreen } from "@/screens/useScreen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DayStrip } from "@/ui/metrics/DayStrip";
import { InsightCard } from "@/ui/metrics/InsightCard";
import { useSelectedDay } from "@/ui/shells/DateSwitcher";
import { PageShell } from "@/ui/shells/PageShell";
import { CollapsibleSection } from "@/ui/shells/CollapsibleSection";
import { ActionLink, SectionShell } from "@/ui/shells/SectionShell";
import { push } from "@/ui/navigate";

/** Journal `/journal?d=` (spec §7.11, journey 7). */
export default function Journal() {
  const { t } = useTranslation("ui");
  const { d: raw } = useLocalSearchParams<{ d?: string }>();
  const [, setDay] = useSelectedDay();
  const { data, error, loading, reload } = useScreen(journalQuery(raw), journalKey(raw));
  useOfferYesterday(data?.vm, data?.offered);

  return (
    <View className="flex-1">
      <PageShell title={t("tabs.journal")} dateSwitcher={{ mode: "day" }} loading={loading && !data}>
        {data ? <Page vm={data.vm} log={data.log} onSelect={setDay} /> : error ? <LoadError retry={reload} /> : <JournalSkeleton />}
      </PageShell>
    </View>
  );
}

function Page({ vm, log, onSelect }: { vm: Awaited<ReturnType<typeof getJournal>>; log: Awaited<ReturnType<typeof getDayLog>>; onSelect: (day: string) => void }) {
  const { t } = useTranslation("journal");
  const { t: tu } = useTranslation("ui");
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
        <SectionShell variant="section" title={t("page.log")}>
          <LogTiles vm={log} />
        </SectionShell>

        <CollapsibleSection id="check-in" title={t("page.checkIn")}>
          <CheckInCard dayLabel={date} day={d} today={today} checkIn={vm.checkIn} />
        </CollapsibleSection>

        <CollapsibleSection id="insights" title={t("page.insights")} action={<ActionLink label={t("page.seeAll")} href="/journal/insights" />}>
          <InsightCard body={vm.teaser.text} action={vm.teaser.ready ? { label: tu("app.seeAllInsights"), href: "/journal/insights" } : undefined} />
        </CollapsibleSection>

        <SectionShell variant="section" title={t("page.thisWeek")} info={cardInfo("This week")}>
          <WeekCard week={log.week} day={d} />
        </SectionShell>

        <CollapsibleSection id="history" title={t("page.history")}>
          <History history={vm.history} day={d} today={today} onSelect={onSelect} />
        </CollapsibleSection>
      </View>
    </>
  );
}

/**
 * Baro's "Log yesterday" (docs/onboarding.md): the first time the Journal opens on today with yesterday not checked in,
 * the check-in sheet opens on yesterday. Once only: the flag is set before the sheet opens.
 */
function useOfferYesterday(vm: Awaited<ReturnType<typeof getJournal>> | undefined, offered: boolean | undefined) {
  const yesterday = vm && vm.day === vm.today ? vm.strip.find((s) => s.day === addDays(vm.today, -1)) : undefined;
  const offer = offered === false && !!yesterday && !yesterday.done;
  useEffect(() => {
    if (!offer || !yesterday) return;
    AsyncStorage.setItem(YESTERDAY_OFFERED_KEY, "1").then(() => push(`/checkin?d=${yesterday.day}`), () => {});
  }, [offer, yesterday]);
}
