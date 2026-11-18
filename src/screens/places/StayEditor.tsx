// `/timeline/edit?start=&end=&o=&p=&l=&lat=&lon=&open=`: fix one stay by hand. The place (a saved one, or an unknown
// stop with an optional name), its arrival and departure in 5-minute steps, or delete it. An unknown stop can become a
// saved place. Saving writes an override (src/actions/places.ts); the detected stay underneath is never rewritten.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Minus, Plus } from "lucide-react-native";
import { deleteStay, editStay, MAX_PLACE_NAME } from "@/actions/places";
import { clock } from "@/lib/format";
import { getPlacesSettings } from "@/queries/timeline";
import { actionCtx } from "@/state/app";
import { timelineChanged } from "@/state/places";
import { Chips, Field, FormAlert, Input } from "@/screens/log/fields";
import { ConfirmDialog } from "@/screens/settings/controls";
import { useScreen } from "@/screens/useScreen";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { goBack, push } from "@/ui/navigate";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { haptic } from "@/ui/haptics";
import { TaskPage, TaskSection } from "@/ui/shells/TaskPage";
import { useShellCalendar } from "@/ui/shells/ShellStatus";

const STEP_S = 5 * 60;
const UNKNOWN = "unknown";
const nowS = () => Math.floor(Date.now() / 1000);
const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function StayEditor() {
  const { t } = useTranslation("places");
  const p = useLocalSearchParams<{ start?: string; end?: string; o?: string; p?: string; l?: string; lat?: string; lon?: string; open?: string }>();
  const { data } = useScreen(getPlacesSettings, ["places-settings"], { eager: true });
  const start0 = num(p.start);
  const end0 = num(p.end);
  if (!data || start0 === null || end0 === null) return <TaskPage title={t("edit.title")}><View className="h-40" /></TaskPage>;
  return (
    <StayForm
      places={data.places.map(({ id, name }) => ({ id, name }))}
      original={{ start: start0, end: end0, overrideId: p.o || null }}
      placeId={p.p || null}
      label={p.l ?? ""}
      latitude={num(p.lat)}
      longitude={num(p.lon)}
      open={p.open === "1"}
    />
  );
}

function StayForm({
  places,
  original,
  placeId: place0,
  label: label0,
  latitude,
  longitude,
  open,
}: {
  places: { id: string; name: string }[];
  original: { start: number; end: number; overrideId: string | null };
  placeId: string | null;
  label: string;
  latitude: number | null;
  longitude: number | null;
  open: boolean;
}) {
  const { t } = useTranslation("places");
  const { timeZone } = useShellCalendar();
  const [placeId, setPlaceId] = useState<string>(place0 && places.some((x) => x.id === place0) ? place0 : UNKNOWN);
  const [label, setLabel] = useState(label0);
  const [start, setStart] = useState(original.start);
  const [end, setEnd] = useState(original.end);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const unknown = placeId === UNKNOWN;

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await editStay(actionCtx().store, original, { start, end, placeId: unknown ? null : placeId, label: unknown ? label : null, latitude, longitude }, nowS()).catch(() => ({ ok: false as const, error: "times" as const }));
    setSaving(false);
    if (!res.ok) {
      haptic.error();
      return setError(t(res.error === "future" ? "edit.future" : "edit.invalidTimes"));
    }
    timelineChanged();
    toast.success(t("edit.saved"));
    goBack();
  };

  const remove = async () => {
    setSaving(true);
    await deleteStay(actionCtx().store, original, nowS()).catch(() => {});
    setSaving(false);
    setConfirm(false);
    timelineChanged();
    toast.success(t("edit.deleted"));
    goBack();
  };

  const saveAsPlace = () => {
    if (latitude === null || longitude === null) return;
    const q = [`lat=${latitude}`, `lon=${longitude}`, label.trim() ? `name=${encodeURIComponent(label.trim())}` : ""].filter(Boolean).join("&");
    push(`/places/edit?${q}`);
  };

  return (
    <TaskPage
      title={t("edit.title")}
      footer={
        <>
          {!!error && <FormAlert>{error}</FormAlert>}
          <Button onPress={() => void save()} disabled={saving}>
            {saving ? t("edit.saving") : t("edit.save")}
          </Button>
          <Button variant="outline" textClassName="text-recovery-red-text" onPress={() => setConfirm(true)} disabled={saving}>
            {t("edit.delete")}
          </Button>
        </>
      }
    >
      <View className="gap-6 pt-2">
        <View className="gap-3">
          <TaskSection>{t("edit.place")}</TaskSection>
          <Chips
            label={t("edit.place")}
            options={[...places.map((x) => [x.id, x.name] as const), [UNKNOWN, t("stay.unknown")] as const]}
            value={placeId}
            onChange={(v) => typeof v === "string" && v && setPlaceId(v)}
          />
          {unknown && (
            <>
              <Field label={t("edit.label")} hint={t("edit.optional")}>
                <Input value={label} onChangeText={setLabel} placeholder={t("edit.labelPlaceholder")} maxLength={MAX_PLACE_NAME} accessibilityLabel={t("edit.label")} />
              </Field>
              {latitude !== null && longitude !== null && (
                <Button variant="secondary" onPress={saveAsPlace}>
                  {t("edit.saveAsPlace")}
                </Button>
              )}
            </>
          )}
        </View>
        <View className="gap-3">
          <TaskSection>{t("edit.times")}</TaskSection>
          <TimeStepper label={t("edit.arrived")} ts={start} timeZone={timeZone} onChange={(v) => (setStart(v), setError(null))} />
          <TimeStepper label={t("edit.left")} ts={end} timeZone={timeZone} onChange={(v) => (setEnd(Math.min(v, nowS())), setError(null))} />
          {open && <Text className="text-[13px] leading-[18px] text-muted-foreground">{t("edit.openNote")}</Text>}
        </View>
      </View>
      <ConfirmDialog
        open={confirm}
        title={t("edit.deleteTitle")}
        description={t("edit.deleteBody")}
        confirmLabel={t("edit.delete")}
        pendingLabel={t("edit.saving")}
        pending={saving}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void remove()}
      />
    </TaskPage>
  );
}

function TimeStepper({ label, ts, timeZone, onChange }: { label: string; ts: number; timeZone?: string; onChange: (ts: number) => void }) {
  const { t } = useTranslation("places");
  const time = clock(ts * 1000, timeZone);
  const step = (by: number) => {
    haptic.select();
    onChange(ts + by);
  };
  return (
    <View className="flex-row items-center gap-3 rounded-xl bg-secondary px-3 py-2" accessible={false}>
      <Text className="min-w-0 flex-1 text-[15px] font-medium leading-[22px]">{label}</Text>
      <Press accessibilityRole="button" accessibilityLabel={t("edit.earlier", { label })} onPress={() => step(-STEP_S)} className="size-11 items-center justify-center rounded-full bg-background">
        <Icon icon={Minus} size={18} tone="foreground" />
      </Press>
      <Text accessibilityLiveRegion="polite" accessibilityLabel={`${label} ${time}`} className="w-[72px] text-center font-numeric text-[17px] font-bold tabular-nums">
        {time}
      </Text>
      <Press accessibilityRole="button" accessibilityLabel={t("edit.later", { label })} onPress={() => step(STEP_S)} className="size-11 items-center justify-center rounded-full bg-background">
        <Icon icon={Plus} size={18} tone="foreground" />
      </Press>
    </View>
  );
}
