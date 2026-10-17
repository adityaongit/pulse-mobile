// Nutrition `/nutrition` (spec §7.22): halo's src/screens/nutrition/NutritionScreen.tsx in Pulse's kit. Today's
// calories, protein, carbs and fat against the targets (protein 1.6 g per kg, calories at the 14-day burn, fat 30 %),
// the 7- and 30-day daily averages, a month of daily protein and calories, and today's food: Pulse's entries to edit or
// delete, Fitbit's (read from Health Connect) read-only. Opened from the Health hub and the Journal's food sheet.
import { useState } from "react";
import { View } from "react-native";
import { Camera, Pencil, Plus, Sparkles, Trash2, Utensils, type LucideIcon } from "lucide-react-native";
import { deleteLogEntry, setFoodSeparate } from "@/actions/log";
import { clock, FORMATS } from "@/lib/format";
import { progressOf, TARGET_KEYS, TARGET_LIMITS, type TargetKey } from "@/nutrition/targets";
import { getNutrition, type Averages, type FoodItem, type NutritionVM } from "@/queries/nutrition";
import { ErrorView } from "@/screens/health/ErrorView";
import { ConfirmDialog, ProgressBar } from "@/screens/settings/controls";
import { useScreen } from "@/screens/useScreen";
import { actionCtx, dataChanged } from "@/state/app";
import { useNutritionTargets } from "@/state/nutrition";
import { Button } from "@/ui/Button";
import { ColumnChart } from "@/ui/charts/ColumnChart";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { CAPTION, LABEL } from "@/ui/metrics/primitives";
import { Press } from "@/ui/Press";
import { Segmented } from "@/ui/Segmented";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Skeleton } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { foodHref } from "./FoodPage";
import { push } from "@/ui/navigate";

const grouped = (v: number) => FORMATS.grouped(v);
const grams = (v: number) => FORMATS.int(v);
const show = (v: number | null, f: (x: number) => string) => (v === null ? "--" : f(v));
const metric = (v: number | null) => (v === null ? { value: null, reason: "no_data" as const, provisional: false } : { value: v, reason: null, provisional: false });

const INFO = {
  title: "How Pulse counts food",
  body: "Totals add what you log in Pulse to the food logged in Fitbit (read from Health Connect). A food logged in both apps counts once: when Fitbit has the same food at the same meal, or the same calories within an hour and a half, Pulse leaves its own entry out. Photo and description estimates come from your own AI provider and are approximate. Pulse never keeps the photo.",
};

/** Today: calories big against the target, then each macro with a thin bar. */
function Today({ vm }: { vm: NutritionVM }) {
  const { totals: t, targets } = vm;
  const kcal = targets.kcal.value;
  const left = t.kcal === null ? kcal : kcal - t.kcal;
  return (
    <View className="gap-4">
      <View accessible accessibilityLabel={`Today ${show(t.kcal, grouped)} of ${grouped(kcal)} kcal`} className="gap-2">
        <Text className={LABEL}>{t.kcal === null ? "Nothing logged today" : "Today so far"}</Text>
        <View className="flex-row flex-wrap items-baseline gap-x-2">
          <Text className="font-numeric text-[44px] font-bold leading-[50px] tabular-nums">{show(t.kcal, grouped)}</Text>
          <Text className="text-sm font-medium leading-5 text-muted-foreground">{`of ${grouped(kcal)} kcal`}</Text>
        </View>
        <ProgressBar value={(progressOf(t.kcal, kcal) ?? 0) * 100} label="Calories against target" />
        <Text className={CAPTION}>{left > 0 ? `${grouped(left)} kcal left of your target` : left < 0 ? `${grouped(-left)} kcal over your target` : "Calorie target reached"}</Text>
      </View>
      {(["protein", "carbs", "fat"] as const).map((k) => (
        <View key={k} accessible accessibilityLabel={`${TARGET_LABEL[k]}: ${show(t[k], grams)} of ${grams(targets[k].value)} g`} className="gap-1.5">
          <View className="flex-row items-baseline justify-between">
            <Text className={LABEL}>{TARGET_LABEL[k]}</Text>
            <Text className="font-numeric text-[15px] font-bold leading-5 tabular-nums">
              {show(t[k], grams)}
              <Text className="text-xs font-medium text-muted-foreground">{` / ${grams(targets[k].value)} g`}</Text>
            </Text>
          </View>
          <ProgressBar value={(progressOf(t[k], targets[k].value) ?? 0) * 100} label={`${TARGET_LABEL[k]} against target`} />
        </View>
      ))}
      {t.fiber !== null && <Text className={cn(CAPTION, "tabular-nums")}>{`Fiber ${grams(t.fiber)} g, from food logged in Pulse`}</Text>}
    </View>
  );
}

const TARGET_LABEL: Record<TargetKey, string> = { kcal: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat" };
const VIA_ICON: Record<NonNullable<FoodItem["via"]>, LucideIcon> = { photo: Camera, text: Sparkles, manual: Utensils };

/** "320 kcal · 11 g protein · 40 g carbs · 9 g fat" for one food. */
const numbersOf = (f: FoodItem) =>
  [`${grouped(f.kcal)} kcal`, f.protein !== null && `${grams(f.protein)} g protein`, f.carbs !== null && `${grams(f.carbs)} g carbs`, f.fat !== null && `${grams(f.fat)} g fat`].filter(Boolean).join(" · ");

/** One food: how it was logged, name and portion, numbers, time and source; edit and delete for Pulse's own. */
function FoodRow({ f, timeZone, onDelete, onSeparate }: { f: FoodItem; timeZone: string; onDelete: () => void; onSeparate: (on: boolean) => void }) {
  const mine = f.source === "pulse";
  const from = !mine ? "Logged in Fitbit" : f.duplicateOf ? "Also in Fitbit’s log: counted once" : f.separate ? "Counted as its own food" : f.via === "photo" ? "From a photo" : f.via === "text" ? "From a description" : null;
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
        {!!f.duplicateOf && <RowLink label="Not the same food? Count it too" onPress={() => onSeparate(true)} />}
        {f.separate && !f.duplicateOf && <RowLink label="Undo" onPress={() => onSeparate(false)} />}
      </View>
      {mine && (
        <View className="flex-row">
          <Press activeBg="bg-fill-hover" accessibilityRole="button" accessibilityLabel={`Edit ${f.title}`} onPress={() => push(foodHref({ edit: f.id }))} className="size-11 items-center justify-center rounded-full">
            <Icon icon={Pencil} size={17} tone="muted-foreground" />
          </Press>
          <Press activeBg="bg-fill-hover" accessibilityRole="button" accessibilityLabel={`Delete ${f.title}`} onPress={onDelete} className="size-11 items-center justify-center rounded-full">
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

/** One period's daily averages: calories as a tile value, the macros under it, then how many days had food. */
function AverageTile({ title, a }: { title: string; a: Averages }) {
  const sub = a.days === 0 ? "No days with food logged yet" : `${show(a.protein, grams)} g protein · ${show(a.carbs, grams)} g carbs · ${show(a.fat, grams)} g fat · ${a.days} of ${a.span} days`;
  return (
    <View className="flex-1 gap-1.5">
      <KeyStatRow variant="tile" label={title} metric={metric(a.days ? a.kcal : null)} unit="kcal" format="grouped" direction="none" />
      <Text className={CAPTION}>{sub}</Text>
    </View>
  );
}

type ChartKey = "protein" | "kcal";

function History({ vm }: { vm: NutritionVM }) {
  const [key, setKey] = useState<ChartKey>("protein");
  const target = key === "protein" ? vm.targets.protein.value : vm.targets.kcal.value;
  const data = vm.history.map((h) => ({ label: h.day.slice(8), title: h.day, value: h[key], highlight: h.day === vm.today }));
  return (
    <View className="gap-3">
      <Segmented
        label="Chart"
        fill
        value={key}
        onChange={setKey}
        options={[
          { value: "protein", label: "Protein" },
          { value: "kcal", label: "Calories" },
        ]}
      />
      {data.some((d) => d.value !== null) ? (
        <ColumnChart summary={`Daily ${key === "protein" ? "protein" : "calories"}, last 30 days`} data={data} format={key === "protein" ? "int" : "grouped"} unit={key === "protein" ? "g" : "kcal"} tickEvery={7} reference={{ y: target, label: "Target" }} />
      ) : (
        <EmptyState body="No food logged in the last 30 days." />
      )}
      <Text className={CAPTION}>Today is still running. The dashed line is your target.</Text>
    </View>
  );
}

export function NutritionScreen() {
  const { custom, ready } = useNutritionTargets();
  const { data: vm, error, reload } = useScreen((ctx) => (ready ? getNutrition(ctx, custom) : Promise.resolve(null)), ["nutrition", custom, ready]);
  const [remove, setRemove] = useState<FoodItem | null>(null);
  const [removing, setRemoving] = useState(false);

  if (!vm) return error ? <ErrorView detail retry={reload} /> : <DetailShell title="Nutrition" loading hero={<Skeleton className="h-64 w-full rounded-2xl" />} />;

  const confirmRemove = async () => {
    if (!remove) return;
    setRemoving(true);
    const r = await deleteLogEntry(actionCtx(), { id: remove.id }).catch(() => ({ ok: false as const, error: "" }));
    setRemoving(false);
    setRemove(null);
    if (!r.ok) return toast.error("Couldn’t delete. Try again.");
    toast.success("Deleted");
    dataChanged();
  };
  const separate = async (f: FoodItem, on: boolean) => {
    const r = await setFoodSeparate(actionCtx(), { id: f.id, ts: f.ts, separate: on }).catch(() => ({ ok: false as const, error: "" }));
    if (!r.ok) return toast.error("Couldn’t change that. Try again.");
    toast.success(on ? `${f.title} now counts too` : `Pulse matches ${f.title} with Fitbit again`);
    dataChanged();
  };

  return (
    <>
      <DetailShell
        title="Nutrition"
        info={INFO}
        hero={<Today vm={vm} />}
        primary={
          <View className="gap-6">
            <Button onPress={() => push(foodHref())}>
              <Icon icon={Plus} size={18} tone="primary-foreground" />
              <Text className="text-[15px] font-bold uppercase tracking-[0.1em] text-primary-foreground">Add food</Text>
            </Button>
            <SectionShell variant="section" title="Today’s food">
              {!vm.meals.length && !vm.unlisted ? (
                <EmptyState body="Nothing logged today. Add a meal with a photo, a few words, or its numbers." />
              ) : (
                <View className="gap-3">
                  {vm.meals.map((g) => (
                    <SectionShell key={g.meal} variant="card" title={g.label} info={false} aside={`${grouped(g.kcal)} kcal`}>
                      {g.items.map((f, i) => (
                        <View key={f.id} className={i > 0 ? "border-t border-border" : undefined}>
                          <FoodRow f={f} timeZone={vm.timeZone} onDelete={() => setRemove(f)} onSeparate={(on) => void separate(f, on)} />
                        </View>
                      ))}
                      {g.overlap && <Text className={cn(CAPTION, "mt-2")}>{`${g.label} is logged in both Pulse and Fitbit under different names. If it’s the same food, delete the Pulse entry so it counts once.`}</Text>}
                    </SectionShell>
                  ))}
                  {vm.unlisted && (
                    <SectionShell variant="card" title="More from Fitbit’s food log" info={false}>
                      <Text className="text-sm leading-5 tabular-nums">
                        {[vm.unlisted.kcal !== null && `${grouped(vm.unlisted.kcal)} kcal`, vm.unlisted.protein !== null && `${grams(vm.unlisted.protein)} g protein`, vm.unlisted.carbs !== null && `${grams(vm.unlisted.carbs)} g carbs`, vm.unlisted.fat !== null && `${grams(vm.unlisted.fat)} g fat`].filter(Boolean).join(" · ")}
                      </Text>
                      <Text className={cn(CAPTION, "mt-1")}>Fitbit’s daily total holds more than the foods listed here, so the rest counts as one line.</Text>
                    </SectionShell>
                  )}
                </View>
              )}
            </SectionShell>
          </View>
        }
        secondary={[
          <SectionShell key="targets" variant="card" title="Daily targets" info={false}>
            {TARGET_KEYS.map((k) => (
              <KeyStatRow key={k} variant="row" label={TARGET_LABEL[k]} caption={vm.targets[k].basis} metric={metric(vm.targets[k].value)} unit={TARGET_LIMITS[k].unit} format={k === "kcal" ? "grouped" : "int"} direction="none" />
            ))}
          </SectionShell>,
          <SectionShell key="averages" variant="card" title="Daily averages" info={{ title: "Daily averages", body: "Over the days with food logged, before today. A day you logged nothing doesn’t pull the average down." }}>
            <View className="flex-row gap-3">
              <AverageTile title="Last 7 days" a={vm.week} />
              <AverageTile title="Last 30 days" a={vm.month} />
            </View>
          </SectionShell>,
          <SectionShell key="history" variant="card" title="Last 30 days" info={false}>
            <History vm={vm} />
          </SectionShell>,
        ]}
      />
      <ConfirmDialog
        open={remove !== null}
        title="Delete this food?"
        description={`${remove ? `${remove.title}, ${numbersOf(remove)}. ` : ""}It is deleted from Pulse.`}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        pending={removing}
        onCancel={() => !removing && setRemove(null)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}
