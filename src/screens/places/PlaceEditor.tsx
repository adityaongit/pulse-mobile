// New or edit a place `/places/edit?id=` (or `?lat=&lon=&name=` from an unknown stop): its name, icon, fence size and
// spot. The spot comes from "Use my current location" (standing there; no map, so nothing is fetched) or from pasted
// coordinates. Saving writes the place and makes the fences match (src/state/places.ts).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Location from "expo-location";
import { removePlace, savePlace, MAX_PLACE_NAME } from "@/actions/places";
import { parseCoordinates } from "@/core/places/geo";
import { DEFAULT_RADIUS_M, PLACE_ICONS, PLACE_RADII, type Place, type PlaceIcon } from "@/core/places/types";
import { attempt } from "@/lib/attempt";
import { formatValue } from "@/lib/format";
import { getPlace } from "@/queries/timeline";
import { actionCtx } from "@/state/app";
import { placesChanged } from "@/state/places";
import { Chips, Field, FormAlert, Input } from "@/screens/log/fields";
import { ConfirmDialog } from "@/screens/settings/controls";
import { useScreen } from "@/screens/useScreen";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { goBack } from "@/ui/navigate";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { haptic } from "@/ui/haptics";
import { TaskPage, TaskSection } from "@/ui/shells/TaskPage";
import { i18n } from "@/i18n/config";
import { PLACE_GLYPH } from "./parts";

const nowS = () => Math.floor(Date.now() / 1000);

export function PlaceEditor() {
  const { t } = useTranslation("places");
  const p = useLocalSearchParams<{ id?: string; lat?: string; lon?: string; name?: string }>();
  const { data, error, reload } = useScreen((ctx) => getPlace(ctx, p.id), ["place-editor", p.id ?? "new"], { eager: true });
  if (!data) {
    return (
      <TaskPage title={p.id ? t("place.editTitle") : t("place.newTitle")}>
        <View className="h-40" />
        {!!error && (
          <Button variant="secondary" onPress={reload}>
            {i18n.t("common:actions.tryAgain")}
          </Button>
        )}
      </TaskPage>
    );
  }
  const seed = p.lat && p.lon ? parseCoordinates(`${p.lat},${p.lon}`) : null;
  return <PlaceForm key={data.place?.id ?? "new"} place={data.place} seed={seed} seedName={p.name ?? ""} />;
}

function PlaceForm({ place, seed, seedName }: { place: Place | null; seed: { latitude: number; longitude: number } | null; seedName: string }) {
  const { t } = useTranslation("places");
  const [name, setName] = useState(place?.name ?? seedName);
  const [icon, setIcon] = useState<PlaceIcon>(place?.icon ?? "other");
  const [radius, setRadius] = useState<number>(place?.radiusM ?? DEFAULT_RADIUS_M);
  const [spot, setSpot] = useState<{ latitude: number; longitude: number } | null>(place ? { latitude: place.latitude, longitude: place.longitude } : seed);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const locate = async () => {
    setBusy(true);
    setError(null);
    await attempt(
      async () => {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (!fg.granted) return setError(t("place.permissionDenied"));
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setSpot({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setAccuracy(pos.coords.accuracy ?? null);
        haptic.success();
      },
      {
        catch: () => setError(t("place.locateFailed")),
        finally: () => setBusy(false),
      },
    );
  };

  const paste = (text: string) => {
    setPasted(text);
    const c = parseCoordinates(text);
    if (c) {
      setSpot(c);
      setAccuracy(null);
      setError(null);
    }
  };

  const save = async () => {
    if (!spot) {
      haptic.error();
      return setError(t("place.noSpot"));
    }
    setBusy(true);
    setError(null);
    const ctx = actionCtx();
    const res = await savePlace(ctx.store, { id: place?.id, name, icon, latitude: spot.latitude, longitude: spot.longitude, radiusM: radius }, ctx.timeZone, nowS()).catch(() => ({ ok: false as const, error: "location" as const }));
    if (!res.ok) {
      setBusy(false);
      haptic.error();
      return setError(t(`place.error_${res.error}`));
    }
    await placesChanged();
    setBusy(false);
    toast.success(t("place.saved"));
    goBack();
  };

  const remove = async () => {
    if (!place) return;
    setBusy(true);
    const ctx = actionCtx();
    await removePlace(ctx.store, place.id, ctx.timeZone, nowS()).catch(() => {});
    await placesChanged();
    setBusy(false);
    setConfirm(false);
    toast.success(t("place.removed"));
    goBack();
  };

  return (
    <TaskPage
      title={place ? t("place.editTitle") : t("place.newTitle")}
      footer={
        <>
          {!!error && <FormAlert>{error}</FormAlert>}
          <Button onPress={() => void save()} disabled={busy}>
            {busy ? t("place.saving") : t("place.save")}
          </Button>
          {place && (
            <Button variant="outline" textClassName="text-recovery-red-text" onPress={() => setConfirm(true)} disabled={busy}>
              {t("place.remove")}
            </Button>
          )}
        </>
      }
    >
      <View className="gap-6 pt-2">
        <View className="gap-3">
          <TaskSection>{t("place.name")}</TaskSection>
          <Field label={t("place.name")}>
            <Input autoFocus={!place && !seedName} value={name} onChangeText={(v) => (setName(v), setError(null))} placeholder={t("place.namePlaceholder")} maxLength={MAX_PLACE_NAME} accessibilityLabel={t("place.name")} />
          </Field>
          <Text className="text-[13px] leading-[18px] text-muted-foreground">{t("place.icon")}</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("place.icon")} className="flex-row flex-wrap gap-2">
            {PLACE_ICONS.map((key) => (
              <Press
                key={key}
                accessibilityRole="radio"
                accessibilityLabel={t(`icon.${key}`)}
                accessibilityState={{ selected: icon === key }}
                onPress={() => (haptic.select(), setIcon(key))}
                className={cn("size-12 items-center justify-center rounded-full border", icon === key ? "border-foreground bg-foreground" : "border-border")}
              >
                <Icon icon={PLACE_GLYPH[key]} size={20} tone={icon === key ? "background" : "foreground"} />
              </Press>
            ))}
          </View>
        </View>

        <View className="gap-3">
          <TaskSection>{t("place.spot")}</TaskSection>
          <View accessible className="rounded-xl bg-secondary px-3 py-3">
            <Text className="text-[15px] font-medium leading-[22px]">{spot ? t("place.spotSet") : t("place.spotNotSet")}</Text>
            {spot && (
              <Text className="font-numeric text-xs leading-4 tabular-nums text-muted-foreground">
                {spot.latitude.toFixed(5)}, {spot.longitude.toFixed(5)}
                {accuracy !== null ? ` · ${t("place.accuracy", { value: formatValue("int", accuracy) })}` : ""}
              </Text>
            )}
          </View>
          <Button variant={spot ? "secondary" : "default"} onPress={() => void locate()} disabled={busy}>
            {busy ? t("place.locating") : spot ? t("place.updateHere") : t("place.useHere")}
          </Button>
          <Field label={t("place.paste")} hint={t("place.optional")}>
            <Input value={pasted} onChangeText={paste} placeholder={t("place.pastePlaceholder")} keyboardType="default" accessibilityLabel={t("place.paste")} />
          </Field>
        </View>

        <View className="gap-3">
          <TaskSection>{t("place.radius")}</TaskSection>
          <Chips
            label={t("place.radius")}
            options={PLACE_RADII.map((r) => [String(r), t("place.metres", { value: r })] as const)}
            value={String(radius)}
            onChange={(v) => typeof v === "string" && v && setRadius(Number(v))}
          />
          <Text className="text-[13px] leading-[18px] text-muted-foreground">{t("place.radiusHint")}</Text>
        </View>
      </View>
      <ConfirmDialog
        open={confirm}
        title={t("place.removeTitle")}
        description={t("place.removeBody")}
        confirmLabel={t("place.remove")}
        pendingLabel={t("place.saving")}
        pending={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void remove()}
      />
    </TaskPage>
  );
}
