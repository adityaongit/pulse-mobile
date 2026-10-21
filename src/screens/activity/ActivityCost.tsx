// Activity Cost (what each kind of workout costs next-morning Recovery, and how long it takes to come back) and detected
// activities (sustained raised heart rate with no workout recorded), from halo src/screens/detail/ActivityCost.tsx (its
// fields and copy) drawn with Pulse's kit. The wording lives in src/queries/activityCost.ts.
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react-native";
import type { DeltaDir, Tone } from "@/lib/bands";
import { clock, formatValue, MISSING } from "@/lib/format";
import { baselineText, bounceText, costCaption, costSentence, costTone, costValue } from "@/queries/activityCost";
import type { ActivityCostEntry, ActivityCostVM, ActivityVM, DetectedItem } from "@/queries/types";
import { Card, SECONDARY_ROW } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Divided } from "@/ui/Divided";
import { Icon } from "@/ui/Icon";
import { ACTIVITY_ICON } from "@/ui/icons";
import { CAPTION, DeltaMark, LABEL } from "@/ui/metrics/primitives";
import { Text } from "@/ui/Text";
import { HERO, LINE, StatRow } from "@/screens/strain/TrainingCards";

/** The change's direction as KeyStatRow marks it: a dip is down and bad, a lift up and good, barely any a dot. */
const MARK: Record<ReturnType<typeof costTone>, { dir: DeltaDir; tone: Tone }> = { cost: { dir: "down", tone: "bad" }, lift: { dir: "up", tone: "good" }, flat: { dir: "flat", tone: "neutral" } };

/** The change in the foreground colour with its direction mark beside it. */
function CostValue({ e, value, className }: { e: ActivityCostEntry; value: string | null; className: string }) {
  const mark = MARK[costTone(e)];
  return (
    <View className="shrink-0 flex-row items-center gap-2">
      <Text className={cn(className, "tabular-nums", !value && "text-muted-foreground")}>{value ?? MISSING}</Text>
      {!!value && <DeltaMark dir={mark.dir} tone={mark.tone} />}
    </View>
  );
}

function CostRow({ e, minSessions }: { e: ActivityCostEntry; minSessions: number }) {
  const { t } = useTranslation("strain");
  const value = costValue(e);
  const caption = costCaption(e, minSessions);
  return (
    <View accessible accessibilityLabel={value ? t("cost.spoken", { name: e.name, value, caption }) : t("cost.spokenNone", { name: e.name, caption })} className="min-h-14 flex-row items-center gap-3 py-2">
      <Icon icon={ACTIVITY_ICON[e.kind]} size={20} tone="muted-foreground" strokeWidth={1.75} />
      <View className="min-w-0 flex-1">
        <Text className={LABEL}>{e.name}</Text>
        <Text className={cn(CAPTION, "mt-0.5")}>{caption}</Text>
      </View>
      <CostValue e={e} value={value} className="font-numeric text-xl font-bold leading-6" />
    </View>
  );
}

/** Activities' "Recovery cost": a row per kind (`items`, all by default), then what they are measured against. */
export function ActivityCostList({ vm, items = vm.items }: { vm: ActivityCostVM; items?: ActivityCostEntry[] }) {
  const { t } = useTranslation("strain");
  const base = baselineText(vm);
  return (
    <Card className="gap-0 px-4 py-1">
      <Divided>
        {items.map((e) => (
          <CostRow key={e.kind} e={e} minSessions={vm.minSessions} />
        ))}
      </Divided>
      <Text className={cn(CAPTION, "pb-3 pt-1")}>{base ? t("cost.footer", { baseline: base }) : t("cost.caveat")}</Text>
    </Card>
  );
}

/** The Activity screen's card: this kind's cost, the morning after this workout, and the baseline. */
export function ActivityCostCard({ cost }: { cost: NonNullable<ActivityVM["cost"]> }) {
  const { t } = useTranslation("strain");
  const e = cost.item;
  const value = costValue(e);
  // [label, value, a word rather than a number]
  const rows: [string, string, boolean][] = [];
  if (cost.nextMorning !== null) rows.push([t("cost.afterThis"), `${formatValue("int", cost.nextMorning)}%`, false]);
  // Only a dip has a bounce-back; the sentence says what a lift or no change means.
  if (costTone(e) === "cost") rows.push([t("cost.bounceBack"), bounceText(e), true]);
  rows.push([cost.baselineKind === "rest" ? t("cost.restDay") : t("cost.average"), cost.baseline === null ? MISSING : `${formatValue("int", cost.baseline)}%`, false]);
  return (
    <Card className="gap-3 px-4 py-4">
      {value !== null && (
        <View accessible accessibilityLabel={t("cost.spokenValue", { value })} className="gap-1">
          <View className="flex-row items-center">
            <CostValue e={e} value={value} className={HERO} />
          </View>
          <Text className={LABEL}>{t("cost.nextMorning")}</Text>
        </View>
      )}
      <Text className={LINE}>{costSentence(e, cost)}</Text>
      <Divided>
        {rows.map(([k, v, word]) => (
          <StatRow key={k} label={k} value={v} word={word} spoken={`${k}: ${v}`} />
        ))}
      </Divided>
      <Text className={CAPTION}>{t("cost.caveat")}</Text>
    </Card>
  );
}

/**
 * A detected activity among the day's rows: the timeline row's shape (spec §5.12) with a dashed, unfilled chip and a
 * muted name, and no detail screen to open. Shown for reference only.
 */
export function DetectedRow({ item, timeZone }: { item: DetectedItem; timeZone?: string }) {
  const { t } = useTranslation("strain");
  const s = clock(item.start, timeZone);
  const e = clock(item.end, timeZone);
  return (
    <View
      accessible
      accessibilityLabel={t("detected.spoken", { label: item.label.toLowerCase(), hr: item.avgHr, start: s, end: e })}
      className={cn(SECONDARY_ROW, "h-14 flex-row items-center gap-3 pl-1.5 pr-3")}
    >
      <View className="h-11 w-[84px] shrink-0 flex-row items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-strain">
        <Icon icon={item.kind === "cardio" ? Activity : ACTIVITY_ICON[item.kind]} size={16} tone="strain-text" strokeWidth={1.75} />
        <Text className="font-numeric text-xl font-bold tabular-nums text-strain-text">{formatValue("pct", item.strain)}</Text>
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-bold uppercase leading-5 tracking-[0.1em] text-foreground-secondary">{t("detected.title")}</Text>
        <Text className="text-xs font-medium leading-4 text-muted-foreground" numberOfLines={1}>{item.steps ? t("detected.lineSteps", { label: item.label, hr: item.avgHr, steps: formatValue("grouped", item.steps) }) : t("detected.line", { label: item.label, hr: item.avgHr })}</Text>
      </View>
      <View className="shrink-0 items-end">
        <Text className="font-numeric text-xs font-medium leading-4 tabular-nums text-foreground-secondary">{s}</Text>
        <Text className="font-numeric text-xs font-medium leading-4 tabular-nums text-foreground-secondary">{e}</Text>
      </View>
    </View>
  );
}

export function DetectedNote({ className }: { className?: string }) {
  const { t } = useTranslation("strain");
  return <Text className={cn(CAPTION, className)}>{t("detected.note")}</Text>;
}
