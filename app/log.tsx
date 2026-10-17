import { useState } from "react";
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

  const title = `Log ${KIND_LABEL[kind].toLowerCase()}`;
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
    const r = await logEntry(actionCtx(), input).catch(() => ({ ok: false as const, error: "Couldn’t save. Try again." }));
    setSaving(false);
    if (!r.ok) {
      haptic.error();
      setError(r.error);
      return;
    }
    dataChanged();
    if (close) goBack();
    toast.success(`${KIND_LABEL[input.kind]} saved`);
  };
  const save = () => {
    const input = toInput(kind, form, time);
    if (typeof input === "string") return setError(input);
    void send(input);
  };

  const timeField = kind !== "period" && (
    <Field label="Time">
      <DateTimeField label="Time" mode="datetime" value={time} max={now} onChange={setAt} />
    </Field>
  );
  const field = (k: string, label: string, hint: string | undefined, o: { mode: "numeric" | "decimal" | "text"; placeholder?: string; maxLength?: number; className?: string }) => (
    <Field key={k} label={label} hint={hint} className={o.className}>
      <Input accessibilityLabel={label} inputMode={o.mode} placeholder={o.placeholder} maxLength={o.maxLength} value={form[k] as string} onChangeText={set(k)} className={o.mode === "text" ? "text-base" : "text-base tabular-nums"} returnKeyType="done" />
    </Field>
  );
  const when = (children: React.ReactNode) => <Section title="When">{children}</Section>;

  return (
    <TaskPage
      title={title}
      description="Kept on this phone"
      footer={
        <>
          {!!error && <FormAlert>{error}</FormAlert>}
          <Button onPress={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <View className="gap-6 pt-2">
          {kind === "water" && (
            <>
              <Section title="Add">
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
              <Section title="Other amount">
                {field("ml", "Amount", `(${water.unit})`, { mode: "numeric", placeholder: `e.g. ${waterSteps()[0]}` })}
                {timeField}
              </Section>
            </>
          )}

          {kind === "food" && (
            <>
              <Section title="Meal">
                <Chips label="Meal" options={MEALS} value={form.meal as string} onChange={set("meal")} />
              </Section>
              <Section title="What you ate">
                {field("name", "Name", "(optional)", { mode: "text", placeholder: "e.g. Dal and rice", maxLength: 80 })}
                {field("kcal", "Calories", "(kcal)", { mode: "numeric" })}
                <View className="flex-row gap-2">
                  {(["protein", "carbs", "fat"] as const).map((m) => field(m, m[0].toUpperCase() + m.slice(1), "(g)", { mode: "decimal", className: "flex-1" }))}
                </View>
                {timeField}
              </Section>
            </>
          )}

          {kind === "weight" && (
            <Section title="Measurement">
              <View className="flex-row gap-2">
                {field("kg", "Weight", `(${quantity("kg").unit})`, { mode: "decimal", className: "flex-1" })}
                {field("fat", "Body fat", "(%)", { mode: "decimal", placeholder: "Optional", className: "flex-1" })}
              </View>
              {timeField}
            </Section>
          )}

          {kind === "spo2" && (
            <Section title="Reading">
              {field("pct", "Blood oxygen", "(%)", { mode: "decimal", placeholder: "e.g. 95" })}
              <Text className={CAPTION}>The morning reading from the Fitbit app (Google Health doesn’t share blood oxygen with Health Connect).</Text>
              {timeField}
            </Section>
          )}

          {kind === "mood" && (
            <>
              <Section title="Overall">
                <Chips label="Overall" options={VALENCES} value={form.valence as string} onChange={set("valence")} />
              </Section>
              <Section title="Feelings">
                <Chips label="Feelings" options={MOODS} value={form.moods as string[]} onChange={set("moods")} />
              </Section>
              {when(timeField)}
            </>
          )}

          {kind === "symptoms" && (
            <>
              <Section title="Symptoms">
                <Chips label="Symptoms" options={SYMPTOMS.filter((s) => vm.kinds.includes("period") || !CYCLE_SYMPTOMS.has(s[0]))} value={form.symptoms as string[]} onChange={set("symptoms")} />
              </Section>
              {when(timeField)}
            </>
          )}

          {kind === "period" && (
            <>
              <Section title="Days">
                <View className="flex-row gap-2">
                  <Field label="First day" className="flex-1">
                    <DateTimeField label="First day" mode="date" value={form.start as string} max={vm.today} onChange={set("start")} />
                  </Field>
                  <Field label="Last day" className="flex-1">
                    <DateTimeField label="Last day" mode="date" value={form.end as string} max={vm.today} min={(form.start as string) || undefined} onChange={set("end")} />
                  </Field>
                </View>
                <Text className={CAPTION}>Still going? Use today as the last day, and log it again once it ends.</Text>
              </Section>
              <Section title="Flow">
                <Chips label="Flow" options={FLOWS} value={form.flow as string} onChange={set("flow")} />
              </Section>
            </>
          )}

          {kind === "ovulation" && (
            <>
              <Section title="Result">
                <Chips label="Result" options={OVULATION_RESULTS} value={form.result as string} onChange={set("result")} />
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
