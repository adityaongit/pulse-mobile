import { Pressable, View } from "react-native";
import { CalendarRange, ChevronRight, HeartPulse, Brain, TrendingUp, Infinity as InfinityIcon, type LucideIcon } from "lucide-react-native";
import { router, type Href } from "expo-router";
import { Gradient } from "@/ui/Gradient";
import { Icon } from "@/ui/Icon";
import * as fx from "@/ui/fixtures/kit";
import { Divided, KitCalendar } from "@/ui/kit/KitScreen";
import { ActivityCard } from "@/ui/metrics/ActivityCard";
import { DayStrip } from "@/ui/metrics/DayStrip";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { ScoreDial } from "@/ui/metrics/ScoreDial";
import { SleepCard } from "@/ui/metrics/SleepCard";
import { HeaderSentinel, PageShell } from "@/ui/shells/PageShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

/** PageShell layout="home" (spec §4.4, §7.1): the collapsing header's top row, the dials, and the ring row that eases in as they scroll away. */
function Banner() {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push("/dev/kit" as Href)} className="h-14 flex-row items-center gap-3 overflow-hidden rounded-xl px-4">
      <Gradient from={c["banner-from"]} to={c["banner-to"]} />
      <Icon icon={CalendarRange} size={20} tone="foreground" strokeWidth={1.75} />
      <Text className="flex-1 text-base font-semibold leading-[22px]">Your week in review</Text>
      <Text className="text-xs font-medium leading-4 text-muted-foreground">Sep 22 - Sep 28</Text>
      <Icon icon={ChevronRight} size={16} tone="foreground-secondary" strokeWidth={1.75} />
    </Pressable>
  );
}

const CARDS: [string, LucideIcon][] = [["Healthspan", InfinityIcon], ["Health Monitor", HeartPulse], ["Stress Monitor", Brain], ["Fitness", TrendingUp]];

// Stands in for "sync now": the spinner shows until this settles.
const fakeSync = () => new Promise<void>((done) => setTimeout(done, 1200));

export default function KitHome() {
  return (
    <KitCalendar>
      <PageShell
        title="Home"
        layout="home"
        onRefresh={fakeSync}
        rings={{ sleep: { value: 74, href: "/dev/kit" }, recovery: { value: 85, href: "/dev/kit" }, strain: { value: 14.2, href: "/dev/kit" } }}
        slots={{
          top: (
            <View className="gap-6">
              <View className="-mx-4">
                <DayStrip indicator="recovery" days={fx.stripDays} />
              </View>
              <View className="flex-row items-start justify-center gap-2">
                <ScoreDial variant="sleep" size="md" value={74} href="/dev/kit" />
                <ScoreDial variant="recovery" size="md" value={85} href="/dev/kit" />
                <ScoreDial variant="strain" size="md" value={14.2} target={[12, 15]} extraTags={["so_far"]} href="/dev/kit" />
              </View>
              <HeaderSentinel className="-mt-6 h-0" />
            </View>
          ),
          aside: (
            <SectionShell variant="section" title="Key statistics" aside="vs. 30-day average">
              <View className="rounded-xl bg-card px-4 py-1">
                <Divided>{fx.keyStats.map(({ key, ...s }) => <KeyStatRow key={key} variant="row" {...s} />)}</Divided>
              </View>
            </SectionShell>
          ),
          main: (
            <SectionShell variant="section" title="My Day">
              <SectionShell variant="card" title="Today's activities">
                <View className="gap-1.5">
                  <SleepCard {...fx.timeline.sleep} href="/dev/kit" timeZone={fx.TZ} />
                  <ActivityCard {...fx.timeline.run} href="/dev/kit" timeZone={fx.TZ} />
                </View>
              </SectionShell>
            </SectionShell>
          ),
          bottom: (
            <View className="gap-8">
              <Banner />
              <View className="gap-3">
                {CARDS.map(([title, glyph]) => (
                  <SectionShell key={title} variant="card" title={title} href="/dev/kit">
                    <Icon icon={glyph} size={24} tone="muted-foreground" strokeWidth={1.75} />
                  </SectionShell>
                ))}
              </View>
            </View>
          ),
        }}
      />
    </KitCalendar>
  );
}
