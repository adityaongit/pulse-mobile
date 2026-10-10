// Settings `/settings` (spec §7.14, journeys 9 and 10). Ported from pulse (app)/settings/page.tsx, SettingsView.tsx and
// SettingsLayout.tsx: configuration only, one section at a time, named by the route's `s` param (More's "Account &
// settings" rows open `/settings?s=profile`, `source` and `app`). The web's Account section is Profile here: there is no
// account to show, so it holds the profile and, at its foot, Delete everything. No Coach section (the coach stream's).
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { getAppPrefs, getSettings } from "@/queries/settings";
import { useScreen } from "../useScreen";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { AppSettings } from "./AppSettings";
import { Divider, ROW } from "./controls";
import { DataSource } from "./DataSource";
import { DeleteEverything } from "./DeleteEverything";
import { ProfileCard } from "./ProfileCard";

type SectionId = "profile" | "source" | "app";
const SECTIONS: SectionId[] = ["profile", "source", "app"];
/** Older names: ?s=sync, ?s=appearance, ?s=profile, and the web's ?s=account. */
const ALIAS: Record<string, SectionId> = { sync: "source", appearance: "app", account: "profile" };

const resolve = (raw: string | undefined): SectionId => {
  const id = (raw && (ALIAS[raw] ?? raw)) as SectionId;
  return SECTIONS.includes(id) ? id : SECTIONS[0];
};

const PROFILE_ROWS = ["Birth date", "Age", "Sex", "Height", "Max heart rate", "Time zone"];

/** The web's loading.tsx for the section on show: static labels, only values are bars (spec §5.19). */
function SectionSkeleton({ section }: { section: SectionId }) {
  const buttons = (
    <View className="mt-4 flex-row gap-2">
      <Skeleton className="h-11 flex-1 rounded-xl" />
      <Skeleton className="h-11 flex-1 rounded-xl" />
    </View>
  );
  if (section === "source")
    return (
      <SectionShell variant="card" title="Data source">
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
      <SectionShell variant="card" title="Appearance">
        <Skeleton className="h-[52px] rounded-[14px]" />
      </SectionShell>
    );
  return (
    <SectionShell variant="card" title="Profile" action={<Skeleton className="h-5 w-14 rounded-full" />}>
      <View>
        {PROFILE_ROWS.map((k, i) => (
          <View key={k}>
            {i > 0 && <Divider />}
            <View className={ROW}>
              <View><SkeletonText lh={22} fs={15} className="w-28" /></View>
              <SkeletonText lh={22} fs={15} className="w-24" />
            </View>
          </View>
        ))}
      </View>
      <SkeletonText className="mt-2 w-56" />
    </SectionShell>
  );
}

export function SettingsScreen() {
  const { s } = useLocalSearchParams<{ s?: string }>();
  const section = resolve(s);
  const { data } = useScreen(async (ctx) => ({ vm: await getSettings(ctx), prefs: await getAppPrefs(ctx), now: ctx.now * 1000 }), []);

  return (
    <View className="flex-1">
      <DetailShell
        title="Settings"
        loading={!data}
        primary={
          <View className="w-full gap-3">
            {!data ? (
              <SectionSkeleton section={section} />
            ) : section === "source" ? (
              <DataSource vm={data.vm} now={data.now} />
            ) : section === "app" ? (
              <AppSettings prefs={data.prefs} />
            ) : (
              <>
                <ProfileCard profile={data.vm.profile} />
                {/* Last and quiet: the one irreversible action sits below everything, away from the everyday controls. */}
                <DeleteEverything />
              </>
            )}
          </View>
        }
      />
    </View>
  );
}
