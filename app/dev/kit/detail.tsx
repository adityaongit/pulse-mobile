import { View } from "react-native";
import * as fx from "@/ui/fixtures/kit";
import { Divided, KitCalendar } from "@/ui/kit/KitScreen";
import { ContributorRow } from "@/ui/metrics/ContributorRow";
import { DriverList } from "@/ui/metrics/DriverList";
import { InsightCard } from "@/ui/metrics/InsightCard";
import { ScoreDial } from "@/ui/metrics/ScoreDial";
import { TrendChart } from "@/ui/charts/TrendChart";
import { Card } from "@/ui/Card";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";

// Stands in for "sync now": the spinner shows until this settles.
const fakeSync = () => new Promise<void>((done) => setTimeout(done, 1200));

/** DetailShell (spec §4.4): the date as the header title, the hero ring, the coach card, then cards. Scroll: the hero ring shrinks into the header's second row (spec §4.3a). */
export default function KitDetail() {
  return (
    <KitCalendar>
      <DetailShell
        title="Recovery"
        info={{ title: "Recovery", body: "Your readiness for the day, based on overnight measurements and your recent baseline." }}
        dateSwitcher={{ mode: "day", placement: "header", calendar: "recovery", steppers: true }}
        hero={<ScoreDial variant="recovery" size="lg" value={85} provisional />}
        collapse
        onRefresh={fakeSync}
        stats={{ left: { value: "124", label: "HRV ms" }, right: { value: "49", label: "Resting HR", tone: "optimal" } }}
        insight={<InsightCard {...fx.insight} />}
        primary={
          <SectionShell variant="section" title="What shaped it">
            <DriverList variant="recovery" unit="pts" data={fx.recoveryDrivers} />
          </SectionShell>
        }
        secondary={[
          <SectionShell key="c" variant="card" title="Contributors">
            <Divided>{fx.contributors.map(({ key, ...ct }) => <ContributorRow key={key} variant="recovery" {...ct} />)}</Divided>
          </SectionShell>,
          <SectionShell key="t" variant="card" title="Recovery trend">
            <TrendChart label="Recovery" data={fx.ok(fx.recoveryTrend)} unit="%" format="int" colorBy="band" direction="up" deltas={{ w: 4, m: -3, "6m": 2 }} baseline={{ mean: 62, sd: 12 }} />
          </SectionShell>,
        ]}
        footer={
          <Card>
            <View className="px-4">
              <Text className="text-[15px] leading-[22px] text-foreground-secondary">The footer slot: links to related screens, the data source note.</Text>
            </View>
          </Card>
        }
      />
    </KitCalendar>
  );
}
