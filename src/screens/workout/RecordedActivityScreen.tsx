// A recorded activity `/workout/[id]`: WHOOP's activity detail (reference/detail-zones.jpg) on
// the same pieces as an imported activity (src/screens/activity/ActivityScreen.tsx): Activity Strain, the heart-rate
// chart, time in each zone and the key statistics, with Delete in the header.
import { useEffect, useState, useSyncExternalStore } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react-native";
import { clock, formatValue } from "@/lib/format";
import { appStore, queryCtx, useApp, useDataVersion } from "@/state/app";
import { getActivity } from "@/queries/activity";
import { activityHref } from "@/lib/url";
import { workoutRecorder } from "@/live/workoutRecorder";
import { activityView } from "@/live/activityView";
import { summarizeWorkout, type RecordedWorkout, type WorkoutSample } from "@/live/workout";
import { clockDuration } from "@/live/sessions";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { IntradayHrChart } from "@/ui/charts/IntradayHrChart";
import { ZoneBars } from "@/ui/charts/ZoneBars";
import { KeyStatRow } from "@/ui/metrics/KeyStatRow";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { ACTIVITY_GLYPH, activityName } from "./activityKit";
import { strainSetupOf, zoneRows } from "./LiveActivityScreen";
import { ActivitySkeleton } from "../activity/ActivityScreen";
import { ConfirmDialog } from "@/screens/settings/controls";

/** How long a just-finished workout shows the activity page loading while it is saved and imported. */
const IMPORT_WAIT_MS = 20_000;
/** How long it waits for the save itself before showing the phone-only page. */
const SAVE_WAIT_MS = 4_000;

const STAT_LABEL = "text-xs leading-4 font-bold tracking-[0.1em] text-foreground-secondary uppercase";

export function RecordedActivityScreen() {
  const { t } = useTranslation("workouts");
  const { id } = useLocalSearchParams<{ id: string }>();
  const timeZone = useApp((s) => s.profile?.timeZone);
  const recorder = useSyncExternalStore(workoutRecorder.subscribe, workoutRecorder.getSnapshot, workoutRecorder.getSnapshot);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Re-checks the import wait once a second while it runs.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [data, setData] = useState<{ session: RecordedWorkout | null; samples: WorkoutSample[] } | null>(null);
  const version = useDataVersion();
  // Reloads when the recorder drains new samples or a delete lands (its history changes), and after a sync. Once the
  // session Pulse saved to Health Connect is imported, this is that activity: the same page as any other workout.
  useEffect(() => {
    let live = true;
    const store = appStore().workouts;
    void (async () => {
      const session = await store.get(id);
      if (session?.hcId && (await getActivity(session.hcId, queryCtx()).catch(() => null))) {
        if (live) router.replace(activityHref(session.hcId) as Href);
        return;
      }
      const samples = session ? await store.samples(id) : [];
      if (live) setData({ session, samples });
    })();
    return () => { live = false; };
  }, [id, recorder.history, version]);

  const { session, samples } = data ?? { session: null, samples: [] };
  // Just finished: the session is being saved and imported (seconds). Show the activity page loading, not this copy.
  // Saving takes a moment (SAVE_WAIT_MS); without a Health Connect id after it, the workout stays on the phone.
  const sinceEnd = now - (session?.endedAt ?? 0);
  const importing = session?.status === "completed" && sinceEnd < (session.hcId ? IMPORT_WAIT_MS : SAVE_WAIT_MS);
  if (!data || importing) return <ActivitySkeleton />;
  if (!session) return <DetailShell title={t("recorder.title")} primary={<EmptyState body={t("detail.unavailable")} />} />;

  const view = activityView(samples, strainSetupOf(session), session.body ?? null);
  const summary = summarizeWorkout(session, samples);
  const maxHr = strainSetupOf(session).maxHr;
  // Home once it is gone; when the delete fails the dialog stays open with the reason.
  const remove = () => void workoutRecorder.discard(session.id).then((ok) => {
    if (ok) { setAsking(false); router.replace("/(tabs)" as Href); }
    else setFailed(workoutRecorder.getSnapshot().error ?? "commandFailed");
  });
  const end = session.endedAt ?? session.updatedAt;
  const hasHr = summary.trace.some((p) => p.bpm !== null);
  const known = (v: number | null) => ({ value: v, reason: v === null ? ("no_data" as const) : null, provisional: false });

  return (
    <>
    <DetailShell
      title={activityName(session.type)}
      subtitle={t("detail.subtitle", { start: clock(session.startedAt, timeZone), end: clock(end, timeZone) })}
      align="start"
      titleIcon={<Icon icon={ACTIVITY_GLYPH[session.type]} size={24} tone="foreground" strokeWidth={1.75} />}
      backHref="/(tabs)"
      action={
        <Press accessibilityRole="button" accessibilityLabel={t("detail.delete")} onPress={() => setAsking(true)} hitSlop={10} className="size-10 items-center justify-center">
          <Icon icon={Trash2} size={22} tone="foreground" strokeWidth={1.75} />
        </Press>
      }
      hero={
        <View className="w-full flex-row items-end gap-x-10">
          <View>
            <Text className="font-numeric text-[34px] font-bold leading-none tabular-nums text-strain-text">{formatValue("pct", view.activityStrain)}</Text>
            <Text className={cn(STAT_LABEL, "mt-2")}>{t("detail.activityStrain")}</Text>
          </View>
          <View>
            <Text className="font-numeric text-[34px] font-bold leading-none tabular-nums text-foreground">{clockDuration(summary.activeMs)}</Text>
            <Text className={cn(STAT_LABEL, "mt-2")}>{t("detail.duration")}</Text>
          </View>
        </View>
      }
      primary={
        <View className="gap-6">
          <Text className="text-[13px] leading-5 text-muted-foreground">{t(session.hcId ? "detail.importing" : "detail.phoneOnly")}</Text>
          <IntradayHrChart variant="activity" data={{ value: hasHr ? { points: summary.trace } : null, reason: hasHr ? null : "no_data", provisional: false }} />
          <ZoneBars variant="rows" data={{ value: zoneRows(maxHr, view.zoneSeconds), reason: null, provisional: false }} note={t("detail.zoneNote", { maxHr })} />
        </View>
      }
      secondary={[
        <SectionShell key="stats" variant="section" title={t("detail.keyStats")}>
          <Tiles>
            <KeyStatRow variant="tile" label={t("live.calories")} metric={known(view.kcal)} unit="kcal" format="grouped" direction="none" />
            <KeyStatRow variant="tile" label={t("live.avgHr")} metric={known(view.avgHr)} unit="bpm" format="int" direction="none" />
            <KeyStatRow variant="tile" label={t("live.maxHr")} metric={known(view.maxHr)} unit="bpm" format="int" direction="none" />
            <KeyStatRow variant="tile" label={t("detail.trainingLoad")} metric={summary.load} format="decimal1" direction="none" />
          </Tiles>
        </SectionShell>,
      ]}
    />
    <ConfirmDialog open={asking} title={t("detail.deleteTitle")} description={t("detail.deleteBody")} confirmLabel={t("detail.delete")} pendingLabel={t("detail.deleting")} pending={recorder.busy} error={failed && t(`recorder.errors.${failed}`, { defaultValue: t("recorder.errors.commandFailed") })} onCancel={() => { setAsking(false); setFailed(null); }} onConfirm={remove} />
    </>
  );
}

/** One scrolling row of tiles, the next peeking at the edge (ActivityScreen's StatTiles). */
function Tiles({ children }: { children: React.ReactNode[] }) {
  const { width } = useWindowDimensions();
  const tile = (width - 32 - 12) / 2.15;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={tile + 12} decelerationRate="fast" style={{ marginHorizontal: -16, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4, gap: 12 }}>
      {children.filter(Boolean).map((child, i) => <View key={i} style={{ width: tile }} className="shrink-0">{child}</View>)}
    </ScrollView>
  );
}
