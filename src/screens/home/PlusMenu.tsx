// My Day's "+": a white key that opens the action menu (the reference app, home-08), ported from pulse
// (app)/_lib/PlusMenu.tsx. On a phone the menu is a sheet route (app/plus.tsx) instead of a dropdown under the key,
// and the key does not turn into an X while it is open. Entries without a data source in Pulse (Start activity, Strength
// trainer, Share live: `FEATURES`, all off) are left out, as the web hides them.
import { View } from "react-native";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { NotebookPen, Plus } from "lucide-react-native";
import { Gradient } from "@/ui/Gradient";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { TaskPage } from "@/ui/shells/TaskPage";
import { InfoDialog } from "@/ui/shells/InfoDialog";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { useState } from "react";
import { ADD_ACTIVITY_INFO } from "../_lib/info";
import { Press } from "@/ui/Press";
import { push } from "@/ui/navigate";

/** The ~34 pt white key with a soft top light; the hit area grows to 44 px without moving it. */
export function PlusKey({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <Press
      activeScale={0.96}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptic.tap();
        push(`/plus?label=${encodeURIComponent(label)}`);
      }}
      hitSlop={5}
      className="size-[34px] items-center justify-center overflow-hidden rounded-lg"
    >
      <Gradient from={c["key-from"]} to={c["key-to"]} angle="y" />
      <Icon icon={Plus} size={20} tone="key-foreground" strokeWidth={2.25} />
    </Press>
  );
}

/** The sheet's body: "Add activity" explains where workouts come from (§11 R2), "Complete your journal" opens the check-in. */
export function PlusPage({ label }: { label: string }) {
  const { t } = useTranslation("home");
  const [info, setInfo] = useState(false);
  const item = "h-12 flex-row items-center gap-3 rounded-xl px-3";
  return (
    <TaskPage title={label}>
      <View accessibilityRole="menu">
        <Press activeBg="bg-fill-pressed" accessibilityRole="menuitem" onPress={() => setInfo(true)} className={item}>
          <Icon icon={Plus} size={20} tone="foreground-secondary" strokeWidth={1.75} />
          <Text className="text-[13px] font-bold uppercase leading-4 tracking-[0.1em]">{t("activities.add")}</Text>
        </Press>
        {/* Replaces the menu with the check-in rather than stacking a second sheet on it. */}
        <Press activeBg="bg-fill-pressed" accessibilityRole="menuitem" onPress={() => router.replace("/checkin" as Href)} className={item}>
          <Icon icon={NotebookPen} size={20} tone="foreground-secondary" strokeWidth={1.75} />
          <Text className="text-[13px] font-bold uppercase leading-4 tracking-[0.1em]">{t("add.completeJournal")}</Text>
        </Press>
      </View>
      <InfoDialog open={info} onClose={() => setInfo(false)} {...ADD_ACTIVITY_INFO} />
    </TaskPage>
  );
}
