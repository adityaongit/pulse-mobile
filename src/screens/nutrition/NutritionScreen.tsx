// Nutrition `/nutrition` (spec §7.22): halo's src/screens/nutrition/NutritionScreen.tsx in Pulse's kit. Today's
// calories, protein, carbs and fat against the targets (protein 1.6 g per kg, calories at the 14-day burn, fat 30 %),
// the 7- and 30-day daily averages, a month of daily protein and calories, and today's food: Pulse's entries to edit or
// delete, Fitbit's (read from Health Connect) read-only. Opened from the Health hub and the Journal's food sheet.
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Camera, Pencil, Plus, Sparkles, Trash2, Utensils, type LucideIcon } from "lucide-react-native";
import { i18n } from "@/i18n/config";
import { deleteLogEntry, setFoodSeparate } from "@/actions/log";
import { DATA_COLORS } from "@/lib/bands";
import { clock, formatDay, FORMATS } from "@/lib/format";
import { reasonCopy } from "@/lib/reasons";
import { TARGET_KEYS, TARGET_LIMITS } from "@/nutrition/targets";
import { getNutrition, type Averages, type FoodItem, type NutritionVM } from "@/queries/nutrition";
import { ErrorView } from "@/screens/health/ErrorView";
import { ConfirmDialog } from "@/screens/settings/controls";
import { useScreen } from "@/screens/useScreen";
import { actionCtx, dataChanged } from "@/state/app";
import { useNutritionTargets } from "@/state/nutrition";
import { Button } from "@/ui/Button";
import { CalorieBalanceChart, ZONE_TOKEN } from "@/ui/charts/CalorieBalanceChart";
import { ColumnChart } from "@/ui/charts/ColumnChart";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { CAPTION } from "@/ui/metrics/primitives";
import { Press } from "@/ui/Press";
import { Segmented } from "@/ui/Segmented";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { foodHref } from "./FoodPage";
import { Today } from "./NutritionHero";
import { push } from "@/ui/navigate";

const grouped = (v: number) => FORMATS.grouped(v);
const grams = (v: number) => FORMATS.int(v);
const show = (v: number | null, f: (x: number) => string) => (v === null ? "--" : f(v));
const metric = (v: number | null) => (v === null ? { value: null, reason: "no_data" as const, provisional: false } : { value: v, reason: null, provisional: false });


const VIA_ICON: Record<NonNullable<FoodItem["via"]>, LucideIcon> = { photo: Camera, text: Sparkles, manual: Utensils };

/** "320 kcal · 11 g protein · 40 g carbs · 9 g fat" for one food. */
const numbersOf = (f: FoodItem) =>
  [
    i18n.t("nutrition:numbers.kcal", { value: grouped(f.kcal) }),
    f.protein !== null && i18n.t("nutrition:numbers.protein", { value: grams(f.protein) }),
    f.carbs !== null && i18n.t("nutrition:numbers.carbs", { value: grams(f.carbs) }),
    f.fat !== null && i18n.t("nutrition:numbers.fat", { value: grams(f.fat) }),
  ]
    .filter(Boolean)
    .join(" · ");

/** One food: how it was logged, name and portion, numbers, time and source; edit and delete for Pulse's own. */
function FoodRow({ f, timeZone, onDelete, onSeparate }: { f: FoodItem; timeZone: string; onDelete: () => void; onSeparate: (on: boolean) => void }) {
  const { t: tr } = useTranslation("nutrition");
  const mine = f.source === "pulse";
  const from = !mine ? tr("row.fitbit") : f.duplicateOf ? tr("row.duplicate") : f.separate ? tr("row.separate") : f.via === "photo" ? tr("row.photo") : f.via === "text" ? tr("row.description") : null;
  const time = clock(f.ts * 1000, timeZone);
  return (
    <View className="flex-row items-start gap-3 py-2.5">
      <View className="mt-0.5">
        <Icon icon={mine ? VIA_ICON[f.via ?? "manual"] : Utensils} size={18} tone="foreground-secondary" />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className={cn("text-[15px] font-semibold leading-5", f.duplicateOf && "text-muted-foreground")}>
          {f.title}
          {f.portion ? <Text className="font-normal text-muted-foreground">{`  ${f.portion}`}</Text> : null}
        </Text>
        <Text className={cn("text-sm leading-5 tabular-nums", f.duplicateOf && "text-muted-foreground line-through")}>{numbersOf(f)}</Text>
        <Text className={cn(CAPTION, "tabular-nums")}>{from ? `${time} · ${from}` : time}</Text>
        {!!f.duplicateOf && <RowLink label={tr("row.countToo")} onPress={() => onSeparate(true)} />}
        {f.separate && !f.duplicateOf && <RowLink label={tr("row.undo")} onPress={() => onSeparate(false)} />}
      </View>
      {mine && (
        <View className="flex-row">
          <Press activeBg="bg-fill-hover" accessibilityRole="button" accessibilityLabel={tr("row.edit", { title: f.title })} onPress={() => push(foodHref({ edit: f.id }))} className="size-11 items-center justify-center rounded-full">
            <Icon icon={Pencil} size={17} tone="muted-foreground" />
          </Press>
          <Press activeBg="bg-fill-hover" accessibilityRole="button" accessibilityLabel={tr("row.delete", { title: f.title })} onPress={onDelete} className="size-11 items-center justify-center rounded-full">
            <Icon icon={Trash2} size={17} tone="muted-foreground" />
          </Press>
        </View>
      )}
    </View>
  );
}

function RowLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press accessibilityRole="button" onPress={onPress} hitSlop={{ top: 12, bottom: 12, left: 4, right: 12 }} className="mt-1 self-start">
      <Text className="text-sm font-semibold leading-5 underline">{label}</Text>
    </Press>
  );
}

/** One period's daily averages: a flat tile on the card, calories big, the macros as a caption row, then the days logged. */
function AverageTile({ title, a }: { title: string; a: Averages }) {
  const { t: tr } = useTranslation("nutrition");
  const macros = [tr("numbers.protein", { value: show(a.protein, grams) }), tr("numbers.carbs", { value: show(a.carbs, grams) }), tr("numbers.fat", { value: show(a.fat, grams) })].join(" · ");
  const days = tr("averages.days", { days: a.days, span: a.span });
  return (
    <View accessible accessibilityLabel={`${title}: ${a.days === 0 ? tr("averages.none") : `${tr("numbers.kcal", { value: show(a.kcal, grouped) })}, ${macros}, ${days}`}`} className="min-w-0 flex-1 gap-2 rounded-xl bg-inset p-3">
      <Text className="text-[10px] font-bold uppercase leading-3 tracking-[0.1em] text-foreground-secondary">{title}</Text>
      {a.days === 0 ? (
        <Text className={CAPTION}>{tr("averages.none")}</Text>
      ) : (
        <>
          <Text className="font-numeric text-[30px] font-bold leading-9 tracking-[-0.01em] tabular-nums">
            {show(a.kcal, grouped)}
            <Text className="text-sm font-medium leading-5">{` ${tr("unit.kcal")}`}</Text>
          </Text>
          <Text className={cn(CAPTION, "tabular-nums")}>{macros}</Text>
          <Text className={cn(CAPTION, "tabular-nums")}>{days}</Text>
        </>
      )}
    </View>
  );
}

/** Calories in vs. out: today as one sentence and the balance, then seven days as bars (in by zone, out grey). */
function Balance({ vm }: { vm: NutritionVM }) {
  const { t } = useTranslation("nutrition");
  const { goal, kcalIn, kcalOut, net, days } = vm.balance;
  const calIn = kcalIn.value;
  const calOut = kcalOut.value;
  const both = calIn !== null && calOut !== null;
  const data = days.map((d) => ({ label: formatDay(d.day, { weekday: "short" }), kcalIn: d.kcalIn, zone: d.zone, kcalOut: d.kcalOut }));
  const legend = [
    ...(["under", "in", "over"] as const).map((z) => ({ key: z, label: t(`balance.${z}`), bg: DATA_COLORS[ZONE_TOKEN[z]].bg })),
    { key: "out", label: t("balance.out"), bg: "bg-foreground/30" },
  ];
  return (
    <View className="gap-3">
      <View className="gap-1">
        {both ? (
          <Text className="text-[17px] font-bold leading-6 tabular-nums">{t("balance.summary", { in: grouped(calIn), out: grouped(calOut) })}</Text>
        ) : (
          <>
            <Text className="text-[17px] font-bold leading-6 tabular-nums">{calIn === null ? t("balance.noFood") : t("balance.calIn", { in: grouped(calIn) })}</Text>
            <Text className="text-[17px] font-bold leading-6 tabular-nums">{calOut === null ? t("balance.noBurn") : t("balance.calOut", { out: grouped(calOut) })}</Text>
            {calOut === null && <Text className={CAPTION}>{reasonCopy(kcalOut.reason).long}</Text>}
          </>
        )}
        <Text className="text-sm leading-5 tabular-nums">{t("balance.goal", { goal: grouped(goal) })}</Text>
        {net !== null && <Text className="text-sm font-semibold leading-5 tabular-nums">{net < 0 ? t("balance.deficit", { kcal: grouped(-net) }) : net > 0 ? t("balance.surplus", { kcal: grouped(net) }) : t("balance.even")}</Text>}
      </View>
      {days.some((d) => d.kcalIn !== null || d.kcalOut !== null) ? (
        <CalorieBalanceChart summary={t("balance.chartSummary", { goal: grouped(goal) })} data={data} goal={goal} goalLabel={t("balance.goalPill")} />
      ) : (
        <EmptyState body={t("balance.empty")} />
      )}
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        {legend.map((l) => (
          <View key={l.key} className="flex-row items-center gap-1.5">
            <View className={cn("size-2.5 rounded-sm", l.bg)} />
            <Text className={CAPTION}>{l.label}</Text>
          </View>
        ))}
      </View>
      <Text className={CAPTION}>{t("balance.note")}</Text>
    </View>
  );
}

type ChartKey = "protein" | "kcal";

function History({ vm }: { vm: NutritionVM }) {
  const { t: tr } = useTranslation("nutrition");
  const [key, setKey] = useState<ChartKey>("protein");
  const target = key === "protein" ? vm.targets.protein.value : vm.targets.kcal.value;
  const data = vm.history.map((h) => ({ label: h.day.slice(8), title: h.day, value: h[key], highlight: h.day === vm.today }));
  return (
    <View className="gap-3">
      <Segmented
        label={tr("history.chart")}
        fill
        value={key}
        onChange={setKey}
        options={[
          { value: "protein", label: tr("history.protein") },
          { value: "kcal", label: tr("history.calories") },
        ]}
      />
      {data.some((d) => d.value !== null) ? (
        <ColumnChart summary={key === "protein" ? tr("history.summaryProtein") : tr("history.summaryCalories")} data={data} format={key === "protein" ? "int" : "grouped"} unit={key === "protein" ? "g" : "kcal"} tickEvery={7} reference={{ y: target, label: tr("history.target") }} />
      ) : (
        <EmptyState body={tr("history.empty")} />
      )}
      <Text className={CAPTION}>{tr("history.note")}</Text>
    </View>
  );
}

export function NutritionScreen() {
  const { t } = useTranslation("nutrition");
  const { custom, ready } = useNutritionTargets();
  const { data: vm, error, reload } = useScreen((ctx) => (ready ? getNutrition(ctx, custom) : Promise.resolve(null)), ["nutrition", custom, ready]);
  const [remove, setRemove] = useState<FoodItem | null>(null);
  const [removing, setRemoving] = useState(false);

  if (!vm) return error ? <ErrorView detail retry={reload} /> : <DetailShell title={t("title")} loading hero={<Skeleton className="h-64 w-full rounded-2xl" />} />;

  const confirmRemove = async () => {
    if (!remove) return;
    setRemoving(true);
    const r = await deleteLogEntry(actionCtx(), { id: remove.id }).catch(() => ({ ok: false as const, error: "" }));
    setRemoving(false);
    setRemove(null);
    if (!r.ok) return toast.error(t("screen.deleteFailed"));
    toast.success(t("screen.deleted"));
    dataChanged();
  };
  const separate = async (f: FoodItem, on: boolean) => {
    const r = await setFoodSeparate(actionCtx(), { id: f.id, ts: f.ts, separate: on }).catch(() => ({ ok: false as const, error: "" }));
    if (!r.ok) return toast.error(t("screen.changeFailed"));
    toast.success(on ? t("screen.nowCounts", { title: f.title }) : t("screen.rematched", { title: f.title }));
    dataChanged();
  };

  return (
    <>
      <DetailShell
        title={t("title")}
        info={{ title: t("info.title"), body: t("info.body") }}
        hero={<Today vm={vm} />}
        primary={
          <View className="gap-6">
            <Button onPress={() => push(foodHref())}>
              <Icon icon={Plus} size={18} tone="primary-foreground" />
              <Text className="text-[15px] font-bold uppercase tracking-[0.1em] text-primary-foreground">{t("screen.addFood")}</Text>
            </Button>
            <SectionShell variant="section" title={t("screen.todaysFood")}>
              {!vm.meals.length && !vm.unlisted ? (
                <EmptyState body={t("screen.emptyToday")} />
              ) : (
                <View className="gap-3">
                  {vm.meals.map((g) => (
                    <SectionShell key={g.meal} variant="card" title={g.label} info={false} aside={`${grouped(g.kcal)} kcal`}>
                      {g.items.map((f, i) => (
                        <View key={f.id} className={i > 0 ? "border-t border-border" : undefined}>
                          <FoodRow f={f} timeZone={vm.timeZone} onDelete={() => setRemove(f)} onSeparate={(on) => void separate(f, on)} />
                        </View>
                      ))}
                      {g.overlap && <Text className={cn(CAPTION, "mt-2")}>{t("screen.overlap", { meal: g.label })}</Text>}
                    </SectionShell>
                  ))}
                  {vm.unlisted && (
                    <SectionShell variant="card" title={t("screen.unlistedTitle")} info={false}>
                      <Text className="text-sm leading-5 tabular-nums">
                        {[vm.unlisted.kcal !== null && t("numbers.kcal", { value: grouped(vm.unlisted.kcal) }), vm.unlisted.protein !== null && t("numbers.protein", { value: grams(vm.unlisted.protein) }), vm.unlisted.carbs !== null && t("numbers.carbs", { value: grams(vm.unlisted.carbs) }), vm.unlisted.fat !== null && t("numbers.fat", { value: grams(vm.unlisted.fat) })].filter(Boolean).join(" · ")}
                      </Text>
                      <Text className={cn(CAPTION, "mt-1")}>{t("screen.unlistedNote")}</Text>
                    </SectionShell>
                  )}
                </View>
              )}
            </SectionShell>
          </View>
        }
        secondary={[
          <SectionShell key="balance" variant="card" title={t("balance.title")} info={false}>
            <Balance vm={vm} />
          </SectionShell>,
          <SectionShell key="targets" variant="card" title={t("screen.targets")} info={false}>
            {TARGET_KEYS.map((k) => (
              <KeyStatRow key={k} variant="row" label={t(`target.${k}`)} caption={vm.targets[k].basis} metric={metric(vm.targets[k].value)} unit={TARGET_LIMITS[k].unit} format={k === "kcal" ? "grouped" : "int"} direction="none" />
            ))}
          </SectionShell>,
          <SectionShell key="averages" variant="card" title={t("averages.title")} info={{ title: t("averages.title"), body: t("averages.body") }}>
            <View className="flex-row gap-3">
              <AverageTile title={t("averages.last7")} a={vm.week} />
              <AverageTile title={t("averages.last30")} a={vm.month} />
            </View>
          </SectionShell>,
          <SectionShell key="history" variant="card" title={t("averages.last30")} info={false}>
            <History vm={vm} />
          </SectionShell>,
        ]}
      />
      <ConfirmDialog
        open={remove !== null}
        title={t("screen.deleteTitle")}
        description={remove ? t("screen.deleteBody", { food: remove.title, numbers: numbersOf(remove) }) : ""}
        confirmLabel={t("screen.delete")}
        pendingLabel={t("screen.deleting")}
        pending={removing}
        onCancel={() => !removing && setRemove(null)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}
