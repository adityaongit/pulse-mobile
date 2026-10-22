import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { getSettings } from "@/queries/settings";
import { useScreen } from "../useScreen";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { AppSettings } from "./AppSettings";
import { cn } from "@/ui/cn";
import { ROW, ROW_RULE } from "./controls";
import { DataSource } from "./DataSource";
import { DeleteEverything } from "./DeleteEverything";
import { LiveHeartRate } from "./LiveHeartRate";
import { NotificationsSection } from "./NotificationsSection";
import { GoalsSettings } from "@/screens/goals/GoalsSettings";
import { ProfileCard } from "./ProfileCard";

type SectionId = "profile" | "source" | "app" | "live" | "notifications" | "goals";
const SECTIONS: SectionId[] = ["profile", "source", "app", "live", "notifications", "goals"];
/** Older names: ?s=sync, ?s=appearance, ?s=profile, and the web's ?s=account. */
const ALIAS: Record<string, SectionId> = { sync: "source", appearance: "app", account: "profile" };

const resolve = (raw: string | undefined): SectionId => {
  const id = (raw && (ALIAS[raw] ?? raw)) as SectionId;
  return SECTIONS.includes(id) ? id : SECTIONS[0];
};

const PROFILE_ROWS = ["birthDate", "age", "referenceRanges", "height", "maxHeartRate", "timeZone"] as const;

function SectionSkeleton({ section }: { section: SectionId }) {
  const { t } = useTranslation("settings");
  const buttons = (
    <View className="mt-4 flex-row gap-2">
      <Skeleton className="h-11 flex-1 rounded-xl" />
      <Skeleton className="h-11 flex-1 rounded-xl" />
    </View>
  );
  if (section === "source")
    return (
      <SectionShell variant="card" title={t("sectionTitle.dataSource")}>
        <View className="min-h-11 flex-row items-center gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <View className="min-w-0 flex-1">
            <SkeletonText lh={22} fs={15} className="w-28" />
            <SkeletonText lh={18} fs={13} className="w-40" />
          </View>
        </View>
        {buttons}
        <View className={`${ROW} mt-4 border-t border-border`}>
          <View className="flex-row"><SkeletonText lh={22} fs={15} className="w-24" /></View>
          <SkeletonText lh={18} fs={13} className="w-24" />
        </View>
      </SectionShell>
    );
  if (section === "app")
    return (
      <SectionShell variant="card" title={t("sectionTitle.display")}>
        <View>
          {(["theme", "units", "clock"] as const).map((k, i) => (
            <View key={k} className={cn(ROW, i > 0 && ROW_RULE)}>
              <SkeletonText lh={22} fs={15} className="w-16" />
              <SkeletonText lh={22} fs={15} className="w-20" />
            </View>
          ))}
        </View>
      </SectionShell>
    );
  return (
    <SectionShell variant="card" title={t("sectionTitle.profile")} action={<Skeleton className="h-5 w-14 rounded-full" />}>
      <View>
        {PROFILE_ROWS.map((k, i) => (
          <View key={k} className={cn(ROW, i > 0 && ROW_RULE)}>
            <View><SkeletonText lh={22} fs={15} className="w-28" /></View>
            <SkeletonText lh={22} fs={15} className="w-24" />
          </View>
        ))}
      </View>
      <SkeletonText className="mt-2 w-56" />
    </SectionShell>
  );
}

/** The profile reads the Store (the learned max heart rate), so it is the one section that waits for a query; it skips the opening-transition wait, as it is a small read. */
function ProfileSection() {
  const { data } = useScreen((ctx) => getSettings(ctx), ["settings"], { eager: true });
  return !data ? (
    <SectionSkeleton section="profile" />
  ) : (
    <>
      <ProfileCard profile={data.profile} />
      <DeleteEverything />
    </>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation("settings");
  const { s } = useLocalSearchParams<{ s?: string }>();
  const section = resolve(s);
  const [now] = useState(() => Date.now());
  // Every other section is static or reads the app state itself (src/state/app.ts), so it opens with its content.
  return (
    <View className="flex-1">
      <DetailShell
        title={t("title")}
        loading={false}
        instant
        primary={
          <View className="w-full gap-3">
            {section === "live" ? (
              <LiveHeartRate />
            ) : section === "notifications" ? (
              <NotificationsSection />
            ) : section === "goals" ? (
              <GoalsSettings />
            ) : section === "source" ? (
              <DataSource now={now} />
            ) : section === "app" ? (
              <AppSettings />
            ) : (
              <ProfileSection />
            )}
          </View>
        }
      />
    </View>
  );
}
