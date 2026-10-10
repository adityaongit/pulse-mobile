// What Journal shows while its data loads: the web's loading.tsx (strip, then Log, Check-in, the day's log, Insights,
// This week, History), box for box.
import { View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import { DayStripSkeleton } from "@/ui/metrics/DayStrip";
import { InsightCardSkeleton } from "@/ui/metrics/InsightCard";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";

export function JournalSkeleton() {
  return (
    <>
      <View accessibilityElementsHidden className="-mx-4">
        <DayStripSkeleton indicator="journal" />
      </View>
      <View accessibilityElementsHidden className="gap-8">
        <SectionShell variant="section" title="Log">
          <View className="-mx-4 flex-row gap-2 overflow-hidden px-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-24 shrink-0 rounded-2xl" />
            ))}
          </View>
        </SectionShell>
        <SectionShell variant="section" title="Check-in">
          <SectionShell variant="card" title="Check-in">
            <View className="gap-4">
              <View>
                <SkeletonText className="w-full" lh={22} fs={15} />
                <SkeletonText className="w-2/3" lh={22} fs={15} />
              </View>
              <Skeleton className="h-11 rounded-xl" />
            </View>
          </SectionShell>
        </SectionShell>
        <SectionShell variant="section" title="Logged today">
          <Card className="gap-0 px-4 py-1">
            {Array.from({ length: 4 }, (_, i) => (
              <View key={i} className={i > 0 ? "min-h-14 flex-row items-center gap-3 border-t border-border py-2" : "min-h-14 flex-row items-center gap-3 py-2"}>
                <Skeleton className="size-5 rounded-md" />
                <SkeletonText className="w-24" />
                <Skeleton className="ml-auto h-4 w-16 rounded-full" />
              </View>
            ))}
          </Card>
        </SectionShell>
        <SectionShell
          variant="section"
          title="Insights"
          action={<Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary">See all</Text>}
        >
          <InsightCardSkeleton action />
        </SectionShell>
        <SectionShell variant="section" title="This week">
          <Skeleton className="h-[400px] rounded-2xl" />
        </SectionShell>
        <SectionShell variant="section" title="History">
          <Card className="gap-0 px-4 py-1">
            {Array.from({ length: 7 }, (_, i) => (
              <View key={i} className={i > 0 ? "min-h-13 flex-row items-center gap-3 border-t border-border py-2" : "min-h-13 flex-row items-center gap-3 py-2"}>
                <SkeletonText className="w-24" />
                <Skeleton className="ml-auto h-6 w-20 rounded-full" />
                <Icon icon={ChevronRight} size={16} tone="muted-foreground" strokeWidth={1.75} />
              </View>
            ))}
          </Card>
        </SectionShell>
      </View>
    </>
  );
}
