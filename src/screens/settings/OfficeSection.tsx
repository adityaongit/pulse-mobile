// Settings › Places (`/settings?s=places`, Pulse-only): the office geofence. "Use my current location" saves the spot
// (no map picker: it is set standing in the office), the habit row picks what an arrival ticks, and the permission row
// asks for "Allow all the time", which Android 11+ grants only on its own settings page (expo-location opens it).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import * as Location from "expo-location";
import { OFFICE_RADIUS_M } from "@/core/office";
import { getOfficeSettings } from "@/queries/office";
import { setOffice } from "@/state/app";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { useScreen } from "../useScreen";
import { HINT, ROW, ROW_LABEL, ROW_RULE, ROW_VALUE, SelectRow } from "./controls";
import { attempt } from "@/lib/attempt";

type Permission = "checking" | "granted" | "foreground" | "denied";

export function OfficeSection() {
  const { t } = useTranslation("settings");
  const { data } = useScreen(getOfficeSettings, ["office-settings"]);
  const [permission, setPermission] = useState<Permission>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readPermission = async () => {
    await attempt(async () => {
      const fg = await Location.getForegroundPermissionsAsync();
      if (!fg.granted) return setPermission("denied");
      const bg = await Location.getBackgroundPermissionsAsync();
      setPermission(bg.granted ? "granted" : "foreground");
    }, { catch: () => {
      setPermission("denied");
    } });
  };
  useEffect(() => {
    // The permission changes only through this screen or the system settings; the read is async, so it lands after paint.
    let live = true;
    Location.getForegroundPermissionsAsync()
      .then(async (fg) => {
        if (!live) return;
        if (!fg.granted) return setPermission("denied");
        const bg = await Location.getBackgroundPermissionsAsync();
        if (live) setPermission(bg.granted ? "granted" : "foreground");
      })
      .catch(() => {
        if (live) setPermission("denied");
      });
    return () => {
      live = false;
    };
  }, []);

  // Nothing until the saved place and the habit list are read: a card that says "Not set" for a moment would lie.
  if (!data) return null;
  const office = data.office;
  const status =
    permission === "granted"
      ? t("places.watching")
      : permission === "foreground"
        ? t("places.needsBackground")
        : permission === "denied"
          ? t("places.noPermission")
          : t("places.checking");

  const save = async (next: { latitude: number; longitude: number; habitId: string | null }) => {
    if (!(await setOffice(next))) setError(t("places.saveFailed"));
  };

  const remove = async () => {
    setError(null);
    if (!(await setOffice(null))) setError(t("places.saveFailed"));
  };

  const locate = async () => {
    setBusy(true);
    setError(null);
    await attempt(async () => {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (!fg.granted) return setError(t("places.permissionDenied"));
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await save({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, habitId: office?.habitId ?? null });
    }, { catch: () => {
      setError(t("places.locateFailed"));
    }, finally: async () => {
      await readPermission();
      setBusy(false);
    } });
  };

  const allowBackground = async () => {
    setBusy(true);
    setError(null);
    await attempt(async () => {
      await Location.requestBackgroundPermissionsAsync();
    }, { catch: () => {
      // Android may refuse without a settings trip; the row keeps saying what is missing.
    }, finally: async () => {
      await readPermission();
      // The fence registers only with the permission; a grant now makes it live.
      if (office) await setOffice(office);
      setBusy(false);
    } });
  };

  return (
    <SectionShell variant="card" title={t("places.title")}>
      <View>
        <View accessible accessibilityLabel={`${t("places.status")}: ${status}`} className={ROW}>
          <Text className={ROW_LABEL}>{t("places.status")}</Text>
          <Text className={cn(ROW_VALUE, permission === "granted" && "text-optimal-text")}>{status}</Text>
        </View>
        <View accessible accessibilityLabel={`${t("places.location")}: ${office ? t("places.set") : t("places.notSet")}`} className={cn(ROW, ROW_RULE)}>
          <Text className={ROW_LABEL}>{t("places.location")}</Text>
          <Text className={ROW_VALUE}>{office ? t("places.set") : t("places.notSet")}</Text>
        </View>
      </View>
      <View className="mt-4 gap-2">
        <Button onPress={() => void locate()} disabled={busy}>
          {busy ? t("places.locating") : office ? t("places.updateHere") : t("places.useHere")}
        </Button>
        {permission === "foreground" && (
          <Button variant="outline" onPress={() => void allowBackground()} disabled={busy}>
            {t("places.allowBackground")}
          </Button>
        )}
        {office && (
          <Button variant="outline" textClassName="text-recovery-red-text" onPress={() => void remove()}>
            {t("places.remove")}
          </Button>
        )}
      </View>
      {office && (
        <SelectRow
          label={t("places.habit")}
          value={office.habitId ?? "none"}
          options={[{ value: "none", label: t("places.noHabit") }, ...data.habits.map((h) => ({ value: h.id, label: h.name }))]}
          onChange={(id) => void save({ ...office, habitId: id === "none" ? null : id })}
        />
      )}
      {!!error && (
        <Text accessibilityRole="alert" className="mt-2 text-[13px] font-medium leading-[18px] text-recovery-red-text">
          {error}
        </Text>
      )}
      <Text className={cn(HINT, "mt-2")}>{t("places.hint", { radius: OFFICE_RADIUS_M })}</Text>
    </SectionShell>
  );
}
