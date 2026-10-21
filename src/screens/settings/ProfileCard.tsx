// Settings › Profile. Ported from pulse (app)/settings/SettingsView.tsx `Profile` and SettingsClient.tsx `EditProfileButton`:
// the rows, and "Edit", which opens the onboarding fields in a sheet (the route app/profile.tsx, U19). Above
// them, the web's Account head: the photo and the name, and the Photo button (src/actions/photo.ts), whose menu offers
// Take photo, Choose photo and, once there is one, Remove photo.
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { View } from "react-native";
import { Camera, ImageIcon, Pencil, Trash2, type LucideIcon } from "lucide-react-native";
import { Icon } from "@/ui/Icon";
import { MenuPanel, useMenu } from "@/ui/Menu";
import { Press } from "@/ui/Press";
import { pickPhoto } from "@/actions/photo";
import { setPhoto, useApp } from "@/state/app";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/Toast";
import { UserAvatar } from "@/ui/shells/UserAvatar";
import { DAY, formatDay, heightText } from "@/lib/format";
import type { SettingsVM } from "@/queries/types";
import { CAPTION } from "@/ui/metrics/primitives";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { cn } from "@/ui/cn";
import { ROW, ROW_LABEL, ROW_RULE, ROW_VALUE, SmallButton } from "./controls";
import { push } from "@/ui/navigate";

export function ProfileCard({ profile }: { profile: SettingsVM["profile"] }) {
  const { t } = useTranslation("settings");
  const name = useApp((s) => s.profile?.name);
  const rows: [string, string][] = [
    [t("profileRows.birthDate"), formatDay(profile.birthDate, DAY.full)],
    [t("profileRows.age"), String(profile.age)],
    [t("profileRows.referenceRanges"), profile.sex === "male" ? t("profile.male") : t("profile.female")],
    [t("profileRows.height"), profile.heightCm ? heightText(profile.heightCm) : t("profile.notSet")],
    [t("profileRows.maxHeartRate"), t("profile.maxHrValue", { bpm: profile.maxHr, source: t(`profile.maxHrSource.${profile.maxHrSource}`) })],
    [t("profileRows.timeZone"), profile.timeZone],
  ];
  return (
    <SectionShell variant="card" title={t("profile.title")} action={<SmallButton icon={Pencil} label={t("profile.edit")} accessibilityLabel={t("profile.editLabel")} onPress={() => push("/profile")} className="-my-2" />}>
      <View className="min-h-11 flex-row items-center gap-3">
        <UserAvatar size={56} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[15px] font-semibold leading-[22px]">
            {name || t("profile.noName")}
          </Text>
          <Text numberOfLines={1} className="text-[13px] leading-[18px] text-muted-foreground">
            {t("profile.photoStays")}
          </Text>
        </View>
      </View>
      <PhotoButtons />
      <View className="mt-2">
        {rows.map(([k, v], i) => (
          <View key={k} className={cn(ROW, i > 0 && ROW_RULE)}>
            <Text className={ROW_LABEL}>{k}</Text>
            <Text className={ROW_VALUE}>{v}</Text>
          </View>
        ))}
      </View>
      <Text className={`${CAPTION} mt-2`}>{t("profile.daysStart")}</Text>
    </SectionShell>
  );
}

/** Photo: a menu under the button (the kit's MenuPanel) to take one or choose one (both crop a square), and Remove photo once there is one. */
function PhotoButtons() {
  const { t } = useTranslation("settings");
  const has = useApp((s) => !!s.profile?.photo);
  const [pending, setPending] = useState(false);
  const { ref, anchor, open, close } = useMenu();
  const run = async (from: "camera" | "library") => {
    setPending(true);
    try {
      const uri = await pickPhoto(from);
      if (uri) {
        await setPhoto(uri);
        toast.success(t("profile.photoUpdated"));
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message === "camera_denied" ? t("profile.cameraDenied") : t("profile.photoFailed"));
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    await setPhoto(null);
    toast.success(t("profile.photoRemoved"));
  };
  const item = (icon: LucideIcon, label: string, onPress: () => void, danger?: boolean) => (
    <Press
      activeBg="bg-fill-pressed"
      accessibilityRole="menuitem"
      onPress={() => {
        close();
        // After the menu's fade-out: iOS will not present the camera or the library over a modal still closing.
        setTimeout(onPress, 300);
      }}
      className="h-12 flex-row items-center gap-3 rounded-xl px-3"
    >
      <Icon icon={icon} size={20} tone={danger ? "recovery-red-text" : "foreground-secondary"} strokeWidth={1.75} />
      <Text className={cn("text-[15px] font-medium", danger && "text-recovery-red-text")}>{label}</Text>
    </Press>
  );
  return (
    <View ref={ref} collapsable={false} className="mt-4">
      <Button variant="secondary" disabled={pending} onPress={open}>
        {pending ? t("profile.saving") : t("profile.photo")}
      </Button>
      <MenuPanel anchor={anchor} onClose={close} align="stretch">
        {item(Camera, t("profile.takePhoto"), () => void run("camera"))}
        {item(ImageIcon, t("profile.choosePhoto"), () => void run("library"))}
        {has && item(Trash2, t("profile.removePhoto"), () => void remove(), true)}
      </MenuPanel>
    </View>
  );
}
