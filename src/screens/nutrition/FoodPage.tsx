// The food sheet `/food?d=&edit=` (spec §7.22): halo's src/screens/nutrition/FoodPage.tsx in Pulse's sheet kit. Add
// food three ways (a photo, taken or chosen; a few words; or typed in), check an AI estimate as an editable list before
// saving, and edit a food logged in Pulse. Opened from Nutrition and from the Journal's Food tile.
//
// Estimates use the person's own coach provider and key (src/coach/session.ts deviceModel); without one the sheet says so and
// offers the typed form. The photo is scaled and sent once (src/nutrition/photo.ts, estimate.ts), held in memory only
// until its estimate is in (or for a retry after a failure) and never saved. Closing the sheet (a route) unmounts it,
// which stops a running estimate.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Keyboard, Linking, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Camera, ImagePlus, PencilLine, ShieldCheck, Sparkles, Trash2, type LucideIcon } from "lucide-react-native";
import type { ActionResult } from "@/actions/journal";
import { i18n } from "@/i18n/config";
import { logFoods, updateFoodEntry, type FoodItemInput } from "@/actions/log";
import { FORMATS } from "@/lib/format";
import { wall } from "@/lib/time";
import { parseDay } from "@/lib/url";
import { estimateFood, MAX_DESCRIPTION, type Confidence, type EstimateInput, type EstimateProblem } from "@/nutrition/estimate";
import { coachReady, providerLabel } from "@/coach/providers";
import { deviceModel, useCoachSetup } from "@/coach/session";
import { chooseMealPhoto, takeMealPhoto, type MealPhoto } from "@/nutrition/photo";
import { todayOf } from "@/queries/common";
import type { FoodVia } from "@/queries/food";
import { MEALS, type Meal } from "@/queries/log";
import { getNutrition, type FoodItem } from "@/queries/nutrition";
import { DateTimeField } from "@/screens/log/DateTimeField";
import { Chips, Field, FormAlert, Input } from "@/screens/log/fields";
import { defaultAt, EMPTY_FOOD, foodFormOf, foodItemOf, mealAt, num, wallNow, type FoodForm } from "@/screens/log/form";
import { useScreen } from "@/screens/useScreen";
import { actionCtx, dataChanged } from "@/state/app";
import { useNutritionTargets } from "@/state/nutrition";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { CAPTION } from "@/ui/metrics/primitives";
import { Press } from "@/ui/Press";
import { TaskPage, TaskSection } from "@/ui/shells/TaskPage";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { goBack } from "@/ui/navigate";

type Step = "start" | "manual" | "estimating" | "review" | "failed";
type Problem = EstimateProblem | "no_food";
type Draft = { key: number; form: FoodForm; confidence: Confidence | null; open: boolean; error: string | null };

const grouped = (v: number) => FORMATS.grouped(v);
const gramsText = (v: number) => (Math.round(v * 10) / 10).toString();
const BODY = "text-sm leading-5 text-muted-foreground";

/** The sheet's href: over Journal's day `d` (today left out), or editing Pulse's entry `edit`. */
export const foodHref = (o: { d?: string; edit?: string } = {}) => {
  const q = [o.d && `d=${o.d}`, o.edit && `edit=${o.edit}`].filter(Boolean).join("&");
  return q ? `/food?${q}` : "/food";
};

/** A moment as the time field's value, "YYYY-MM-DDTHH:mm". */
const wallOf = (ts: number, timeZone: string) => {
  const w = wall(ts, timeZone);
  return `${w.day}T${w.time.slice(0, 5)}`;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <TaskSection>{title}</TaskSection>
      {children}
    </View>
  );
}

/** A way to add food, half the row: its icon and name, the secondary fill. */
function MethodTile({ icon, label, onPress, disabled }: { icon: LucideIcon; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Press activeScale={0.96} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} onPress={disabled ? undefined : onPress} className={cn("min-h-24 flex-1 justify-between rounded-2xl bg-secondary p-3", disabled && "opacity-50")}>
      <Icon icon={icon} size={22} tone="secondary-foreground" />
      <Text className="text-[15px] font-semibold leading-5 text-secondary-foreground">{label}</Text>
    </Press>
  );
}

/** A notice: a rounded inset with a title and a body. */
function Notice({ title, children, alert }: { title?: string; children: ReactNode; alert?: boolean }) {
  return (
    <View accessibilityRole={alert ? "alert" : undefined} className="gap-1 rounded-xl bg-inset p-3">
      {!!title && <Text className="text-[15px] font-semibold leading-5">{title}</Text>}
      {typeof children === "string" ? <Text className={BODY}>{children}</Text> : children}
    </View>
  );
}

/** One food's fields: name and portion, then calories and the grams two to a row. */
function FoodFields({ form, onChange }: { form: FoodForm; onChange: (k: keyof FoodForm, v: string) => void }) {
  const { t } = useTranslation("nutrition");
  const field = (k: keyof FoodForm, label: string, hint: string, mode: "text" | "numeric" | "decimal", placeholder?: string, maxLength?: number) => (
    <Field key={k} label={label} hint={hint} className={mode === "text" ? undefined : "flex-1"}>
      <Input accessibilityLabel={label} inputMode={mode} placeholder={placeholder} maxLength={maxLength} value={form[k]} onChangeText={(t) => onChange(k, t)} className={mode === "text" ? "text-base" : "text-base tabular-nums"} returnKeyType="done" />
    </Field>
  );
  return (
    <View className="gap-3">
      {field("name", t("food.name"), t("food.optional"), "text", t("food.namePlaceholder"), 80)}
      {field("portion", t("food.portion"), t("food.optional"), "text", t("food.portionPlaceholder"), 60)}
      <View className="flex-row gap-2">
        {field("kcal", t("target.kcal"), t("food.unitKcal"), "numeric")}
        {field("protein", t("target.protein"), t("food.unitG"), "decimal")}
      </View>
      <View className="flex-row gap-2">
        {field("carbs", t("target.carbs"), t("food.unitG"), "decimal")}
        {field("fat", t("target.fat"), t("food.unitG"), "decimal")}
      </View>
      <View className="flex-row gap-2">
        {field("fiber", t("food.fiber"), t("food.fiberHint"), "decimal")}
        <View className="flex-1" />
      </View>
    </View>
  );
}


/** A typed number, or 0 while it is blank or not a number yet (for the running total only). */
const n0 = (s: string) => {
  const v = num(s);
  return v === null || Number.isNaN(v) ? 0 : v;
};

/** "182 kcal · 12.6 g protein · 1.6 g carbs · 13.9 g fat": the numbers as typed so far. */
function summaryOf(f: FoodForm) {
  const g = (s: string, key: "protein" | "carbs" | "fat" | "fiber") => (num(s) !== null && !Number.isNaN(num(s)) ? i18n.t(`nutrition:numbers.${key}`, { value: s.trim().replace(",", ".") }) : null);
  return [i18n.t("nutrition:numbers.kcal", { value: f.kcal.trim() || "?" }), g(f.protein, "protein"), g(f.carbs, "carbs"), g(f.fat, "fat"), g(f.fiber, "fiber")].filter(Boolean).join(" · ");
}

/** One estimated food under review: name, portion and numbers; the pencil opens its fields, the bin drops it. */
function DraftRow({ d, onToggle, onChange, onRemove }: { d: Draft; onToggle: () => void; onChange: (k: keyof FoodForm, v: string) => void; onRemove: () => void }) {
  const { t } = useTranslation("nutrition");
  const name = d.form.name.trim() || t("food.fallbackName");
  return (
    <View className="gap-3 py-3">
      <View className="flex-row items-start gap-1">
        <Press accessibilityRole="button" accessibilityLabel={d.open ? t("food.draftClose", { name }) : t("food.draftEdit", { name })} accessibilityState={{ expanded: d.open }} onPress={onToggle} className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-semibold leading-[21px]">
            {name}
            {d.form.portion.trim() ? <Text className="text-[15px] font-normal text-muted-foreground">{`  ${d.form.portion.trim()}`}</Text> : null}
          </Text>
          <Text className={cn(BODY, "tabular-nums")}>{summaryOf(d.form)}</Text>
          {d.confidence && <Text className={CAPTION}>{t(`food.confidence${d.confidence === "high" ? "High" : d.confidence === "medium" ? "Medium" : "Low"}`)}</Text>}
        </Press>
        <Press activeBg="bg-fill-hover" accessibilityRole="button" accessibilityLabel={t("food.draftEdit", { name })} onPress={onToggle} className="size-11 items-center justify-center rounded-full">
          <Icon icon={PencilLine} size={18} tone={d.open ? "foreground" : "muted-foreground"} />
        </Press>
        <Press activeBg="bg-fill-hover" accessibilityRole="button" accessibilityLabel={t("food.draftRemove", { name })} onPress={onRemove} className="size-11 items-center justify-center rounded-full">
          <Icon icon={Trash2} size={18} tone="muted-foreground" />
        </Press>
      </View>
      {!!d.error && <FormAlert>{d.error}</FormAlert>}
      {d.open && <FoodFields form={d.form} onChange={onChange} />}
    </View>
  );
}

/** Each failure's heading and sentence; `provider` is the person's provider's name. */
function problemCopy(p: Problem, provider: string, photo: boolean): { title: string; body: string } {
  const o = { provider };
  switch (p) {
    case "timeout":
      return { title: i18n.t("nutrition:problem.timeoutTitle"), body: i18n.t("nutrition:problem.timeoutBody", o) };
    case "refused":
      return { title: i18n.t("nutrition:problem.refusedTitle", o), body: i18n.t(photo ? "nutrition:problem.refusedBodyPhoto" : "nutrition:problem.refusedBodyText") };
    case "unreadable":
      return { title: i18n.t("nutrition:problem.unreadableTitle"), body: i18n.t("nutrition:problem.unreadableBody", o) };
    case "key":
      return { title: i18n.t("nutrition:problem.keyTitle"), body: i18n.t("nutrition:problem.keyBody", o) };
    case "busy":
      return { title: i18n.t("nutrition:problem.busyTitle", o), body: i18n.t("nutrition:problem.busyBody") };
    case "network":
      return { title: i18n.t("nutrition:problem.networkTitle"), body: i18n.t("nutrition:problem.networkBody", o) };
    case "no_food":
      return { title: i18n.t("nutrition:problem.noFoodTitle"), body: i18n.t(photo ? "nutrition:problem.noFoodBodyPhoto" : "nutrition:problem.noFoodBodyText", o) };
    case "provider":
    case "cancelled":
      return { title: i18n.t("nutrition:problem.providerTitle"), body: i18n.t(photo ? "nutrition:problem.providerBodyPhoto" : "nutrition:problem.providerBodyText", o) };
  }
}

export function FoodPage() {
  const { t } = useTranslation("nutrition");
  const { d, edit: editId } = useLocalSearchParams<{ d?: string; edit?: string }>();
  const { custom, ready } = useNutritionTargets();
  const { data: vm } = useScreen((ctx) => (ready ? getNutrition(ctx, custom).then((v) => ({ v, day: parseDay(d, todayOf(ctx)).d })) : Promise.resolve(null)), ["nutrition", custom, ready, d]);
  if (!vm) return <TaskPage title={editId ? t("food.titleEdit") : t("food.titleLog")}><View className="h-40" /></TaskPage>;
  const edit = editId ? (vm.v.meals.flatMap((g) => g.items).find((f) => f.id === editId && f.source === "pulse") ?? null) : null;
  const at = edit ? wallOf(edit.ts, vm.v.timeZone) : defaultAt({ day: vm.day, today: vm.v.today, timeZone: vm.v.timeZone });
  const meal = edit && edit.meal !== "UNKNOWN" ? edit.meal : mealAt(at.slice(11, 16));
  return <Sheet edit={edit} at={at} meal={meal} timeZone={vm.v.timeZone} today={vm.day === vm.v.today ? { kcal: vm.v.totals.kcal, protein: vm.v.totals.protein } : null} />;
}

function Sheet({ edit, at: at0, meal: meal0, timeZone, today }: { edit: FoodItem | null; at: string; meal: Meal; timeZone: string; today: { kcal: number | null; protein: number | null } | null }) {
  const { t } = useTranslation("nutrition");
  const setup = useCoachSetup();
  const hasKey = coachReady(setup);
  const provider = providerLabel(setup?.provider ?? null);

  const [step, setStep] = useState<Step>(edit ? "manual" : "start");
  const [meal, setMeal] = useState<Meal>(meal0);
  const [at, setAt] = useState(at0);
  const [form, setForm] = useState<FoodForm>(() => (edit ? foodFormOf(edit) : EMPTY_FOOD));
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [via, setVia] = useState<FoodVia>("photo");
  const [text, setText] = useState("");
  // The photo, in memory only: until its estimate is in, or for "Try again" after a failure. Never written anywhere.
  const [photo, setPhoto] = useState<MealPhoto | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<"camera_denied" | "camera_blocked" | "photo_failed" | "no_key" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const task = useRef<AbortController | null>(null);
  const draftSeq = useRef(0);
  /** The sheet has closed: nothing new starts (a photo still being prepared is dropped, not sent). */
  const ended = useRef(false);
  useEffect(
    () => () => {
      ended.current = true;
      task.current?.abort();
    },
    [],
  );

  // ── Estimating ──

  const estimate = async (input: EstimateInput, shot: MealPhoto | null) => {
    if (ended.current) return;
    task.current?.abort();
    const ctl = new AbortController();
    task.current = ctl;
    setProblem(null);
    setNotice(null);
    setError(null);
    setStep("estimating");
    const model = (await deviceModel())?.model;
    if (ctl.signal.aborted) return;
    if (!model) {
      setNotice("no_key");
      setStep("start");
      return;
    }
    const r = await estimateFood(model, input, { signal: ctl.signal });
    if (ctl.signal.aborted || task.current !== ctl) return;
    task.current = null;
    if (!r.ok) {
      if (r.problem === "cancelled") return setStep("start");
      setProblem(r.problem);
      return setStep("failed");
    }
    setNote(r.estimate.note);
    if (!r.estimate.foods.length) {
      setProblem("no_food");
      return setStep("failed");
    }
    // The estimate is in: the photo goes.
    setPhoto(null);
    setVia(shot ? "photo" : "text");
    setDrafts(
      r.estimate.foods.map((f) => {
        draftSeq.current += 1;
        return { key: draftSeq.current, form: foodFormOf(f), confidence: f.confidence, open: false, error: null };
      }),
    );
    setStep("review");
  };

  const fromPhoto = async (how: "camera" | "library") => {
    if (busy) return;
    setNotice(null);
    setBusy(true);
    const r = how === "camera" ? await takeMealPhoto() : await chooseMealPhoto();
    setBusy(false);
    if (ended.current) return;
    if (!r.ok) {
      if (r.reason === "denied") setNotice(r.canAskAgain ? "camera_denied" : "camera_blocked");
      else if (r.reason === "failed") setNotice("photo_failed");
      return;
    }
    setPhoto(r.photo);
    void estimate({ image: r.photo }, r.photo);
  };

  const fromText = () => {
    const t = text.trim();
    if (t.length < 2) return;
    Keyboard.dismiss();
    void estimate({ text: t }, null);
  };

  const retry = () => {
    if (photo) void estimate({ image: photo }, photo);
    else if (text.trim()) void estimate({ text: text.trim() }, null);
    else setStep("start");
  };

  /** Back to the ways in, for another photo or other words (the description stays). */
  const again = () => {
    setPhoto(null);
    setProblem(null);
    setError(null);
    setStep("start");
  };

  const cancel = () => {
    task.current?.abort();
    task.current = null;
    setStep("start");
  };

  /** To the typed form, carrying what is known (the description as the name). */
  const typeIt = () => {
    task.current?.abort();
    task.current = null;
    setPhoto(null);
    setError(null);
    if (!form.name && !photo && text.trim()) setForm((f) => ({ ...f, name: text.trim().slice(0, 80) }));
    setStep("manual");
  };

  // ── Saving ──

  const send = async (run: () => Promise<ActionResult<unknown>>, message: string) => {
    setSaving(true);
    setError(null);
    const r = await run().catch(() => ({ ok: false as const, error: t("food.saveFailed") }));
    setSaving(false);
    if (!r.ok) {
      haptic.error();
      return setError(r.error);
    }
    // Food feeds the nutrition numbers, which the screens add up as they read: they read again, with no sync or scoring run.
    dataChanged();
    goBack();
    toast.success(message);
  };

  const saveTyped = () => {
    const item = foodItemOf(form);
    if (typeof item === "string") return setError(item);
    if (edit) void send(() => updateFoodEntry(actionCtx(), { id: edit.id, ts: edit.ts, meal, at, item }), t("food.updated"));
    else void send(() => logFoods(actionCtx(), { meal, via: "manual", at, items: [item] }), t("food.saved", { count: 1 }));
  };

  const saveReview = () => {
    const items: FoodItemInput[] = [];
    for (const d of drafts) {
      const item = foodItemOf(d.form);
      if (typeof item === "string") {
        setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, open: true, error: item } : x)));
        return setError(t("food.fixBefore", { name: d.form.name.trim() || t("food.aFood") }));
      }
      items.push(item);
    }
    if (!items.length) return setError(t("food.allRemoved"));
    void send(() => logFoods(actionCtx(), { meal, via, at, items }), t("food.saved", { count: items.length }));
  };

  const setField = (k: keyof FoodForm, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };
  const setDraft = (key: number, k: keyof FoodForm, v: string) => {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, form: { ...d.form, [k]: v }, error: null } : d)));
    setError(null);
  };

  // ── Parts per step ──

  const showTyped = step === "manual" || (step === "start" && setup !== undefined && !hasKey);
  const mealSection = (
    <Section title={t("food.meal")}>
      <Chips label={t("food.meal")} options={MEALS} value={meal} onChange={(v) => typeof v === "string" && v && setMeal(v as Meal)} />
    </Section>
  );
  const timeSection = (
    <Section title={t("food.when")}>
      <Field label={t("food.time")}>
        <DateTimeField label={t("food.time")} mode="datetime" value={at} max={wallNow(timeZone)} onChange={setAt} />
      </Field>
    </Section>
  );
  const todayLine = today && (
    <Text className={cn(CAPTION, "tabular-nums")}>
      {today.kcal === null ? t("food.todayNothing") : today.protein !== null ? t("food.todayKcalProtein", { kcal: grouped(today.kcal), protein: gramsText(Math.round(today.protein)) }) : t("food.todayKcal", { kcal: grouped(today.kcal) })}
    </Text>
  );
  const noKey = (
    <Notice title={t("food.noKeyTitle")}>{t("food.noKeyBody")}</Notice>
  );
  const startNotice =
    notice === "camera_denied" ? (
      <Notice>{t("food.cameraDenied")}</Notice>
    ) : notice === "camera_blocked" ? (
      <Notice title={t("food.cameraBlockedTitle")}>
        <Text className={BODY}>{t("food.cameraBlockedBody")}</Text>
        <Press accessibilityRole="link" onPress={() => void Linking.openSettings()} className="mt-1 self-start">
          <Text className="text-sm font-semibold leading-5 underline">{t("food.openSettings")}</Text>
        </Press>
      </Notice>
    ) : notice === "photo_failed" ? (
      <Notice alert>{t("food.photoFailed")}</Notice>
    ) : null;

  let body: ReactNode;
  let footer: ReactNode = null;
  const errorLine = error ? <FormAlert>{error}</FormAlert> : null;

  if (step === "estimating") {
    body = (
      <View className="gap-4 pt-2" accessibilityLiveRegion="polite">
        {photo ? (
          <Image source={{ uri: `data:${photo.mediaType};base64,${photo.base64}` }} resizeMode="cover" accessibilityLabel={t("food.photoAlt")} className="h-48 w-full rounded-2xl bg-inset" />
        ) : (
          <View className="rounded-xl bg-inset p-3">
            <Text className="text-base leading-[22px]">{`“${text.trim()}”`}</Text>
          </View>
        )}
        <View className="flex-row items-center gap-3">
          <ActivityIndicator />
          <View className="flex-1 gap-0.5">
            <Text className="text-base font-semibold leading-[21px]">{t("food.estimating", { provider })}</Text>
            <Text className={CAPTION}>{t("food.estimatingNote")}</Text>
          </View>
        </View>
      </View>
    );
    footer = (
      <Button variant="outline-pill" onPress={cancel}>
        {t("actions.cancel", { ns: "common" })}
      </Button>
    );
  } else if (step === "failed" && problem) {
    const copy = problemCopy(problem, provider, !!photo);
    body = (
      <View className="gap-3 pt-2">
        <Notice title={copy.title} alert={problem !== "no_food"}>
          <Text className={BODY}>{copy.body}</Text>
          {problem === "no_food" && note ? <Text className={BODY}>{note}</Text> : null}
        </Notice>
      </View>
    );
    // The same request again where the failure was passing (slow, busy, offline, a garbled answer); another photo or
    // other words where the answer itself was no (nothing found, declined); neither with a refused key.
    const other = problem === "no_food" || problem === "refused";
    const canRetry = problem !== "key" && (!!photo || !!text.trim());
    footer = (
      <>
        {canRetry && (
          <Button onPress={other ? again : retry}>
            {other ? (photo ? t("food.tryAnotherPhoto") : t("food.changeDescription")) : t("actions.tryAgain", { ns: "common" })}
          </Button>
        )}
        <Button variant={canRetry ? "outline-pill" : "default"} onPress={typeIt}>
          {t("food.enterYourself")}
        </Button>
      </>
    );
  } else if (step === "review") {
    const total = drafts.reduce((t, d) => ({ kcal: t.kcal + n0(d.form.kcal), protein: t.protein + n0(d.form.protein), carbs: t.carbs + n0(d.form.carbs), fat: t.fat + n0(d.form.fat) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    body = (
      <View className="gap-6 pt-2">
        {note ? <Notice>{note}</Notice> : null}
        <Section title={t("food.total")}>
          <View accessible accessibilityLabel={t("food.totalA11y", { kcal: Math.round(total.kcal), protein: gramsText(total.protein), carbs: gramsText(total.carbs), fat: gramsText(total.fat) })} className="flex-row flex-wrap items-baseline gap-x-3.5 gap-y-1">
            {(
              [
                [grouped(total.kcal), "kcal"],
                [gramsText(total.protein), "protein"],
                [gramsText(total.carbs), "carbs"],
                [gramsText(total.fat), "fat"],
              ] as const
            ).map(([v, unit]) => (
              <Text key={unit} className="text-[13px] font-medium leading-[22px] text-muted-foreground">
                <Text className="font-numeric text-xl font-bold leading-[22px] tabular-nums text-foreground">{v}</Text>
                {` ${t(`unit.${unit}`)}`}
              </Text>
            ))}
          </View>
        </Section>
        <Section title={t("food.foods", { count: drafts.length })}>
          <Text className={CAPTION}>{t("food.estimatesNote")}</Text>
          {drafts.length ? (
            <View className="rounded-xl bg-inset px-3">
              {drafts.map((d, i) => (
                <View key={d.key} className={i > 0 ? "border-t border-border" : undefined}>
                  <DraftRow
                    d={d}
                    onToggle={() => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, open: !x.open } : x)))}
                    onChange={(k, v) => setDraft(d.key, k, v)}
                    onRemove={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                  />
                </View>
              ))}
            </View>
          ) : (
            <Text className={CAPTION}>{t("food.noFoodsLeft")}</Text>
          )}
        </Section>
        {mealSection}
        {timeSection}
        <Text className={CAPTION}>{via === "photo" ? t("food.viaPhoto") : t("food.viaText")}</Text>
      </View>
    );
    footer = (
      <>
        {errorLine}
        <Button onPress={saveReview} disabled={saving || !drafts.length}>
          {saving ? t("food.saving") : drafts.length > 1 ? t("food.saveMany", { count: drafts.length }) : t("actions.save", { ns: "common" })}
        </Button>
        <Button variant="outline-pill" onPress={typeIt} disabled={saving}>
          {t("food.enterYourself")}
        </Button>
      </>
    );
  } else if (showTyped) {
    body = (
      <View className="gap-6 pt-2">
        {!edit && step === "start" && todayLine}
        {!edit && !hasKey && setup !== undefined && noKey}
        {mealSection}
        <Section title={t("food.whatYouAte")}>
          <FoodFields form={form} onChange={setField} />
        </Section>
        {timeSection}
        {edit?.via === "photo" && <Text className={CAPTION}>{t("food.fromPhotoNote")}</Text>}
      </View>
    );
    footer = (
      <>
        {errorLine}
        <Button onPress={saveTyped} disabled={saving}>
          {saving ? t("food.saving") : edit ? t("food.saveChanges") : t("actions.save", { ns: "common" })}
        </Button>
        {!edit && hasKey && (
          <Button variant="outline-pill" onPress={again} disabled={saving}>
            {t("food.estimateInstead")}
          </Button>
        )}
      </>
    );
  } else {
    // The ways in (a coach key is set up, or the setup is still loading).
    body = (
      <View className="gap-6 pt-2">
        {todayLine}
        {notice === "no_key" ? noKey : null}
        <Section title={t("food.estimateTitle")}>
          <View className="flex-row gap-2">
            <MethodTile icon={Camera} label={t("food.takePhoto")} onPress={() => void fromPhoto("camera")} disabled={busy || !hasKey} />
            <MethodTile icon={ImagePlus} label={t("food.choosePhoto")} onPress={() => void fromPhoto("library")} disabled={busy || !hasKey} />
          </View>
          {busy && (
            <View accessibilityLiveRegion="polite" className="flex-row items-center gap-2.5">
              <ActivityIndicator />
              <Text className={BODY}>{t("food.gettingPhoto")}</Text>
            </View>
          )}
          {startNotice}
          <Field label={t("food.describeLabel")} hint={t("food.describeHint")}>
            <Input
              accessibilityLabel={t("food.describeA11y")}
              value={text}
              onChangeText={setText}
              placeholder={t("food.describePlaceholder")}
              maxLength={MAX_DESCRIPTION}
              multiline
              submitBehavior="blurAndSubmit"
              returnKeyType="done"
              onSubmitEditing={fromText}
              className="text-base"
            />
          </Field>
          <Button variant="secondary" onPress={fromText} disabled={text.trim().length < 2 || !hasKey}>
            <Icon icon={Sparkles} size={16} tone="secondary-foreground" />
            <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">{t("food.estimateFromDescription")}</Text>
          </Button>
          {hasKey && (
            <View className="flex-row items-start gap-2">
              <Icon icon={ShieldCheck} size={16} tone="muted-foreground" />
              <Text className={cn(CAPTION, "flex-1")}>{t("food.privacy", { provider })}</Text>
            </View>
          )}
        </Section>
        <Section title={t("food.enterTitle")}>
          <Button variant="secondary" onPress={typeIt}>
            <Icon icon={PencilLine} size={16} tone="secondary-foreground" />
            <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">{t("food.typeFood")}</Text>
          </Button>
        </Section>
      </View>
    );
  }

  const title = edit ? t("food.titleEdit") : step === "review" ? t("food.titleReview") : step === "estimating" ? t("food.titleEstimating") : t("food.titleLog");
  return (
    <TaskPage title={title} description={t("food.description")} footer={footer ?? undefined}>
      {body}
    </TaskPage>
  );
}
