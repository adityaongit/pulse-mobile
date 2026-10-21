// Home's heart-rate card, halo's BandTile behaviour (src/screens/home/calm.tsx) drawn with Pulse's kit. With the band
// live over Bluetooth: its bpm, beating, and the last 2 minutes. Otherwise the newest reading the live ticker
// (src/state/liveHr.tsx) holds, how long ago it was taken, and a sparkline of the 30 minutes ending there. The whole
// card opens the Heart rate screen. Only this card re-renders on a tick or a beat.
import { useMemo } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { minuteMeanHr } from "@/core/algorithms/stress";
import { zoneNumber, zones } from "@/core/scoring/zones";
import { ZONE_COLOR } from "@/lib/bands";
import { addDays } from "@/lib/time";
import { workoutSetup } from "@/live/workoutSetup";
import { loadDays, maxHrOf } from "@/queries/common";
import { useScreen } from "@/screens/useScreen";
import type { TokenName } from "@/ui/palette";
import { RECENT_MINUTES } from "@/health/live";
import { MISSING } from "@/lib/format";
import { useApp } from "@/state/app";
import { useLiveHr } from "@/state/liveHr";
import { showsLive, useLiveBle } from "@/state/liveBle";
import { BeatingHeart, LivePill, LiveTrace } from "@/ui/metrics/LiveHeartRate";
import { CAPTION, ValueUnit } from "@/ui/metrics/primitives";
import { Sparkline } from "@/ui/metrics/Sparkline";
import { SectionShell } from "@/ui/shells/SectionShell";
import { SkeletonText } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { LastReading } from "../health/LastReading";

const HREF = "/health/heart-rate";
const BPM = "font-numeric text-4xl font-bold leading-10 tracking-[-0.01em]";

/** Minute means of the 30 minutes ending at the newest sample's minute; a minute without a sample is a gap. */
function recentMinutes(samples: { ts: number; bpm: number }[], latestTs: number): (number | null)[] {
  const end = Math.floor(latestTs / 60) * 60 + 60;
  return minuteMeanHr(samples, end - RECENT_MINUTES * 60, end).map((v) => (v === null ? null : Math.round(v)));
}

/** Resting and max heart rate as the live workout takes them (the last 7 days' resting HR, the profile's max). */
const zoneQuery = async (ctx: Parameters<typeof loadDays>[0]) => {
  const s = workoutSetup(await loadDays(ctx, addDays(ctx.today, -7), ctx.today), ctx.today, maxHrOf(ctx), ctx.profile.sex);
  return zones(s.restingHr, s.maxHr);
};

/** `phoneOnly`: Home's no-band day; with no reading at all the card stays out of the way, as the monitor cards do. */
export function HeartRateTile({ phoneOnly }: { phoneOnly?: boolean }) {
  const { c } = useTheme();
  const { t } = useTranslation("home");
  const { liveHr } = useLiveHr();
  const live = useLiveBle();
  const demo = useApp((s) => s.source === "demo");
  const streaming = showsLive(live);
  const { latest, recent, updatedAt } = liveHr;
  const values = useMemo(() => (latest ? recentMinutes(recent, latest.ts) : []), [latest, recent]);
  const { data: set } = useScreen(zoneQuery, ["hrZones"]);
  // The line takes each minute's zone colour, as the Strain page's zones; below Zone 1 it is grey.
  const colorOf = useMemo(() => (set ? (v: number) => c[(ZONE_COLOR[zoneNumber(set, v)] as TokenName | undefined) ?? "foreground-secondary"] : undefined), [set, c]);
  if (!latest && phoneOnly && !streaming) return null;

  let body;
  if (streaming) {
    const lost = live.status !== "live";
    body = (
      <View className="flex-row items-center gap-4">
        <View className="shrink-0 gap-1.5">
          <View accessible accessibilityLabel={t(lost ? "heartRate.reconnecting" : "heartRate.live", { bpm: live.bpm ?? t("heartRate.unknown") })} className="flex-row items-center gap-2">
            <BeatingHeart bpm={live.bpm ?? 60} live={!lost} />
            <ValueUnit value={live.bpm === null ? MISSING : String(live.bpm)} unit="bpm" className={BPM} />
          </View>
          <LivePill name={live.device?.name ?? null} lost={lost} />
        </View>
        <View className="min-w-0 flex-1">
          <LiveTrace history={live.history} height={56} />
        </View>
      </View>
    );
  } else if (latest) {
    body = (
      <View className="flex-row items-center gap-4">
        <View className="shrink-0 gap-1">
          <View accessible accessibilityLabel={t("heartRate.latest", { bpm: latest.bpm })} className="flex-row items-center gap-2">
            <BeatingHeart bpm={latest.bpm} live={false} />
            <ValueUnit value={String(latest.bpm)} unit="bpm" className={BPM} />
          </View>
          <LastReading t={latest.ts * 1000} now={updatedAt ?? latest.ts * 1000} />
        </View>
        <View className="min-w-0 flex-1" style={{ height: 56 }}>
          <Sparkline values={values} color={c["recovery-red"]} colorOf={colorOf} caption={t("heartRate.lastMinutes", { minutes: RECENT_MINUTES })} className="flex-1" />
        </View>
      </View>
    );
  } else if (updatedAt === null) {
    // Before the first live read: the value's shape, nothing to say yet.
    body = (
      <View accessibilityElementsHidden className="gap-1.5">
        <SkeletonText lh={40} fs={36} className="w-24" />
        <SkeletonText className="w-28" />
      </View>
    );
  } else {
    body = (
      <View className="gap-0.5">
        <Text className="text-base font-semibold leading-[22px]">{t("heartRate.none")}</Text>
        <Text className={CAPTION}>{demo ? t("heartRate.demoNone") : t("heartRate.notSynced")}</Text>
      </View>
    );
  }
  return (
    <SectionShell variant="card" title={t("heartRate.title")} info={false} href={HREF}>
      {body}
    </SectionShell>
  );
}
