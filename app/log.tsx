import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Droplet } from "lucide-react-native";
import { logEntry, type LogInput } from "@/actions/log";
import { dayLabel, quantityText } from "@/lib/format";
import { quantity } from "@/lib/units";
import { CYCLE_SYMPTOMS, FLOWS, KIND_LABEL, LOG_KINDS, MEALS, MOODS, OVULATION_RESULTS, SYMPTOMS, VALENCES, waterSteps, type LogKind } from "@/queries/log";
import { getDayLog } from "@/queries/journalExtras";
import { todayOf } from "@/queries/common";
import { parseDay } from "@/lib/url";
import { DateTimeField } from "@/screens/log/DateTimeField";
import { Chips, Field, FormAlert, Input } from "@/screens/log/fields";
import { actionCtx, dataChanged } from "@/state/app";
import { defaultAt, EMPTY, toInput, wallNow, type Form } from "@/screens/log/form";
import { toast } from "@/ui/Toast";
import { useScreen } from "@/screens/useScreen";
import { Button } from "@/ui/Button";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { CAPTION } from "@/ui/metrics/primitives";
import { TaskPage, TaskSection } from "@/ui/shells/TaskPage";
import { Text } from "@/ui/Text";
import { cn } from "@/ui/cn";
import { goBack } from "@/ui/navigate";

/** A log sheet (spec §11 LG1): /log?kind=water&d=2026-10-02, the web's `?log=water` over Journal's day. */
export default function LogPage() {
  // Water and weight are typed in the person's units (src/lib/units.ts) and kept in ml and kg.
  const { t } = useTranslation("ui");
  const water = quantity("ml");
  const { kind: raw, d } = useLocalSearchParams<{ kind?: string; d?: string }>();
  const kind = (LOG_KINDS as readonly string[]).includes(raw ?? "") ? (raw as LogKind) : "water";
  const { data: vm } = useScreen((ctx) => getDayLog(parseDay(d, todayOf(ctx)).d, ctx), ["log", d]);
  const [form, setForm] = useState<Form>(EMPTY[kind]);
  const [at, setAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string) => (v: string | string[]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };

  const title = t(`logForm.title.${kind}`);
  if (!vm)
    return (
      <TaskPage title={title}>
        <View className="h-40" />
      </TaskPage>
    );

  const time = at ?? defaultAt(vm);
  const now = wallNow(vm.timeZone);

  const send = async (input: LogInput, close = true) => {
    setSaving(true);
    setError(null);
    const r = await logEntry(actionCtx(), input).catch(() => ({ ok: false as const, error: t("logForm.saveFailed") }));
    setSaving(false);
    if (!r.ok) {
      haptic.error();
      setError(r.error);
      return;
    }
    dataChanged();
    if (close) goBack();
    toast.success(t("logForm.saved", { kind: KIND_LABEL[input.kind] }));
  };
  const save = () => {
    const input = toInput(kind, form, time);
    if (typeof input === "string") return setError(input);
    void send(input);
  };

  const timeField = kind !== "period" && (
    <Field label={t("logForm.time")}>
      <DateTimeField label={t("logForm.time")} mode="datetime" value={time} max={now} onChange={setAt} />
    </Field>
  );
  const field = (k: string, label: string, hint: string | undefined, o: { mode: "numeric" | "decimal" | "text"; placeholder?: string; maxLength?: number; className?: string }) => (
    <Field key={k} label={label} hint={hint} className={o.className}>
      <Input accessibilityLabel={label} inputMode={o.mode} placeholder={o.placeholder} maxLength={o.maxLength} value={form[k] as string} onChangeText={set(k)} className={o.mode === "text" ? "text-base" : "text-base tabular-nums"} returnKeyType="done" />
    </Field>
  );
  const when = (children: React.ReactNode) => <Section title={t("logForm.when")}>{children}</Section>;

  return (
    <TaskPage
      title={title}
      description={t("logForm.keptOnPhone")}
      footer={
        <>
          {!!error && <FormAlert>{error}</FormAlert>}
          <Button onPress={save} disabled={saving}>
            {saving ? t("logForm.saving") : t("actions.save", { ns: "common" })}
          </Button>
        </>
      }
    >
      <View className="gap-6 pt-2">
          {kind === "water" && (
            <>
              <Section title={t("logForm.add")}>
                <View className="flex-row gap-2">
                  {waterSteps().map((step) => (
                    <Button key={step} variant="secondary" disabled={saving} className="h-14 flex-1 gap-2" onPress={() => void send({ kind: "water", ml: Math.round(water.stored(step)), at: time }, false)}>
                      <Icon icon={Droplet} size={20} strokeWidth={1.75} tone="secondary-foreground" />
                      <Text className="text-[15px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">+{step} {water.unit}</Text>
                    </Button>
                  ))}
                </View>
                <Text accessibilityLiveRegion="polite" className={cn(CAPTION, "tabular-nums")}>
                  {dayLabel(vm.day, vm.today)}: {quantityText(vm.water.total, "ml", "grouped")}
                </Text>
              </Section>
              <Section title={t("logForm.otherAmount")}>
                {field("ml", t("logForm.amount"), `(${water.unit})`, { mode: "numeric", placeholder: t("logForm.amountExample", { value: waterSteps()[0] }) })}
                {timeField}
              </Section>
            </>
          )}

          {kind === "food" && (
            <>
              <Section title={t("logForm.meal")}>
                <Chips label={t("logForm.meal")} options={MEALS} value={form.meal as string} onChange={set("meal")} />
              </Section>
              <Section title={t("logForm.whatYouAte")}>
                {field("name", t("logForm.name"), t("logForm.optionalHint"), { mode: "text", placeholder: t("logForm.nameExample"), maxLength: 80 })}
                {field("kcal", t("logForm.calories"), "(kcal)", { mode: "numeric" })}
                <View className="flex-row gap-2">
                  {(["protein", "carbs", "fat"] as const).map((m) => field(m, t(`logForm.${m}`), "(g)", { mode: "decimal", className: "flex-1" }))}
                </View>
                {timeField}
              </Section>
            </>
          )}

          {kind === "weight" && (
            <Section title={t("logForm.measurement")}>
              <View className="flex-row gap-2">
                {field("kg", t("logForm.weight"), `(${quantity("kg").unit})`, { mode: "decimal", className: "flex-1" })}
                {field("fat", t("logForm.bodyFat"), "(%)", { mode: "decimal", placeholder: t("logForm.optionalPlaceholder"), className: "flex-1" })}
              </View>
              {timeField}
            </Section>
          )}

          {kind === "spo2" && (
            <Section title={t("logForm.reading")}>
              {field("pct", t("logForm.bloodOxygen"), "(%)", { mode: "decimal", placeholder: t("logForm.bloodOxygenExample") })}
              <Text className={CAPTION}>{t("logForm.bloodOxygenNote")}</Text>
              {timeField}
            </Section>
          )}

          {kind === "mood" && (
            <>
              <Section title={t("logForm.overall")}>
                <Chips label={t("logForm.overall")} options={VALENCES} value={form.valence as string} onChange={set("valence")} />
              </Section>
              <Section title={t("logForm.feelings")}>
                <Chips label={t("logForm.feelings")} options={MOODS} value={form.moods as string[]} onChange={set("moods")} />
              </Section>
              {when(timeField)}
            </>
          )}

          {kind === "symptoms" && (
            <>
              <Section title={t("logForm.symptoms")}>
                <Chips label={t("logForm.symptoms")} options={SYMPTOMS.filter((s) => vm.kinds.includes("period") || !CYCLE_SYMPTOMS.has(s[0]))} value={form.symptoms as string[]} onChange={set("symptoms")} />
              </Section>
              {when(timeField)}
            </>
          )}

          {kind === "period" && (
            <>
              <Section title={t("logForm.days")}>
                <View className="flex-row gap-2">
                  <Field label={t("logForm.firstDay")} className="flex-1">
                    <DateTimeField label={t("logForm.firstDay")} mode="date" value={form.start as string} max={vm.today} onChange={set("start")} />
                  </Field>
                  <Field label={t("logForm.lastDay")} className="flex-1">
                    <DateTimeField label={t("logForm.lastDay")} mode="date" value={form.end as string} max={vm.today} min={(form.start as string) || undefined} onChange={set("end")} />
                  </Field>
                </View>
                <Text className={CAPTION}>{t("logForm.periodNote")}</Text>
              </Section>
              <Section title={t("logForm.flow")}>
                <Chips label={t("logForm.flow")} options={FLOWS} value={form.flow as string} onChange={set("flow")} />
              </Section>
            </>
          )}

          {kind === "ovulation" && (
            <>
              <Section title={t("logForm.result")}>
                <Chips label={t("logForm.result")} options={OVULATION_RESULTS} value={form.result as string} onChange={set("result")} />
              </Section>
              {when(timeField)}
            </>
          )}
      </View>
    </TaskPage>
  );
}

/** A caps heading with the reference app's hairline over its controls (the web's Section inside the form). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <TaskSection>{title}</TaskSection>
      {children}
    </View>
  );
}
