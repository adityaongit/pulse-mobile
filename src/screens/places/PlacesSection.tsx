// Settings › Places (`/settings?s=places`): how Pulse follows the phone for the timeline, what Android lets it do, and
// the saved places. Android 11+ grants "Allow all the time" only on its own settings page; expo-location opens it.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, View } from "react-native";
import * as Location from "expo-location";
import { ChevronRight } from "lucide-react-native";
import { setTrackingMode } from "@/actions/places";
import type { TrackingStatus } from "@/background/places";
import { TRACKING_MODES, type TrackingMode } from "@/core/places/types";
import { attempt } from "@/lib/attempt";
import { getPlacesSettings } from "@/queries/timeline";
import { actionCtx } from "@/state/app";
import { placesChanged } from "@/state/places";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { push } from "@/ui/navigate";
import { Press } from "@/ui/Press";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { useScreen } from "../useScreen";
import { HINT, RadioSegments, ROW, ROW_LABEL, ROW_RULE, ROW_VALUE } from "../settings/controls";
import { PlaceBadge } from "./parts";

export function PlacesSection() {
  const { t } = useTranslation("places");
  const { data } = useScreen(getPlacesSettings, ["places-settings"]);
  const [status, setStatus] = useState<TrackingStatus | "checking">("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The tracking matches the saved settings at boot; this reads what it came to, after paint. Coming back from
    // Android's settings page (where "Allow all the time" is granted) checks again, and starts tracking if it can.
    let live = true;
    const check = () => void placesChanged().then((s) => live && setStatus(s));
    check();
    const sub = AppState.addEventListener("change", (next) => next === "active" && check());
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  if (!data) return null;
  const { places, mode } = data;

  const changeMode = async (next: TrackingMode) => {
    setBusy(true);
    await setTrackingMode(actionCtx().store, next).catch(() => false);
    setStatus(await placesChanged());
    setBusy(false);
  };

  const allow = async () => {
    setBusy(true);
    await attempt(
      async () => {
        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.granted) await Location.requestBackgroundPermissionsAsync();
      },
      {
        catch: () => {
          // Android may refuse without a settings trip; the status row keeps saying what is missing.
        },
        finally: async () => {
          setStatus(await placesChanged());
          setBusy(false);
        },
      },
    );
  };

  const statusText = t(`status.${status}`);
  return (
    <>
      <SectionShell variant="card" title={t("settings.tracking")}>
        <RadioSegments label={t("settings.tracking")} value={mode} options={TRACKING_MODES.map((m) => ({ value: m, label: t(`mode.${m}`) }))} onChange={(m) => void changeMode(m)} />
        <Text className={cn(HINT, "mt-2")}>{t(`mode.${mode}Hint`)}</Text>
        <View accessible accessibilityLabel={`${t("settings.status")}: ${statusText}`} className={cn(ROW, ROW_RULE, "mt-3")}>
          <Text className={ROW_LABEL}>{t("settings.status")}</Text>
          <Text className={cn(ROW_VALUE, status === "running" && "text-optimal-text")}>{statusText}</Text>
        </View>
        {(status === "no_permission" || status === "needs_background") && (
          <View className="mt-2 gap-2">
            <Button onPress={() => void allow()} disabled={busy}>
              {t("settings.allowBackground")}
            </Button>
            <Text className={HINT}>{t("settings.allowHint")}</Text>
          </View>
        )}
      </SectionShell>

      <SectionShell variant="card" title={t("settings.places")} action={places.length ? { label: t("settings.openTimeline"), href: "/timeline" } : undefined}>
        <View>
          {places.map((p, i) => (
            <Press
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={t("settings.placeAria", { name: p.name, radius: p.radiusM })}
              onPress={() => push(`/places/edit?id=${encodeURIComponent(p.id)}`)}
              className={cn(ROW, i > 0 && ROW_RULE)}
            >
              <PlaceBadge icon={p.icon} size={32} />
              <Text className={cn(ROW_LABEL, "min-w-0 flex-1")} numberOfLines={1}>
                {p.name}
              </Text>
              <Text className={ROW_VALUE}>{t("place.metres", { value: p.radiusM })}</Text>
              <Icon icon={ChevronRight} size={16} tone="muted-foreground" />
            </Press>
          ))}
          {!places.length && <Text className={cn(HINT, "pb-2")}>{t("settings.noPlaces")}</Text>}
        </View>
        <View className="mt-3">
          <Button variant={places.length ? "secondary" : "default"} onPress={() => push("/places/edit")}>
            {t("settings.addPlace")}
          </Button>
        </View>
        <Text className={cn(HINT, "mt-3")}>{t("settings.privacy")}</Text>
      </SectionShell>
    </>
  );
}
