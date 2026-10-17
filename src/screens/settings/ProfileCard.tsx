// Settings › Profile. Ported from pulse (app)/settings/SettingsView.tsx `Profile` and SettingsClient.tsx `EditProfileButton`:
// the rows, and "Edit", which opens the onboarding fields in a sheet (the route app/profile.tsx, U19). Above
// them, the web's Account head: the photo and the name, and the Photo button (src/actions/photo.ts), whose menu offers
// Take photo, Choose photo and, once there is one, Remove photo.
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
  const name = useApp((s) => s.profile?.name);
  const rows: [string, string][] = [
    ["Birth date", formatDay(profile.birthDate, DAY.full)],
    ["Age", String(profile.age)],
    ["Sex", profile.sex === "male" ? "Male" : "Female"],
    ["Height", profile.heightCm ? heightText(profile.heightCm) : "Not set"],
    ["Max heart rate", `${profile.maxHr} bpm, ${profile.maxHrSource}`],
    ["Time zone", profile.timeZone],
  ];
  return (
    <SectionShell variant="card" title="Profile" action={<SmallButton icon={Pencil} label="Edit" accessibilityLabel="Edit profile" onPress={() => push("/profile")} className="-my-2" />}>
      <View className="min-h-11 flex-row items-center gap-3">
        <UserAvatar size={56} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[15px] font-semibold leading-[22px]">
            {name || "No name"}
          </Text>
          <Text numberOfLines={1} className="text-[13px] leading-[18px] text-muted-foreground">
            Your photo stays on this phone
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
      <Text className={`${CAPTION} mt-2`}>Your days start at midnight in your time zone. Edit changes it and recomputes your scores.</Text>
    </SectionShell>
  );
}

/** Photo: a menu under the button (the kit's MenuPanel) to take one or choose one (both crop a square), and Remove photo once there is one. */
function PhotoButtons() {
  const has = useApp((s) => !!s.profile?.photo);
  const [pending, setPending] = useState(false);
  const { ref, anchor, open, close } = useMenu();
  const run = async (from: "camera" | "library") => {
    setPending(true);
    try {
      const uri = await pickPhoto(from);
      if (uri) {
        await setPhoto(uri);
        toast.success("Photo updated");
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message === "camera_denied" ? "Allow the camera in Android settings to take a photo." : "Couldn’t update the photo");
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    await setPhoto(null);
    toast.success("Photo removed");
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
        {pending ? "Saving…" : "Photo"}
      </Button>
      <MenuPanel anchor={anchor} onClose={close} align="stretch">
        {item(Camera, "Take photo", () => void run("camera"))}
        {item(ImageIcon, "Choose photo", () => void run("library"))}
        {has && item(Trash2, "Remove photo", () => void remove(), true)}
      </MenuPanel>
    </View>
  );
}
