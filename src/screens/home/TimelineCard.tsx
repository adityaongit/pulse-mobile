// Home's timeline card (Settings › Places): where you are now and today's stays, opening the full timeline. Hidden
// until a place is saved. Self-loading like GymToday, so Home's own query stays unchanged.
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { clock } from "@/lib/format";
import { getTimelineCard } from "@/queries/timeline";
import { SectionShell } from "@/ui/shells/SectionShell";
import { useShellCalendar } from "@/ui/shells/ShellStatus";
import { CAPTION } from "@/ui/metrics/primitives";
import { Text } from "@/ui/Text";
import { PlaceBadge, shortDuration, stayName } from "../places/parts";
import { useScreen } from "../useScreen";

/** The card shows the latest few stays; the timeline has the rest. */
const SHOWN = 5;

export function TimelineCard() {
  const { t } = useTranslation("places");
  const { timeZone } = useShellCalendar();
  const { data } = useScreen(getTimelineCard, ["timeline-card"]);
  if (!data?.places) return null;
  const { now, stays } = data;
  const last = stays[stays.length - 1];
  const line = now
    ? now.kind === "stay"
      ? t("card.at", { name: stayName(now.place.id ? now.place : null, now.label) })
      : t("card.moving")
    : last
      ? t("card.last", { name: stayName(last.place.id ? last.place : null, last.label) })
      : t("card.none");
  const detail = now
    ? t("card.since", { time: clock(now.since, timeZone), duration: shortDuration(now.minutes) })
    : last
      ? t("stay.times", { start: clock(last.start, timeZone), end: clock(last.end, timeZone) })
      : t("card.empty");
  return (
    <SectionShell variant="card" title={t("card.title")} href="/timeline" action={{ label: t("card.open"), href: "/timeline" }}>
      <View className="gap-1">
        <Text className="text-xl font-bold leading-7 text-foreground" numberOfLines={1}>
          {line}
        </Text>
        <Text className={CAPTION}>{detail}</Text>
      </View>
      {stays.length > 0 && (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {stays.slice(-SHOWN).map((s) => (
            <View
              key={s.start}
              accessible
              accessibilityLabel={t("card.stayAria", { name: stayName(s.place.id ? s.place : null, s.label), duration: shortDuration(s.minutes) })}
              className="flex-row items-center gap-1.5 rounded-full bg-secondary py-1 pl-1 pr-2.5"
            >
              <PlaceBadge icon={s.place.icon} size={24} className={s.place.icon ? "bg-background" : undefined} />
              <Text className="font-numeric text-xs font-bold leading-4 tabular-nums">{shortDuration(s.minutes)}</Text>
            </View>
          ))}
        </View>
      )}
    </SectionShell>
  );
}
