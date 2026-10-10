// A nap's loading state: the web's `sleep/nap/[id]/loading.tsx` is `ActivitySkeleton` (pulse (app)/_lib/skeletons.tsx), the
// activity page's shape (the hero's two numbers, the heart-rate chart over the zone rows, key statistics, heart rate
// recovery and the insight card), so it is ported as it is.
import { View } from "react-native";
import { IntradayHrChartSkeleton } from "@/ui/charts/IntradayHrChart";
import { ZoneBarsSkeleton } from "@/ui/charts/ZoneBars";
import { Card } from "@/ui/Card";
import { InsightCardSkeleton } from "@/ui/metrics/InsightCard";
import { KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow";
import { LABEL } from "@/ui/metrics/primitives";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { cn } from "@/ui/cn";
import { statIcon } from "../_lib/view";

const TILES = [
  ["avgHr", "Average heart rate"],
  ["maxHr", "Max heart rate"],
  ["calories", "Calories"],
] as const;

export function NapSkeleton() {
  return (
    <DetailShell
      loading
      title="Activity"
      align="start"
      hero={
        <View accessibilityElementsHidden className="w-full gap-2">
          <View className="flex-row flex-wrap items-end gap-x-10 gap-y-3">
            {["Activity strain", "Duration"].map((l) => (
              <View key={l}>
                <SkeletonText lh={34} fs={34} className="w-14" />
                <Text className={cn(LABEL, "mt-2 text-foreground-secondary")}>{l}</Text>
              </View>
            ))}
          </View>
          <SkeletonText className="w-24" />
        </View>
      }
      primary={
        <View accessibilityElementsHidden className="gap-6">
          <IntradayHrChartSkeleton variant="activity" />
          <View>
            <ZoneBarsSkeleton variant="rows" />
            <SkeletonText className="mt-3 w-56" />
          </View>
        </View>
      }
      secondary={[
        <SectionShell key="stats" variant="section" title="Key statistics" aside="vs. 30-day average">
          <View accessibilityElementsHidden className="gap-3">
            <View className="flex-row gap-3">
              {TILES.slice(0, 2).map(([k, l]) => (
                <View key={k} className="min-w-0 flex-1"><KeyStatRowSkeleton variant="tile" label={l} icon={statIcon(k)} /></View>
              ))}
            </View>
            <View className="flex-row gap-3">
              <View className="min-w-0 flex-1"><KeyStatRowSkeleton variant="tile" label={TILES[2][1]} icon={statIcon(TILES[2][0])} /></View>
              <View className="min-w-0 flex-1" />
            </View>
          </View>
        </SectionShell>,
        <SectionShell key="hrr" variant="section" title="Heart rate recovery">
          <Card className="justify-center gap-0 p-4">
            <Skeleton className="h-24 rounded-lg bg-muted/60" />
          </Card>
        </SectionShell>,
      ]}
      footer={<InsightCardSkeleton />}
    />
  );
}
