import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { BookOpen, CalendarRange, ChevronRight, Code, HeartPulse, Maximize2, Timer } from "lucide-react-native";
import { REASON_CODES, type Metric } from "@/lib/reasons";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { Mark, Wordmark } from "@/ui/brand";
import * as fx from "@/ui/fixtures/kit";
import { Entry, Frame, Group, KitScreen } from "@/ui/kit/KitScreen";
import { DeltaMark, MetricTags, StatusChip, Tag, ValueUnit } from "@/ui/metrics/primitives";
import type { TokenName } from "@/ui/palette";
import { Segmented } from "@/ui/Segmented";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { CollapsibleSection } from "@/ui/shells/CollapsibleSection";
import { DateSwitcher } from "@/ui/shells/DateSwitcher";
import { EmptyState } from "@/ui/shells/EmptyState";
import { InfoButton } from "@/ui/shells/InfoButton";
import { LinkList } from "@/ui/shells/LinkList";
import { MetricState } from "@/ui/shells/MetricState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

const go = (href: string) => router.push(href as Href);
const INFO = { title: "What shaped it", body: "Each bar is one input's effect on today's Recovery, in points." };
const BODY = "text-[15px] leading-[22px] text-foreground-secondary";

const SCREENS = [
  { href: "/dev/kit/metrics", label: "Metrics", note: "ScoreDial, KeyStatRow, MetricState states, InsightCard, DayStrip and the rest" },
  { href: "/dev/kit/charts", label: "Charts", note: "The nine Skia charts, every state" },
  { href: "/dev/kit/home", label: "Home demo", note: "PageShell with the collapsing Home header" },
  { href: "/dev/kit/detail", label: "Detail demo", note: "DetailShell with the collapsing hero header" },
] as const;

const metricStates: [string, Metric<number> | null | undefined][] = [
  ["loading", undefined],
  ["empty", null],
  ["provisional", fx.ok(58, { provisional: true })],
  ["value", fx.ok(72, { tags: ["updated"] })],
  ["non-finite", fx.ok(Number.NaN)],
  ...REASON_CODES.map((r): [string, Metric<number>] => [r, fx.why<number>(r, 4)]),
];

/** The token swatches, grouped as the web's globals.css groups them. */
const SWATCHES: { title: string; tokens: TokenName[] }[] = [
  { title: "Ground and surfaces", tokens: ["background-top", "background-mid", "background", "card", "card-hover", "popover", "sheet", "inset", "field", "muted", "secondary", "accent"] },
  { title: "Text", tokens: ["foreground", "foreground-secondary", "muted-foreground", "primary", "primary-foreground", "destructive"] },
  { title: "Recovery, strain, sleep", tokens: ["recovery-green", "recovery-yellow", "recovery-red", "recovery-red-text", "strain", "strain-text", "strain-deep", "sleep", "sleep-deep", "optimal", "optimal-text", "warning", "warning-text"] },
  { title: "Stress and coach", tokens: ["stress-low", "stress-medium", "stress-high", "coach", "coach-text", "insight-from", "insight-to", "banner-from", "banner-to"] },
  { title: "Charts and stages", tokens: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "stage-awake", "stage-rem", "stage-light", "stage-deep", "energy-active", "energy-resting", "dial-track", "dial-target", "strain-band-1", "strain-band-2", "strain-band-3", "strain-band-4"] },
];

function Swatches() {
  const { c } = useTheme();
  return (
    <View className="gap-4">
      {SWATCHES.map((g) => (
        <View key={g.title} className="gap-2">
          <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{g.title}</Text>
          <View className="flex-row flex-wrap gap-2">
            {g.tokens.map((t) => (
              <View key={t} className="w-[100px] gap-1">
                <View className="h-9 rounded-lg border border-border" style={{ backgroundColor: c[t] }} />
                <Text className="text-[10px] leading-3 text-muted-foreground">{t}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const TYPE = [
  ["text-[28px] leading-9 font-semibold", "Screen title 28"],
  ["text-[22px] leading-7 font-semibold", "Section title 22"],
  ["text-[17px] leading-6 font-semibold", "Card title 17"],
  ["text-[15px] leading-[22px]", "Body 15, the copy you read"],
  ["text-[13px] leading-[18px] text-muted-foreground", "Caption 13, muted"],
  ["text-xs leading-4 font-bold uppercase tracking-[0.1em]", "Label 12 caps"],
] as const;

function SheetDemo() {
  return (
    <View className="flex-row flex-wrap gap-2">
      <Button variant="secondary" onPress={() => go("/dev/sheet?size=default")}>Open sheet</Button>
      <Button variant="secondary" onPress={() => go("/dev/sheet?size=tall")}>Open tall sheet</Button>
      <Button variant="secondary" onPress={() => go("/dev/sheet?size=screen")}>Open screen sheet</Button>
    </View>
  );
}

function SegmentedDemo() {
  const [value, setValue] = useState("recovery");
  return <Segmented label="Outcome" value={value} onChange={setValue} options={[{ value: "recovery", label: "RECOVERY" }, { value: "hrv", label: "HRV" }, { value: "sleep", label: "SLEEP" }]} textClassName="text-[13px] font-bold tracking-[0.06em]" />;
}

export default function Kit() {
  return (
    <KitScreen title="Component kit" blurb="The UI every screen is built from, ported from pulse's web kit (src/app/dev/kit) with the same sample props. Compare each frame with the web page at /dev/kit, in light and in dark.">
      <View className="gap-2">
        {SCREENS.map((s) => (
          <Pressable key={s.href} accessibilityRole="link" onPress={() => go(s.href)} className="flex-row items-center gap-3 rounded-xl bg-card px-4 py-3 active:scale-[0.98]">
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em]">{s.label}</Text>
              <Text className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{s.note}</Text>
            </View>
            <Icon icon={ChevronRight} size={20} tone="muted-foreground" />
          </Pressable>
        ))}
      </View>

      <Group title="Foundations" blurb="Tokens, type and the brand marks. Colours here come from the theme tokens in global.css.">
        <Entry name="Colour tokens" file="global.css, tailwind.config.js, src/ui/palette.ts" use="Every token of the web&apos;s globals.css, light and dark. Flip the toggle: each swatch follows.">
          <Frame name="swatches"><Swatches /></Frame>
        </Entry>
        <Entry name="Type" file="app/_layout.tsx, src/ui/Text.tsx" use="Figtree for text, Barlow for numerals (the web's pairing). Numerals use font-numeric and tabular figures.">
          <Frame name="the scale">
            <View className="gap-3">
              {TYPE.map(([cls, text]) => (
                <Text key={text} className={cls}>{text}</Text>
              ))}
              <Text className="font-numeric text-[34px] font-bold leading-10 tabular-nums">124 ms · 0123456789</Text>
              <Text className="font-numeric text-xl font-semibold leading-7 tabular-nums">7:42 · 09:05 · 12,459</Text>
            </View>
          </Frame>
        </Entry>
        <Entry name="Wordmark, Mark" file="src/ui/brand.tsx" use="The wordmark inside every large ScoreDial and the app mark. Never PULSE set in a font." props={["Wordmark height, weight: bold | black", "Mark size, color: brand | mono"]}>
          <Frame name="wordmark at 15, 17 and 40 px; mark at 16, 24 and 48" center>
            <View className="items-center gap-4">
              <Wordmark height={15} tone="foreground-secondary" />
              <Wordmark height={17} />
              <Wordmark height={40} weight="black" />
              <View className="flex-row items-end gap-4">
                <Mark size={16} />
                <Mark size={24} />
                <Mark size={48} />
                <Mark size={48} color="mono" tone="foreground-secondary" />
              </View>
            </View>
          </Frame>
        </Entry>
        <Entry name="Button" file="src/ui/Button.tsx" use="The touch sizes: text buttons in content and sheets, the sheet footer pills." props={["variant: default | outline | secondary | ghost | outline-pill", "size: touch | icon-touch | sheet"]}>
          <Frame name="variants">
            <View className="flex-row flex-wrap gap-2">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline-pill" className="px-5">Outline</Button>
              <Button variant="secondary" disabled>Disabled</Button>
            </View>
          </Frame>
        </Entry>
        <Entry name="Segmented" file="src/ui/Segmented.tsx" use="The W / M / 6M range control, the Journal Insights outcome switch, the stages tabs.">
          <Frame name="outcome"><SegmentedDemo /></Frame>
        </Entry>
        <Entry name="Tag, MetricTags, StatusChip, DeltaMark, ValueUnit" file="src/ui/metrics/primitives.tsx" use="The small marks every kit component shares: status tags, range chips, delta arrows and value-unit pairs." props={["Tag kind", "MetricTags provisional, tags, extra", "StatusChip tone: optimal | warning | alert | neutral, delta", "DeltaMark dir, tone", "ValueUnit value, unit"]}>
          <Frame name="tags (one look per meaning, never coloured)">
            <View className="flex-row flex-wrap gap-2">
              {(["provisional", "stale_baseline", "updated", "so_far", "partial_week", "partial_month", "estimate"] as const).map((k) => <Tag key={k} kind={k} />)}
            </View>
          </Frame>
          <Frame name="MetricTags (wraps and centres)" narrow><MetricTags provisional tags={["stale_baseline", "updated"]} extra={["so_far"]} /></Frame>
          <Frame name="StatusChip tones and a delta">
            <View className="flex-row flex-wrap gap-2">
              <StatusChip tone="optimal">within 16.1 - 16.9</StatusChip>
              <StatusChip tone="warning">Out of range</StatusChip>
              <StatusChip tone="alert">Illness signal</StatusChip>
              <StatusChip tone="neutral" delta="up">151 bpm</StatusChip>
            </View>
          </Frame>
          <Frame name="DeltaMark: good, bad, neutral, flat">
            <View className="flex-row items-center gap-4">
              <DeltaMark dir="up" tone="good" />
              <DeltaMark dir="down" tone="bad" />
              <DeltaMark dir="up" tone="neutral" />
              <DeltaMark dir="flat" tone="neutral" />
            </View>
          </Frame>
          <Frame name="ValueUnit: word unit, symbol unit, missing">
            <View className="flex-row flex-wrap items-baseline gap-6">
              <ValueUnit value="124" unit="ms" className="font-numeric text-xl font-bold" />
              <ValueUnit value="97" unit="%" className="font-numeric text-xl font-bold" />
              <ValueUnit value="--" unit="bpm" className="font-numeric text-xl font-bold text-muted-foreground" />
            </View>
          </Frame>
        </Entry>
        <Entry name="Skeleton, SkeletonText" file="src/ui/Skeleton.tsx" use="The bars inside a component's own box while it loads (spec §5.19)." props={["SkeletonText lh, fs, className (width)"]}>
          <Frame name="bars">
            <View className="gap-2">
              <Skeleton className="h-11" />
              <SkeletonText className="w-40" lh={22} fs={16} />
              <SkeletonText className="w-full" lh={22} fs={15} />
            </View>
          </Frame>
        </Entry>
      </Group>

      <Group title="Shells" blurb="Layout and chrome. Feature code composes these. The tab bar is the one at the foot of the app's tab screens; the headers are in the two demo screens above.">
        <Entry name="SectionShell" file="src/ui/shells/SectionShell.tsx" use="Every titled block: page-level sections and cards, with info, a View all link or a whole-card link." props={["variant: section | card", "title, info", "action: { label, href } | node", "aside", "href (whole-card link)", "fill"]}>
          <Frame name="section with aside and action">
            <SectionShell variant="section" title="Key statistics" aside="vs. 30-day average" action={{ label: "View all", href: "/dev/kit/metrics" }}>
              <Text className={BODY}>Section body.</Text>
            </SectionShell>
          </Frame>
          <Frame name="card with info and an icon action">
            <SectionShell variant="card" title="Today's activities" info={INFO} action={<Pressable accessibilityRole="link" accessibilityLabel="Open Strain" onPress={() => go("/dev/kit/metrics")} className="-my-2 -mr-2 size-10 items-center justify-center rounded-full"><Icon icon={Maximize2} size={18} tone="foreground-secondary" /></Pressable>}>
              <Text className={BODY}>Card body.</Text>
            </SectionShell>
          </Frame>
          <Frame name="whole-card link, tags aside">
            <SectionShell variant="card" title="Energy Bank" href="/dev/kit/charts" aside={<MetricTags provisional />}>
              <Text className={BODY}>The whole card presses in.</Text>
            </SectionShell>
          </Frame>
          <Frame name="long title at 320 px" narrow>
            <SectionShell variant="card" title="Heart rate variability during sleep" info={INFO} action={{ label: "View all", href: "/dev/kit/metrics" }}>
              <Text className={BODY}>Card body.</Text>
            </SectionShell>
          </Frame>
        </Entry>
        <Entry name="CollapsibleSection" file="src/ui/shells/CollapsibleSection.tsx" use="A page section whose body folds away (Home's Key statistics)." props={["id, title", "defaultOpen", "action", "onToggle"]}>
          <Frame name="open, then closed">
            <View className="gap-4">
              <CollapsibleSection id="a" title="Open section" action={<Text className="text-xs font-medium text-muted-foreground">See all</Text>}><Text className={BODY}>Folds away when you tap the title.</Text></CollapsibleSection>
              <CollapsibleSection id="b" title="Closed section" defaultOpen={false}><Text className={BODY}>Hidden until opened.</Text></CollapsibleSection>
            </View>
          </Frame>
        </Entry>
        <Entry name="EmptyState" file="src/ui/shells/EmptyState.tsx" use="Lists and screens with nothing to show yet, and error screens with a retry." props={["body (one line)", "icon", "action: { label, href | sheet | onClick }"]}>
          <Frame name="icon and action"><EmptyState icon={Timer} body="Couldn't load this screen." action={{ label: "Try again", href: "/dev/kit" }} /></Frame>
          <Frame name="body only"><EmptyState body="No activities yet today. Workouts appear after Fitbit syncs them." /></Frame>
          <Frame name="at 320 px" narrow><EmptyState icon={CalendarRange} body="No data for this week." action={{ label: "Open this week", href: "/dev/kit" }} /></Frame>
        </Entry>
        <Entry name="MetricState" file="src/ui/shells/MetricState.tsx" use="The only branch on data state: loading, empty, reason, provisional, value. Every metric renders through it." props={["metric: Metric<T> | null | undefined", "skeleton", "empty", "reasonSize: sm | md | lg", "renderReason", "children(value, meta)"]}>
          <Frame name="every state, sm reasons">
            <View className="gap-2">
              {metricStates.map(([name, metric]) => (
                <View key={name} className="min-h-8 flex-row items-center justify-between gap-3">
                  <Text className="text-[15px] leading-[22px] text-muted-foreground">{name}</Text>
                  <MetricState metric={metric} skeleton={<Skeleton className="h-4 w-12 rounded-sm" />} reasonSize="sm" empty={<Text className="text-[15px] text-muted-foreground">No history</Text>}>
                    {(v, meta) => (
                      <View className="flex-row items-center gap-2">
                        <Text className="font-numeric font-bold tabular-nums">{`${v}%`}</Text>
                        <MetricTags provisional={meta.provisional} tags={meta.tags} />
                      </View>
                    )}
                  </MetricState>
                </View>
              ))}
            </View>
          </Frame>
        </Entry>
        <Entry name="DateSwitcher" file="src/ui/shells/DateSwitcher.tsx" use="The date pill (Home, Journal, Reports) and the in-header date title (Recovery, Strain, Sleep); opens the month calendar. It writes the route's d param." props={["mode: day | week", "placement: body | header", "calendar: recovery | strain | sleep", "narrow", "steppers"]}>
          <Frame name="day pill" center><DateSwitcher mode="day" /></Frame>
          <Frame name="week pill" center><DateSwitcher mode="week" /></Frame>
          <Frame name="header title (Strain calendar)" center><DateSwitcher mode="day" placement="header" calendar="strain" /></Frame>
          <Frame name="narrow pill at 320 px" narrow center><DateSwitcher mode="day" narrow /></Frame>
        </Entry>
        <Entry name="InfoButton, InfoDialog" file="src/ui/shells/InfoButton.tsx" use="Every “i”: card headers (card) and detail headers (header). Opens the centred info card over the dim, as the web." props={["info: { title, body, icon?, chip?, action? }", "label", "variant: card | header"]}>
          <Frame name="card" center><InfoButton variant="card" label="What shaped it" info={INFO} /></Frame>
          <Frame name="header, with icon, chip and action" center>
            <InfoButton variant="header" label="Respiratory rate" info={{ title: "Respiratory rate", icon: <Icon icon={HeartPulse} size={28} tone="foreground-secondary" strokeWidth={1.5} />, chip: { tone: "optimal", text: "Within 14.1 - 16.9" }, body: <Text className="text-[15px] leading-[22px] text-foreground/85">Breaths per minute while you sleep, against your own normal range.</Text>, action: { label: "Open trend view", href: "/dev/kit/charts" } }} />
          </Frame>
        </Entry>
        <Entry name="LinkList" file="src/ui/shells/LinkList.tsx" use="More, Settings and the Reports archive: a caps group label over 56 px rows." props={["title", "rows: { label, href, icon?, aside?, description?, external? }[]"]}>
          <Frame name="icons, aside, description, external">
            <LinkList title="Learn" rows={[{ label: "How Pulse works", href: "/dev/kit", icon: BookOpen, description: "How each score is made" }, { label: "Weekly report", href: "/dev/kit", icon: CalendarRange, aside: "Sep 22 - Sep 28" }, { label: "Source code", href: "https://github.com/adityaongit", icon: Code, external: true }]} />
          </Frame>
          <Frame name="long label at 320 px" narrow><LinkList title="Data" rows={[{ label: "Export everything Pulse has stored", href: "/dev/kit", icon: BookOpen, aside: "CSV" }]} /></Frame>
        </Entry>
        <Entry name="SheetScreen" file="src/ui/shells/SheetScreen.tsx" use="Every sheet: a route presented by the platform (iOS form sheet, Android bottom sheet) for a task: journal entries, vitals, contributors; or a modal for a full-screen task. Replaces the web's Vaul drawer. Routes: app/(sheets)/, see sheets.ts." props={["title, description", "footer", "size: default | tall | screen", "glow, action, done"]}>
          <Frame name="default, tall and screen (opens)"><SheetDemo /></Frame>
        </Entry>
        <Entry name="Page shells" file="src/ui/shells/" use="Shells that only render as a whole page. Each one is live somewhere.">
          <Frame name="where to see each one">
            <View className="gap-3">
              {[["TabBar", "The glass tab bar and the round action", "The foot of the app's tab screens"], ["PageShell, TitleHeader", "Tab roots: header, content", "Health, Journal, More tabs"], ["HomeHeader", "Home's collapsing header and ring row", "Home demo"], ["DetailShell, DetailHeader, CollapsingHeader", "Detail screens: hero, notch, summary", "Detail demo"], ["CalendarPanel", "The month calendar behind the date pill", "Open a date pill above"]].map(([n, w, where]) => (
                <View key={n} className="gap-0.5">
                  <Text className="text-[13px] font-semibold leading-5">{n}</Text>
                  <Text className="text-[13px] leading-5 text-foreground-secondary">{w}</Text>
                  <Text className={cn("text-[13px] leading-5 text-muted-foreground")}>{where}</Text>
                </View>
              ))}
            </View>
          </Frame>
        </Entry>
      </Group>
    </KitScreen>
  );
}
