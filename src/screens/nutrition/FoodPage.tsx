// The food sheet `/food?d=&edit=` (spec §7.22): halo's src/screens/nutrition/FoodPage.tsx in Pulse's sheet kit. Add
// food three ways (a photo, taken or chosen; a few words; or typed in), check an AI estimate as an editable list before
// saving, and edit a food logged in Pulse. Opened from Nutrition and from the Journal's Food tile.
//
// Estimates use the person's own coach provider and key (src/nutrition/model.ts); without one the sheet says so and
// offers the typed form. The photo is scaled and sent once (src/nutrition/photo.ts, estimate.ts), held in memory only
// until its estimate is in (or for a retry after a failure) and never saved. Closing the sheet (a route) unmounts it,
// which stops a running estimate.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Keyboard, Linking, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Camera, ImagePlus, PencilLine, ShieldCheck, Sparkles, Trash2, type LucideIcon } from "lucide-react-native";
import type { ActionResult } from "@/actions/journal";
import { logFoods, updateFoodEntry, type FoodItemInput } from "@/actions/log";
import { FORMATS } from "@/lib/format";
import { wall } from "@/lib/time";
import { parseDay } from "@/lib/url";
import { estimateFood, MAX_DESCRIPTION, type Confidence, type EstimateInput, type EstimateProblem } from "@/nutrition/estimate";
import { deviceModel, providerLabel, useCoachSetup } from "@/nutrition/model";
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
  const field = (k: keyof FoodForm, label: string, hint: string, mode: "text" | "numeric" | "decimal", placeholder?: string, maxLength?: number) => (
    <Field key={k} label={label} hint={hint} className={mode === "text" ? undefined : "flex-1"}>
      <Input accessibilityLabel={label} inputMode={mode} placeholder={placeholder} maxLength={maxLength} value={form[k]} onChangeText={(t) => onChange(k, t)} className={mode === "text" ? "text-base" : "text-base tabular-nums"} returnKeyType="done" />
    </Field>
  );
  return (
    <View className="gap-3">
      {field("name", "Name", "(optional)", "text", "e.g. Dal and rice", 80)}
      {field("portion", "Portion", "(optional)", "text", "e.g. 1 bowl (250 g)", 60)}
      <View className="flex-row gap-2">
        {field("kcal", "Calories", "(kcal)", "numeric")}
        {field("protein", "Protein", "(g)", "decimal")}
      </View>
      <View className="flex-row gap-2">
        {field("carbs", "Carbs", "(g)", "decimal")}
        {field("fat", "Fat", "(g)", "decimal")}
      </View>
      <View className="flex-row gap-2">
        {field("fiber", "Fiber", "(g, optional)", "decimal")}
        <View className="flex-1" />
      </View>
    </View>
  );
}

const CONFIDENCE: Record<Confidence, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

/** A typed number, or 0 while it is blank or not a number yet (for the running total only). */
const n0 = (s: string) => {
  const v = num(s);
  return v === null || Number.isNaN(v) ? 0 : v;
};

/** "182 kcal · 12.6 g protein · 1.6 g carbs · 13.9 g fat": the numbers as typed so far. */
function summaryOf(f: FoodForm) {
  const g = (s: string, word: string) => (num(s) !== null && !Number.isNaN(num(s)) ? `${s.trim().replace(",", ".")} g ${word}` : null);
  return [`${f.kcal.trim() || "?"} kcal`, g(f.protein, "protein"), g(f.carbs, "carbs"), g(f.fat, "fat"), g(f.fiber, "fiber")].filter(Boolean).join(" · ");
}

/** One estimated food under review: name, portion and numbers; the pencil opens its fields, the bin drops it. */
function DraftRow({ d, onToggle, onChange, onRemove }: { d: Draft; onToggle: () => void; onChange: (k: keyof FoodForm, v: string) => void; onRemove: () => void }) {
  const name = d.form.name.trim() || "Food";
  return (
    <View className="gap-3 py-3">
      <View className="flex-row items-start gap-1">
        <Press accessibilityRole="button" accessibilityLabel={`${d.open ? "Close" : "Edit"} ${name}`} accessibilityState={{ expanded: d.open }} onPress={onToggle} className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-semibold leading-[21px]">
            {name}
            {d.form.portion.trim() ? <Text className="text-[15px] font-normal text-muted-foreground">{`  ${d.form.portion.trim()}`}</Text> : null}
          </Text>
          <Text className={cn(BODY, "tabular-nums")}>{summaryOf(d.form)}</Text>
          {d.confidence && <Text className={CAPTION}>{CONFIDENCE[d.confidence]}</Text>}
        </Press>
        <Press activeBg="bg-fill-hover" accessibilityRole="button" accessibilityLabel={`Edit ${name}`} onPress={onToggle} className="size-11 items-center justify-center rounded-full">
          <Icon icon={PencilLine} size={18} tone={d.open ? "foreground" : "muted-foreground"} />
        </Press>
        <Press activeBg="bg-fill-hover" accessibilityRole="button" accessibilityLabel={`Remove ${name}`} onPress={onRemove} className="size-11 items-center justify-center rounded-full">
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
  const instead = "or enter the food yourself.";
  switch (p) {
    case "timeout":
      return { title: "That took too long", body: `${provider} didn’t answer in time. Try again, ${instead}` };
    case "refused":
      return { title: `${provider} didn’t estimate this`, body: `Your AI provider declined this ${photo ? "photo" : "description"}. Try ${photo ? "another photo" : "other words"}, ${instead}` };
    case "unreadable":
      return { title: "The answer wasn’t usable", body: `${provider}’s answer couldn’t be read as nutrition numbers. Try again, ${instead}` };
    case "key":
      return { title: "Your AI key didn’t work", body: `${provider} didn’t accept your key. Check it in the coach’s settings, ${instead}` };
    case "busy":
      return { title: `${provider} is busy`, body: `Your provider is limiting requests right now. Try again in a minute, ${instead}` };
    case "network":
      return { title: "No connection", body: `Pulse couldn’t reach ${provider}. Check your connection and try again, ${instead}` };
    case "no_food":
      return { title: "No food found", body: `${provider} didn’t find food or drink ${photo ? "in this photo" : "in that description"}. Try again, ${instead}` };
    case "provider":
    case "cancelled":
      return { title: "The estimate failed", body: `${provider} couldn’t make the estimate. Try again, ${instead}${photo ? " If it keeps failing, check that your model reads photos." : ""}` };
  }
}

export function FoodPage() {
  const { d, edit: editId } = useLocalSearchParams<{ d?: string; edit?: string }>();
  const { custom, ready } = useNutritionTargets();
  const { data: vm } = useScreen((ctx) => (ready ? getNutrition(ctx, custom).then((v) => ({ v, day: parseDay(d, todayOf(ctx)).d })) : Promise.resolve(null)), ["nutrition", custom, ready, d]);
  if (!vm) return <TaskPage title={editId ? "Edit food" : "Log food"}><View className="h-40" /></TaskPage>;
  const edit = editId ? (vm.v.meals.flatMap((g) => g.items).find((f) => f.id === editId && f.source === "pulse") ?? null) : null;
  const at = edit ? wallOf(edit.ts, vm.v.timeZone) : defaultAt({ day: vm.day, today: vm.v.today, timeZone: vm.v.timeZone });
  const meal = edit && edit.meal !== "UNKNOWN" ? edit.meal : mealAt(at.slice(11, 16));
  return <Sheet edit={edit} at={at} meal={meal} timeZone={vm.v.timeZone} today={vm.day === vm.v.today ? { kcal: vm.v.totals.kcal, protein: vm.v.totals.protein } : null} />;
}

function Sheet({ edit, at: at0, meal: meal0, timeZone, today }: { edit: FoodItem | null; at: string; meal: Meal; timeZone: string; today: { kcal: number | null; protein: number | null } | null }) {
  const setup = useCoachSetup();
  const hasKey = !!setup?.consent && !!setup.provider && !!setup.last4;
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
    const model = await deviceModel();
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
    const r = await run().catch(() => ({ ok: false as const, error: "Couldn’t save. Try again." }));
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
    if (edit) void send(() => updateFoodEntry(actionCtx(), { id: edit.id, ts: edit.ts, meal, at, item }), "Food updated");
    else void send(() => logFoods(actionCtx(), { meal, via: "manual", at, items: [item] }), "Food saved");
  };

  const saveReview = () => {
    const items: FoodItemInput[] = [];
    for (const d of drafts) {
      const item = foodItemOf(d.form);
      if (typeof item === "string") {
        setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, open: true, error: item } : x)));
        return setError(`Fix ${d.form.name.trim() || "a food"} before saving.`);
      }
      items.push(item);
    }
    if (!items.length) return setError("Every food was removed. Take another photo, or enter the food yourself.");
    void send(() => logFoods(actionCtx(), { meal, via, at, items }), items.length === 1 ? "Food saved" : `${items.length} foods saved`);
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
    <Section title="Meal">
      <Chips label="Meal" options={MEALS} value={meal} onChange={(v) => typeof v === "string" && v && setMeal(v as Meal)} />
    </Section>
  );
  const timeSection = (
    <Section title="When">
      <Field label="Time">
        <DateTimeField label="Time" mode="datetime" value={at} max={wallNow(timeZone)} onChange={setAt} />
      </Field>
    </Section>
  );
  const todayLine = today && (
    <Text className={cn(CAPTION, "tabular-nums")}>
      {today.kcal === null ? "Today: nothing logged yet" : `Today: ${grouped(today.kcal)} kcal${today.protein !== null ? ` · ${gramsText(Math.round(today.protein))} g protein` : ""}`}
    </Text>
  );
  const noKey = (
    <Notice title="Photo estimates use your own AI key">
      Add a key from Anthropic, OpenAI, Google or another provider in the coach’s settings, and Pulse can estimate a meal from a photo or a few words. Until then, enter the food yourself.
    </Notice>
  );
  const startNotice =
    notice === "camera_denied" ? (
      <Notice>Pulse needs the camera to take the photo. Allow it when Android asks, or choose a photo instead.</Notice>
    ) : notice === "camera_blocked" ? (
      <Notice title="The camera is off for Pulse">
        <Text className={BODY}>Allow it in Android’s settings for Pulse, or choose a photo instead.</Text>
        <Press accessibilityRole="link" onPress={() => void Linking.openSettings()} className="mt-1 self-start">
          <Text className="text-sm font-semibold leading-5 underline">Open Android settings</Text>
        </Press>
      </Notice>
    ) : notice === "photo_failed" ? (
      <Notice alert>That photo couldn’t be read. Try another, or enter the food yourself.</Notice>
    ) : null;

  let body: ReactNode;
  let footer: ReactNode = null;
  const errorLine = error ? <FormAlert>{error}</FormAlert> : null;

  if (step === "estimating") {
    body = (
      <View className="gap-4 pt-2" accessibilityLiveRegion="polite">
        {photo ? (
          <Image source={{ uri: `data:${photo.mediaType};base64,${photo.base64}` }} resizeMode="cover" accessibilityLabel="Your meal photo" className="h-48 w-full rounded-2xl bg-inset" />
        ) : (
          <View className="rounded-xl bg-inset p-3">
            <Text className="text-base leading-[22px]">{`“${text.trim()}”`}</Text>
          </View>
        )}
        <View className="flex-row items-center gap-3">
          <ActivityIndicator />
          <View className="flex-1 gap-0.5">
            <Text className="text-base font-semibold leading-[21px]">{`Estimating with ${provider}…`}</Text>
            <Text className={CAPTION}>Usually a few seconds; up to a minute for a busy plate.</Text>
          </View>
        </View>
      </View>
    );
    footer = (
      <Button variant="outline-pill" onPress={cancel}>
        Cancel
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
            {other ? (photo ? "Try another photo" : "Change the description") : "Try again"}
          </Button>
        )}
        <Button variant={canRetry ? "outline-pill" : "default"} onPress={typeIt}>
          Enter it yourself
        </Button>
      </>
    );
  } else if (step === "review") {
    const total = drafts.reduce((t, d) => ({ kcal: t.kcal + n0(d.form.kcal), protein: t.protein + n0(d.form.protein), carbs: t.carbs + n0(d.form.carbs), fat: t.fat + n0(d.form.fat) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    body = (
      <View className="gap-6 pt-2">
        {note ? <Notice>{note}</Notice> : null}
        <Section title="Total">
          <View accessible accessibilityLabel={`Total ${Math.round(total.kcal)} kcal, ${gramsText(total.protein)} g protein, ${gramsText(total.carbs)} g carbs, ${gramsText(total.fat)} g fat`} className="flex-row flex-wrap items-baseline gap-x-3.5 gap-y-1">
            {(
              [
                [grouped(total.kcal), "kcal"],
                [gramsText(total.protein), "g protein"],
                [gramsText(total.carbs), "g carbs"],
                [gramsText(total.fat), "g fat"],
              ] as const
            ).map(([v, unit]) => (
              <Text key={unit} className="text-[13px] font-medium leading-[22px] text-muted-foreground">
                <Text className="font-numeric text-xl font-bold leading-[22px] tabular-nums text-foreground">{v}</Text>
                {` ${unit}`}
              </Text>
            ))}
          </View>
        </Section>
        <Section title={drafts.length === 1 ? "Food" : `Foods (${drafts.length})`}>
          <Text className={CAPTION}>Estimates are approximate. Fix any number, or remove what isn’t there, before saving.</Text>
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
            <Text className={CAPTION}>No foods left to save.</Text>
          )}
        </Section>
        {mealSection}
        {timeSection}
        <Text className={CAPTION}>{via === "photo" ? "The photo was used for this estimate only and isn’t kept." : "Your description was used for this estimate only."}</Text>
      </View>
    );
    footer = (
      <>
        {errorLine}
        <Button onPress={saveReview} disabled={saving || !drafts.length}>
          {saving ? "Saving…" : drafts.length > 1 ? `Save ${drafts.length} foods` : "Save"}
        </Button>
        <Button variant="outline-pill" onPress={typeIt} disabled={saving}>
          Enter it yourself
        </Button>
      </>
    );
  } else if (showTyped) {
    body = (
      <View className="gap-6 pt-2">
        {!edit && step === "start" && todayLine}
        {!edit && !hasKey && setup !== undefined && noKey}
        {mealSection}
        <Section title="What you ate">
          <FoodFields form={form} onChange={setField} />
        </Section>
        {timeSection}
        {edit?.via === "photo" && <Text className={CAPTION}>Estimated from a photo. The photo wasn’t kept.</Text>}
      </View>
    );
    footer = (
      <>
        {errorLine}
        <Button onPress={saveTyped} disabled={saving}>
          {saving ? "Saving…" : edit ? "Save changes" : "Save"}
        </Button>
        {!edit && hasKey && (
          <Button variant="outline-pill" onPress={again} disabled={saving}>
            Estimate with AI instead
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
        <Section title="Estimate with AI">
          <View className="flex-row gap-2">
            <MethodTile icon={Camera} label="Take photo" onPress={() => void fromPhoto("camera")} disabled={busy || !hasKey} />
            <MethodTile icon={ImagePlus} label="Choose photo" onPress={() => void fromPhoto("library")} disabled={busy || !hasKey} />
          </View>
          {busy && (
            <View accessibilityLiveRegion="polite" className="flex-row items-center gap-2.5">
              <ActivityIndicator />
              <Text className={BODY}>Getting the photo ready…</Text>
            </View>
          )}
          {startNotice}
          <Field label="Or describe it" hint="(what and how much)">
            <Input
              accessibilityLabel="Describe what you ate"
              value={text}
              onChangeText={setText}
              placeholder="e.g. 2 eggs and a slice of toast"
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
            <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">Estimate from description</Text>
          </Button>
          {hasKey && (
            <View className="flex-row items-start gap-2">
              <Icon icon={ShieldCheck} size={16} tone="muted-foreground" />
              <Text className={cn(CAPTION, "flex-1")}>{`Your photo or description goes only to ${provider}, with your own key, for this estimate. Pulse doesn’t save the photo.`}</Text>
            </View>
          )}
        </Section>
        <Section title="Or enter it yourself">
          <Button variant="secondary" onPress={typeIt}>
            <Icon icon={PencilLine} size={16} tone="secondary-foreground" />
            <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">Type the food and its numbers</Text>
          </Button>
        </Section>
      </View>
    );
  }

  const title = edit ? "Edit food" : step === "review" ? "Check the estimate" : step === "estimating" ? "Estimating…" : "Log food";
  return (
    <TaskPage title={title} description="Kept on this phone" footer={footer ?? undefined}>
      {body}
    </TaskPage>
  );
}
