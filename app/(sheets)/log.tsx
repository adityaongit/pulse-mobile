import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Droplet } from "lucide-react-native";
import { logEntry, type LogInput } from "@/actions/log";
import { store } from "@/data/store";
import { dayLabel } from "@/lib/format";
import { CYCLE_SYMPTOMS, FLOWS, KIND_LABEL, LOG_KINDS, MEALS, MOODS, OVULATION_RESULTS, RECONNECT, SYMPTOMS, VALENCES, WATER_STEPS, type LogKind } from "@/lib/log";
import { getLog } from "@/queries/log";
import { todayOf } from "@/queries/common";
import { parseDay } from "@/lib/url";
import { DateTimeField } from "@/screens/log/DateTimeField";
import { Chips, Field, FormAlert, Input } from "@/screens/log/fields";
import { CONNECT_HREF } from "@/screens/log/connect";
import { defaultAt, EMPTY, toInput, wallNow, type Form } from "@/screens/log/form";
import { toast } from "@/ui/Toast";
import { useScreen } from "@/screens/useScreen";
import { Button } from "@/ui/Button";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { CAPTION } from "@/ui/metrics/primitives";
import { SheetScreen, SheetSection } from "@/ui/shells/SheetScreen";
import { closeSheet } from "@/ui/shells/sheets";
import { Text } from "@/ui/Text";
import { cn } from "@/ui/cn";

/** A log sheet (spec §11 LG1): /log?kind=water&d=2026-10-02, the web's `?log=water` over Journal's day. */
export default function LogSheet() {
  const { kind: raw, d } = useLocalSearchParams<{ kind?: string; d?: string }>();
  const kind = (LOG_KINDS as readonly string[]).includes(raw ?? "") ? (raw as LogKind) : "water";
  const { data: vm } = useScreen((ctx) => getLog(ctx, parseDay(d, todayOf(ctx)).d), [d]);
  const [form, setForm] = useState<Form>(EMPTY[kind]);
  const [at, setAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnect, setReconnect] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: string) => (v: string | string[]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };

  const title = `Log ${KIND_LABEL[kind].toLowerCase()}`;
  // As tall as the content, except the long forms: those take the web drawer's 92 % and scroll (the route's detents are set the same way in app/_layout.tsx).
  const size = kind === "food" || kind === "mood" || kind === "symptoms" ? "tall" : "default";
  if (!vm)
    return (
      <SheetScreen title={title} size={size}>
        <View className="h-40" />
      </SheetScreen>
    );

  const access = vm.access[kind];
  const blocked = reconnect || access === "not_connected" || access === "reconnect";
  const time = at ?? defaultAt(vm);
  const now = wallNow(vm.timeZone);

  const send = async (input: LogInput, close = true) => {
    setSaving(true);
    setError(null);
    const r = await logEntry(store, input).catch(() => ({ ok: false as const, error: "Couldn’t save. Check your connection and try again." }));
    setSaving(false);
    if (!r.ok) {
      haptic.error();
      if (r.error === RECONNECT) setReconnect(true);
      else setError(r.error);
      return;
    }
    if (close) closeSheet();
    toast.success(`${KIND_LABEL[input.kind]} saved to Google Health`);
  };
  const save = () => {
    const input = toInput(kind, form, time);
    if (typeof input === "string") return setError(input);
    void send(input);
  };

  const timeField = kind !== "period" && <DateTimeField label="Time" mode="datetime" value={time} max={now} onChange={setAt} />;
  const field = (k: string, label: string, hint: string | undefined, o: { mode: "numeric" | "decimal" | "text"; placeholder?: string; maxLength?: number; className?: string }) => (
    <Field key={k} label={label} hint={hint} className={o.className}>
      <Input accessibilityLabel={label} inputMode={o.mode} placeholder={o.placeholder} maxLength={o.maxLength} value={form[k] as string} onChangeText={set(k)} className={o.mode === "text" ? "text-base" : "text-base tabular-nums"} returnKeyType="done" />
    </Field>
  );
  const when = (children: React.ReactNode) => <Section title="When">{children}</Section>;

  return (
    <SheetScreen
      title={title}
      description={blocked ? undefined : "Saved to Google Health"}
      size={size}
      footer={
        blocked ? null : (
          <>
            {error && <FormAlert>{error}</FormAlert>}
            <Button size="sheet" onPress={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        )
      }
    >
      {blocked ? (
        <View className="gap-4 pt-2">
          <Text className="max-w-[65ch] text-[15px] leading-[22px] text-foreground-secondary">
            {access === "not_connected" ? "Connect Google to log to Google Health." : `Pulse needs new permissions to save ${KIND_LABEL[kind].toLowerCase()} to Google Health. Reconnect Google and allow them; nothing you have synced is lost.`}
          </Text>
          <Button size="sheet" onPress={() => router.replace(CONNECT_HREF)}>
            {access === "not_connected" ? "Connect Google" : "Reconnect Google"}
          </Button>
        </View>
      ) : (
        <View className="gap-6 pt-2">
          {kind === "water" && (
            <>
              <Section title="Add">
                <View className="flex-row gap-2">
                  {WATER_STEPS.map((ml) => (
                    <Button key={ml} variant="secondary" disabled={saving} className="h-14 flex-1 gap-2" onPress={() => void send({ kind: "water", ml, at: time }, false)}>
                      <Icon icon={Droplet} size={20} strokeWidth={1.75} tone="secondary-foreground" />
                      <Text className="text-[15px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">+{ml} ml</Text>
                    </Button>
                  ))}
                </View>
                <Text accessibilityLiveRegion="polite" className={cn(CAPTION, "tabular-nums")}>
                  {dayLabel(vm.day, vm.today)}: {vm.water.total.toLocaleString("en-US")} ml
                </Text>
              </Section>
              <Section title="Other amount">
                {field("ml", "Amount", "(ml)", { mode: "numeric", placeholder: "e.g. 330" })}
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
                {field("kg", "Weight", "(kg)", { mode: "decimal", className: "flex-1" })}
                {field("fat", "Body fat", "(%)", { mode: "decimal", placeholder: "Optional", className: "flex-1" })}
              </View>
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
      )}
    </SheetScreen>
  );
}

/** A caps heading with the reference app's hairline over its controls (the web's Section inside the form). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <SheetSection>{title}</SheetSection>
      {children}
    </View>
  );
}
