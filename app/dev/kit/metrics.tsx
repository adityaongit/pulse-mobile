import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { openSheet } from "@/ui/shells/sheets";
import { Activity, Droplet, Footprints, Heart, Moon, Rabbit, Thermometer, Timer, Turtle, Wind, Zap, type LucideIcon } from "lucide-react-native";
import { REASON_CODES } from "@/lib/reasons";
import { Card } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import * as fx from "@/ui/fixtures/kit";
import { Divided, Entry, Frame, Group, KitScreen, ROW, ROWS } from "@/ui/kit/KitScreen";
import { ActivityCard } from "@/ui/metrics/ActivityCard";
import { ContributorRow } from "@/ui/metrics/ContributorRow";
import { DayStrip, DayStripSkeleton } from "@/ui/metrics/DayStrip";
import { DriverList } from "@/ui/metrics/DriverList";
import { InsightCard } from "@/ui/metrics/InsightCard";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { MiniRing } from "@/ui/metrics/MiniRing";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { ScoreDial, ScoreDialSkeleton } from "@/ui/metrics/ScoreDial";
import { SleepCard } from "@/ui/metrics/SleepCard";
import { SleepStages } from "@/ui/metrics/SleepStages";
import { Sparkline } from "@/ui/metrics/Sparkline";
import { TickScale } from "@/ui/metrics/TickScale";
import { BreakdownBar } from "@/ui/metrics/BreakdownBar";
import { TrendLegend } from "@/ui/metrics/TrendLegend";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

const STAT_ICON: Record<string, LucideIcon> = { hrv: Activity, rhr: Heart, rr: Wind, sleep: Moon, cal: Zap, steps: Footprints, spo2: Droplet, temp: Thermometer, max: Heart, dur: Timer, hours: Moon, consistency: Moon, efficiency: Moon, restorative: Moon };
const statIcon = (key: string, stroke = 1.75): ReactNode => (STAT_ICON[key] ? <Icon icon={STAT_ICON[key]} size={20} tone="muted-foreground" strokeWidth={stroke} /> : undefined);
const reasons = REASON_CODES.map((r) => ({ r, metric: fx.why<number>(r, 4) }));
const HOUR = 3_600_000;

// The vital's and the factor's detail sheets are placeholders: they open the kit's demo sheet route (app/dev/sheet.tsx).
function SelectableTile() {
  const v = fx.vitals[0];
  return <KeyStatRow variant="tile" icon={<Icon icon={Wind} size={20} tone="muted-foreground" strokeWidth={1.5} />} direction="neutral" label={v.label} metric={v.metric} unit={v.unit} format={v.format} chip={v.chip} onSelect={() => openSheet("/dev/sheet?size=default&title=Respiratory%20rate")} />;
}

function SelectableImpact() {
  const [selected, setSelected] = useState<string | undefined>("alcohol");
  return <DriverList variant="impact" unit="%" data={fx.impactDrivers} selectedKey={selected} onSelect={setSelected} />;
}

function HealthspanList() {
  return (
    <Divided>
      {fx.healthspan.map(({ key, ...h }) => (
        <ContributorRow key={key} variant="healthspan" icon={statIcon("rhr")} onSelect={() => openSheet("/dev/sheet?size=default&title=Healthspan%20factor")} {...h} />
      ))}
    </Divided>
  );
}

export default function KitMetrics() {
  const { c } = useTheme();
  return (
    <KitScreen title="Metrics" blurb="Numbers and their honest states. Every metric renders loading, empty, reason, provisional and value through MetricState.">
      <Group title="Dials">
        <Entry name="ScoreDial" file="src/ui/metrics/ScoreDial.tsx" use="Home's three rings (md), the Recovery, Strain, Sleep and Stress heroes (lg), sticky headers (compact), forecasts and reports (sm)." props={["variant: recovery | strain | sleep | stat | gauge", "size: sm | md | lg", "value: number | null", "reason, nightsLeft", "provisional, tags, extraTags", "target: [lo, hi]", "status (sleep lg)", "compact", "loading", "href"]}>
          <Frame name="md, Home row: links, Strain Target, So far">
            <View className={ROW}>
              <ScoreDial variant="sleep" size="md" value={74} href="/dev/kit" />
              <ScoreDial variant="recovery" size="md" value={85} href="/dev/kit" />
              <ScoreDial variant="strain" size="md" value={9.4} target={[12, 15]} extraTags={["so_far"]} href="/dev/kit" />
            </View>
          </Frame>
          <Frame name="md, Home row at 320 px" narrow>
            <View className="flex-row items-start justify-center gap-1">
              <ScoreDial variant="sleep" size="md" value={100} href="/dev/kit" />
              <ScoreDial variant="recovery" size="md" value={100} href="/dev/kit" />
              <ScoreDial variant="strain" size="md" value={21} target={[12, 15]} extraTags={["so_far"]} href="/dev/kit" />
            </View>
          </Frame>
          <Frame name="md, extremes: 0%, 7%, 0.0">
            <View className={ROW}>
              <ScoreDial variant="sleep" size="md" value={0} />
              <ScoreDial variant="recovery" size="md" value={7} />
              <ScoreDial variant="strain" size="md" value={0} target={[12, 15]} />
            </View>
          </Frame>
          <Frame name="md, reasons (one ReasonPlaceholder line under the row)">
            <View className="items-center gap-3">
              <View className={ROW}>
                <ScoreDial variant="sleep" size="md" value={null} reason="awaiting_sleep_sync" />
                <ScoreDial variant="recovery" size="md" value={null} reason="calibrating" nightsLeft={4} />
                <ScoreDial variant="strain" size="md" value={null} reason="band_not_worn" />
              </View>
              <ReasonPlaceholder reason="calibrating" nightsLeft={4} size="sm" />
            </View>
          </Frame>
          <Frame name="md, loading">
            <View className={ROW}>
              <ScoreDialSkeleton size="md" />
              <ScoreDialSkeleton size="md" />
              <ScoreDialSkeleton size="md" />
            </View>
          </Frame>
          <Frame name="lg recovery, green, provisional" center><ScoreDial variant="recovery" size="lg" value={85} provisional /></Frame>
          <Frame name="lg recovery, yellow, baseline stale" center><ScoreDial variant="recovery" size="lg" value={58} tags={["stale_baseline"]} /></Frame>
          <Frame name="lg recovery, red, two tags (widest stack)" center><ScoreDial variant="recovery" size="lg" value={8} provisional tags={["stale_baseline"]} /></Frame>
          <Frame name="lg recovery, 100%" center><ScoreDial variant="recovery" size="lg" value={100} /></Frame>
          <Frame name="lg strain, target, So far" center><ScoreDial variant="strain" size="lg" value={13.1} target={[12, 15]} extraTags={["so_far"]} /></Frame>
          <Frame name="lg strain, 0.0 at the start of the day" center><ScoreDial variant="strain" size="lg" value={0} target={[12, 15]} extraTags={["so_far"]} /></Frame>
          <Frame name="lg strain, 21.0 past the target" center><ScoreDial variant="strain" size="lg" value={21} target={[12, 15]} /></Frame>
          <Frame name="lg strain, no target" center><ScoreDial variant="strain" size="lg" value={4.2} /></Frame>
          <Frame name="lg sleep, status bar and Updated (tallest stack)" center><ScoreDial variant="sleep" size="lg" value={84} status="sufficient" tags={["updated"]} /></Frame>
          <Frame name="lg sleep, 100%, optimal" center><ScoreDial variant="sleep" size="lg" value={100} status="optimal" /></Frame>
          <Frame name="lg sleep, 7%, poor, provisional" center><ScoreDial variant="sleep" size="lg" value={7} status="poor" provisional /></Frame>
          <Frame name="lg, every reason code">
            <View className="items-center gap-6">
              {REASON_CODES.map((r) => (
                <ScoreDial key={r} variant={r === "awaiting_sleep_sync" ? "sleep" : r === "insufficient_hr_data" ? "strain" : "recovery"} size="lg" value={null} reason={r} nightsLeft={4} />
              ))}
            </View>
          </Frame>
          <Frame name="lg, loading" center><ScoreDialSkeleton size="lg" variant="recovery" label="Recovery" /></Frame>
          <Frame name="lg gauge (Stress)" center><ScoreDial variant="gauge" size="lg" value={1.5} caption="Last updated 15:05" /></Frame>
          <Frame name="lg gauge, reason" center><ScoreDial variant="gauge" size="lg" value={null} reason="band_not_worn" /></Frame>
          <Frame name="compact (sticky header): recovery, strain, sleep, gauge">
            <View className="flex-row items-center justify-center gap-3">
              <ScoreDial variant="recovery" size="lg" value={85} compact />
              <ScoreDial variant="strain" size="lg" value={13.1} target={[12, 15]} compact />
              <ScoreDial variant="sleep" size="lg" value={100} compact />
              <ScoreDial variant="gauge" size="lg" value={2.4} compact />
            </View>
          </Frame>
          <Frame name="sm stat: forecast, average, reason, loading">
            <View className="flex-row flex-wrap items-start justify-center gap-4">
              <ScoreDial variant="stat" size="sm" value={71} max={100} color="recovery-green" unit="%" label="Tomorrow" extraTags={["estimate"]} />
              <ScoreDial variant="stat" size="sm" value={100} max={100} color="recovery-green" unit="%" label="Best" />
              <ScoreDial variant="stat" size="sm" value={11.2} max={21} color="strain" format="decimal1" label="Avg strain" />
              <ScoreDial variant="stat" size="sm" value={null} reason="calibrating" label="Forecast" />
              <ScoreDialSkeleton size="sm" />
            </View>
          </Frame>
        </Entry>
        <Entry name="MiniRing" file="src/ui/metrics/MiniRing.tsx" use="The 22 px rings in Home's collapsed header." props={["variant: sleep | recovery | strain", "value: number | null", "fill (false draws the track only)"]}>
          <Frame name="Values: 0, mid, max">
            <View className="flex-row flex-wrap items-center justify-center gap-3">
              {(["sleep", "recovery", "strain"] as const).map((v) => [0, v === "strain" ? 10.5 : 50, v === "strain" ? 21 : 100].map((n) => <MiniRing key={`${v}${n}`} variant={v} value={n} />))}
            </View>
          </Frame>
          <Frame name="No value, and track only (before the reveal)" center>
            <View className="flex-row gap-6">
              <MiniRing variant="recovery" value={null} />
              <MiniRing variant="recovery" value={72} fill={false} />
            </View>
          </Frame>
        </Entry>
      </Group>

      <Group title="Rows and lists">
        <Entry name="KeyStatRow" file="src/ui/metrics/KeyStatRow.tsx" use="Home's key statistics and My Dashboard, the detail screens' summary cards, Health Monitor tiles." props={["variant: row | card | tile", "label, icon, caption", "metric: Metric<number>", "unit, format", "average, sd, direction", "status (sleep rows)", "chip (tiles)", "href | onSelect"]}>
          <Frame name="row, vs. 30-day average">
            <View className={ROWS}>
              <Divided>
                {fx.keyStats.map(({ key, ...s }) => <KeyStatRow key={key} variant="row" icon={statIcon(key)} href="/dev/kit" {...s} />)}
                <KeyStatRow variant="row" label="Strain Target" metric={fx.ok(12)} format="decimal1" direction="none" caption="Estimate" />
              </Divided>
            </View>
          </Frame>
          <Frame name="row, sleep status segments">
            <View className={ROWS}>
              <Divided>
                {fx.sleepRows.map(({ key, ...s }) => <KeyStatRow key={key} variant="row" icon={statIcon(key)} unit="%" format="int" direction="none" {...s} />)}
              </Divided>
            </View>
          </Frame>
          <Frame name="row, every reason code">
            <View className={ROWS}>
              <Divided>
                {reasons.map(({ r, metric }) => <KeyStatRow key={r} variant="row" label={r} metric={metric} unit="ms" format="int" direction="up" />)}
              </Divided>
            </View>
          </Frame>
          <Frame name="row, extremes and loading">
            <View className={ROWS}>
              <Divided>
                <KeyStatRow variant="row" label="Steps" metric={fx.ok(104382)} format="grouped" average={9020} sd={1800} direction="up" />
                <KeyStatRow variant="row" label="Skin temperature" metric={fx.ok(-2.4, { provisional: true })} unit="°C" format="signed1" average={0} sd={0.2} direction="toward_zero" />
                <KeyStatRow variant="row" label="Heart rate variability" metric={fx.ok(0)} unit="ms" format="int" average={98} sd={11} direction="up" />
                <KeyStatRow variant="row" label="Loading" metric={undefined} format="int" direction="up" />
              </Divided>
            </View>
          </Frame>
          <Frame name="card (My Dashboard)">
            <View className="gap-2">
              <KeyStatRow variant="card" icon={statIcon("hrv")} label="Heart rate variability" metric={fx.ok(124)} unit="ms" format="int" average={98} sd={11} direction="up" href="/dev/kit" />
              <KeyStatRow variant="card" icon={statIcon("spo2")} label="Blood oxygen" metric={fx.why<number>("band_not_worn")} unit="%" format="int" average={97} direction="up" href="/dev/kit" />
            </View>
          </Frame>
          <Frame name="row at 320 px" narrow>
            <View className={ROWS}>
              <Divided>
                {fx.keyStats.slice(0, 4).map(({ key, ...s }) => <KeyStatRow key={key} variant="row" icon={statIcon(key)} {...s} />)}
              </Divided>
            </View>
          </Frame>
          <Frame name="tile: chips, out of range, reason, provisional, vs. average, loading, selectable">
            <View className="flex-row flex-wrap gap-3">
              {[...fx.vitals.map(({ key, ...v }) => <KeyStatRow key={key} variant="tile" icon={statIcon(key, 1.5)} direction="neutral" {...v} />), ...fx.activityTiles.map(({ key, ...v }) => <KeyStatRow key={key} variant="tile" icon={statIcon(key, 1.5)} {...v} />), <KeyStatRow key="loading" variant="tile" label="Loading" metric={undefined} format="int" direction="up" />, <SelectableTile key="sel" />].map((tile, i) => (
                <View key={i} className="w-[48%]">{tile}</View>
              ))}
            </View>
          </Frame>
          <Frame name="wide tile with a sparkline, and a wide tile with a range">
            <View className="gap-3">
              <KeyStatRow variant="tile" wide icon={statIcon("rhr", 1.5)} label="Resting heart rate" metric={fx.ok(58)} unit="bpm" format="int" direction="neutral" chip={{ tone: "warning", text: "above 50 - 54" }} spark={{ values: [52, 51, 53, null, 54, 56, 55, 58], band: { low: 50, high: 54 }, caption: "7 days" }} />
              <KeyStatRow variant="tile" wide icon={statIcon("hrv", 1.5)} label="Heart rate variability" metric={fx.ok(124)} unit="ms" format="int" average={98} sd={11} direction="up" />
            </View>
          </Frame>
        </Entry>
        <Entry name="Sparkline" file="src/ui/metrics/Sparkline.tsx" use="A small line of recent values with the normal range shaded and the latest value dotted (wide KeyStatRow tiles)." props={["values: (number | null)[]", "band: { low, high }", "color", "caption"]}>
          <Frame name="with a gap and a band"><Sparkline className="h-16" values={[52, 51, 53, null, 54, 56, 55, 58]} band={{ low: 50, high: 54 }} caption="7 days" color={c["foreground-secondary"]} /></Frame>
        </Entry>
        <Entry name="ContributorRow" file="src/ui/metrics/ContributorRow.tsx" use="Recovery's contributors (value against your normal range) and Healthspan's contributors (years added or removed)." props={["variant: recovery | healthspan", "label, icon, metric, unit, format", "recovery: baseline, points, direction", "healthspan: domain, years, higherIsBetter, recent, onSelect"]}>
          <Frame name="recovery, with the legend and a skeleton row">
            <Card className="gap-0 px-4 py-1">
              <Divided>
                {fx.contributors.map(({ key, ...ct }) => <ContributorRow key={key} variant="recovery" icon={statIcon(key)} {...ct} />)}
                <ContributorRow.Skeleton />
              </Divided>
              <View className="my-3 rounded-lg bg-inset px-3 py-2"><Text className="text-xs font-medium leading-4 text-foreground-secondary">Dot: today. Shaded: your normal range.</Text></View>
            </Card>
          </Frame>
          <Frame name="healthspan, selectable (opens a sheet)"><Card className="gap-0 px-4 py-1"><HealthspanList /></Card></Frame>
          <Frame name="recovery, every reason code and extremes">
            <Card className="gap-0 px-4 py-1">
              <Divided>
                {reasons.map(({ r, metric }) => <ContributorRow key={r} variant="recovery" label={r} metric={metric} unit="ms" format="int" baseline={{ mean: 98, sd: 11 }} points={null} direction="up" />)}
                <ContributorRow variant="recovery" label="Far above normal" metric={fx.ok(240)} unit="ms" format="int" baseline={{ mean: 98, sd: 11 }} points={24} direction="up" />
                <ContributorRow variant="recovery" label="Far below normal" metric={fx.ok(12)} unit="ms" format="int" baseline={{ mean: 98, sd: 11 }} points={-31} direction="up" />
              </Divided>
            </Card>
          </Frame>
          <Frame name="recovery at 320 px" narrow>
            <Card className="gap-0 px-4 py-1">
              <Divided>{fx.contributors.slice(0, 3).map(({ key, ...ct }) => <ContributorRow key={key} variant="recovery" icon={statIcon(key)} {...ct} />)}</Divided>
            </Card>
          </Frame>
        </Entry>
        <Entry name="DriverList" file="src/ui/metrics/DriverList.tsx" use="Recovery's “What shaped it” and Journal Insights' behaviour impacts." props={["variant: recovery | impact", "unit: pts | % | SD", "data: Metric<DriverItem[]>", "selectedKey, onSelect", "outcome"]}>
          <Frame name="recovery"><DriverList variant="recovery" unit="pts" data={fx.recoveryDrivers} /></Frame>
          <Frame name="impact, provisional, selectable"><SelectableImpact /></Frame>
          <Frame name="empty (recovery)"><DriverList variant="recovery" unit="pts" data={null} /></Frame>
          <Frame name="empty (impact): check in prompt"><DriverList variant="impact" unit="%" data={fx.ok([])} /></Frame>
          <Frame name="every reason code">
            <View className="gap-4">{REASON_CODES.map((r) => <DriverList key={r} variant="recovery" unit="pts" data={fx.why(r, 4)} />)}</View>
          </Frame>
          <Frame name="loading"><DriverList variant="recovery" unit="pts" data={undefined} /></Frame>
          <Frame name="recovery at 320 px" narrow><DriverList variant="recovery" unit="pts" data={fx.recoveryDrivers} /></Frame>
        </Entry>
        <Entry name="TickScale" file="src/ui/metrics/TickScale.tsx" use="Healthspan's Pace of Aging and Strain's training load (marker), Home's Energy Bank (meter)." props={["variant: marker | meter", "label, metric, min, max, format, unit", "bands (marker)", "ends, leading, trailing", "describe"]}>
          <Frame name="marker: Pace of Aging">
            <TickScale variant="marker" label="Pace of Aging" metric={fx.ok(0.8)} min={-1} max={3} format="decimal1" unit="x" describe="aging slower than your 6-month average" ends={["−1.0x", "1.0x", "3.0x"]}
              leading={<><Icon icon={Turtle} size={16} tone="foreground-secondary" strokeWidth={1.75} /><Text className="text-[15px] leading-[22px] text-foreground-secondary">Slow</Text></>}
              trailing={<><Text className="text-[15px] leading-[22px] text-foreground-secondary">Fast</Text><Icon icon={Rabbit} size={16} tone="foreground-secondary" strokeWidth={1.75} /></>} />
          </Frame>
          <Frame name="marker with bands (ACWR), provisional">
            <TickScale variant="marker" label="Training load" metric={fx.ok(1.12, { provisional: true })} min={0} max={2} format="decimal2" bands={[{ from: 0.8, to: 1.3, tone: "optimal" }, { from: 1.5, to: 2, tone: "warning" }]} ends={["0.0", "1.0", "2.0"]} />
          </Frame>
          <Frame name="meter: 0, 24, 62, 100">
            <View className="gap-4">{[0, 24, 62, 100].map((v) => <TickScale key={v} variant="meter" label="Energy" metric={fx.ok(v)} min={0} max={100} format="int" unit="%" />)}</View>
          </Frame>
          <Frame name="marker past both ends">
            <View className="gap-4">
              <TickScale variant="marker" label="Pace of Aging" metric={fx.ok(-1.6)} min={-1} max={3} format="decimal1" unit="x" ends={["−1.0x", "3.0x"]} />
              <TickScale variant="marker" label="Pace of Aging" metric={fx.ok(3.4)} min={-1} max={3} format="decimal1" unit="x" ends={["−1.0x", "3.0x"]} />
            </View>
          </Frame>
          <Frame name="every reason code, then loading">
            <View className="gap-4">
              {reasons.map(({ r, metric }) => <TickScale key={r} variant="meter" label="Energy" metric={metric} min={0} max={100} format="int" unit="%" />)}
              <TickScale variant="meter" label="Energy" metric={undefined} min={0} max={100} format="int" unit="%" />
              <TickScale variant="marker" label="Pace of Aging" metric={undefined} min={-1} max={3} format="decimal1" />
            </View>
          </Frame>
          <Frame name="meter at 320 px" narrow><TickScale variant="meter" label="Energy" metric={fx.ok(62)} min={0} max={100} format="int" unit="%" /></Frame>
        </Entry>
        <Entry name="DayStrip" file="src/ui/metrics/DayStrip.tsx" use="Home's recovery strip and Journal's check-in strip: the last 30 days. It writes the route's d param (or calls onSelect)." props={["indicator: recovery | journal", "days: { date, recovery?, done? }[]", "variant: tile | pill", "value, onSelect"]}>
          <Frame name="recovery"><DayStrip indicator="recovery" days={fx.stripDays} /></Frame>
          <Frame name="journal"><DayStrip indicator="journal" days={fx.stripDays} /></Frame>
          <Frame name="journal, pill (Journal)"><DayStrip indicator="journal" variant="pill" days={fx.stripDays} /></Frame>
          <Frame name="recovery, no scores yet"><DayStrip indicator="recovery" days={fx.stripDays.map((d) => ({ ...d, recovery: null }))} /></Frame>
          <Frame name="loading"><DayStripSkeleton /></Frame>
        </Entry>
      </Group>

      <Group title="Cards">
        <Entry name="InsightCard" file="src/ui/metrics/InsightCard.tsx" use="The coach card under Recovery, Strain, Sleep, Stress and Healthspan heroes, and Home's day banner." props={["title?", "body", "action?: { label, href }"]}>
          <Frame name="title, body, action"><InsightCard {...fx.insight} /></Frame>
          <Frame name="body only"><InsightCard body="Early estimate: your Pace of Aging slowed by 0.4x this week, mostly from VO2 max." /></Frame>
          <Frame name="loading"><InsightCard.Skeleton title action /></Frame>
          <Frame name="long copy at 320 px" narrow><InsightCard title="Recovery is lower than usual" body="Your resting heart rate is 6 bpm above your baseline and HRV is down by a fifth, after a late, short night. Light movement and an early night help most." action={{ label: "See what shaped it", href: "#drivers" }} /></Frame>
        </Entry>
        <Entry name="ActivityCard" file="src/ui/metrics/ActivityCard.tsx" use="Home's “Today's activities” and Strain's activity list; links to /activity/[id]." props={["name, kind: run | ride | walk | strength | workout", "strain: Metric<number>", "start, end, timeZone", "distanceKm, paceS", "href"]}>
          <Frame name="run with pace, strength without strain (reason), ride, workout">
            <View className="gap-1.5">
              <ActivityCard {...fx.timeline.run} href="/dev/kit" timeZone={fx.TZ} />
              <ActivityCard {...fx.timeline.strength} href="/dev/kit" timeZone={fx.TZ} />
              <ActivityCard name="Cycling" kind="ride" strain={fx.ok(21)} start={fx.DAY0 + 6 * HOUR} end={fx.DAY0 + 9 * HOUR + 42 * 60_000} href="/dev/kit" timeZone={fx.TZ} />
              <ActivityCard name="Workout" kind="workout" strain={fx.ok(0)} start={fx.DAY0 + 20 * HOUR} end={fx.DAY0 + 20 * HOUR + 4 * 60_000} href="/dev/kit" timeZone={fx.TZ} />
            </View>
          </Frame>
          <Frame name="loading"><ActivityCard.Skeleton /></Frame>
          <Frame name="long name at 320 px" narrow><ActivityCard name="High-intensity interval training" kind="workout" strain={fx.ok(14.6)} start={fx.DAY0 + 17 * HOUR} end={fx.DAY0 + 18 * HOUR} href="/dev/kit" timeZone={fx.TZ} distanceKm={12.04} paceS={298} /></Frame>
        </Entry>
        <Entry name="SleepCard" file="src/ui/metrics/SleepCard.tsx" use="Sleeps and naps on Home's day timeline; links to /sleep?d=." props={["kind: sleep | nap", "minutes", "start, end, timeZone", "href"]}>
          <Frame name="sleep and nap">
            <View className="gap-1.5">
              <SleepCard {...fx.timeline.sleep} href="/dev/kit" timeZone={fx.TZ} />
              <SleepCard {...fx.timeline.nap} href="/dev/kit" timeZone={fx.TZ} />
            </View>
          </Frame>
          <Frame name="loading"><SleepCard.Skeleton /></Frame>
          <Frame name="a 13-hour sleep at 320 px" narrow><SleepCard kind="sleep" minutes={781} start={fx.DAY0 - 2 * HOUR} end={fx.DAY0 + 11 * HOUR} href="/dev/kit" timeZone={fx.TZ} /></Frame>
        </Entry>
        <Entry name="SleepStages" file="src/ui/metrics/SleepStages.tsx" use="Sleep's “Last night's sleep” card: hours hero, overnight heart rate and the stage rows." props={["hours: Metric<SleepHours>", "hr: Metric<SleepHr>", "data: Metric<SleepStagesNight> | null", "restorative"]}>
          <Frame name="a staged night"><SleepStages hours={fx.sleepHours} hr={fx.ok(fx.sleepHr)} data={fx.ok(fx.sleepStagesNight)} restorative={fx.ok({ minutes: 195, average: 180, sd: 20 })} /></Frame>
          <Frame name="unstaged night (data null)"><SleepStages hours={fx.sleepHours} hr={fx.ok(fx.sleepHr)} data={null} /></Frame>
          <Frame name="no heart rate"><SleepStages hours={fx.sleepHours} hr={fx.why("insufficient_hr_data")} data={fx.ok(fx.sleepStagesNight)} /></Frame>
          <Frame name="every reason code (the whole card)">
            <View className="gap-2">{REASON_CODES.map((r) => <SleepStages key={r} hours={fx.why(r, 4)} hr={undefined} data={undefined} />)}</View>
          </Frame>
          <Frame name="loading"><SleepStages hours={undefined} hr={undefined} data={undefined} /></Frame>
          <Frame name="at 320 px" narrow><SleepStages hours={fx.sleepHours} hr={fx.ok(fx.sleepHr)} data={fx.ok(fx.sleepStagesNight)} /></Frame>
        </Entry>
        <Entry name="ReasonPlaceholder" file="src/ui/metrics/ReasonPlaceholder.tsx" use="Every reason state, through MetricState: sm in rows, md in cards, lg for a whole screen." props={["reason: any string (unknown falls back to no_data)", "nightsLeft", "size: sm | md | lg", "copy (screen's own wording)"]}>
          <Frame name="sm, every reason code"><View className="gap-3">{REASON_CODES.map((r) => <ReasonPlaceholder key={r} reason={r} nightsLeft={4} size="sm" />)}</View></Frame>
          <Frame name="md, every reason code"><View className="gap-4">{REASON_CODES.map((r) => <ReasonPlaceholder key={r} reason={r} nightsLeft={1} size="md" />)}</View></Frame>
          <Frame name="lg"><ReasonPlaceholder reason="no_hrv_last_night" size="lg" /></Frame>
          <Frame name="unknown code, custom copy">
            <View className="gap-3">
              <ReasonPlaceholder reason="unknown_code" size="md" />
              <ReasonPlaceholder reason="calibrating" size="sm" copy="Forecast starts after 14 nights." />
            </View>
          </Frame>
        </Entry>
      </Group>

      <Group title="Trend View parts">
        <Entry name="BreakdownBar" file="src/ui/metrics/BreakdownBar.tsx" use="A Trend View breakdown: one segmented bar and a row per band." props={["title", "unit: days | duration", "items: { key, label, detail?, value }[]"]}>
          <Frame name="strain bands (days)"><BreakdownBar title="Strain breakdown (days)" unit="days" items={[{ key: "all_out", label: "All out", detail: "18+", value: 1 }, { key: "strenuous", label: "Strenuous", detail: "14-17", value: 4 }, { key: "moderate", label: "Moderate", detail: "10-13", value: 12 }, { key: "light", label: "Light", detail: "0-9", value: 0 }]} /></Frame>
          <Frame name="HR zones (duration)"><BreakdownBar title="Time in zones (h:mm)" unit="duration" items={[{ key: "z1", label: "Zone 1", value: 117 }, { key: "z2", label: "Zone 2", value: 64 }, { key: "z3", label: "Zone 3", value: 21 }]} /></Frame>
        </Entry>
        <Entry name="TrendLegend" file="src/ui/metrics/TrendLegend.tsx" use="The legend over a Trend View chart: typical-range swatch, square swatches for a stack, rings for a pair." props={["chart: stack | pair", "series", "typical"]}>
          <Frame name="typical range, stack, pair">
            <View className="gap-1">
              <TrendLegend chart="line" typical />
              <TrendLegend chart="stack" series={[{ key: "z1", label: "Zone 1" }, { key: "z2", label: "Zone 2" }, { key: "z3", label: "Zone 3" }]} />
              <TrendLegend chart="pair" series={[{ key: "optimal", label: "Recovery" }, { key: "strain", label: "Strain" }]} />
            </View>
          </Frame>
        </Entry>
      </Group>
    </KitScreen>
  );
}
