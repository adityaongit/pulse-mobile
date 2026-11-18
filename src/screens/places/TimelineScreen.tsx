// `/timeline?d=`: the day's places, unknown stops and trips, oldest first, with each block's steps, heart rate and
// sleep, then the week's totals per place. A tap on a stay opens its editor. Everything is read from the phone.
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Footprints, HeartPulse, MapPinOff, Moon, Route, Settings2 } from "lucide-react-native";
import { clock, formatValue } from "@/lib/format";
import { getTimelineDay, getTimelineWeek, type EntryVM, type StayVM, type TimelineWeekVM, type TripVM } from "@/queries/timeline";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { push } from "@/ui/navigate";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { CAPTION } from "@/ui/metrics/primitives";
import { Skeleton } from "@/ui/Skeleton";
import { ScreenError } from "@/screens/recovery/shared";
import { useDayScreen } from "@/screens/health/day";
import { useScreen } from "@/screens/useScreen";
import { PlaceBadge, distanceShort, shortDuration, stayName } from "./parts";

const STAT_LABEL = "text-xs leading-4 font-bold tracking-[0.1em] text-foreground-secondary uppercase";
const NAME = "text-[15px] font-bold leading-5";
const META = "font-numeric text-xs font-medium leading-4 tabular-nums text-muted-foreground";

/** The stay editor's route with the stay it edits. Times in unix seconds. */
export function stayEditHref(s: StayVM): string {
  const q: Record<string, string> = {
    start: String(Math.round(s.start / 1000)),
    end: String(Math.round(s.end / 1000)),
  };
  if (s.overrideId) q.o = s.overrideId;
  if (s.place.id) q.p = s.place.id;
  if (s.label) q.l = s.label;
  if (s.latitude !== null && s.longitude !== null) {
    q.lat = String(s.latitude);
    q.lon = String(s.longitude);
  }
  if (s.open) q.open = "1";
  return `/timeline/edit?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

export function TimelineScreen() {
  const { t } = useTranslation("places");
  const { data, error, reload } = useDayScreen("timeline", getTimelineDay);
  const day = data?.d;
  const week = useScreen((ctx) => (day ? getTimelineWeek(day, ctx) : Promise.resolve(null)), ["timeline-week", day ?? ""]);
  if (!data) return error ? <ScreenError retry={reload} /> : <TimelineLoading />;
  const { vm, timeZone } = data;
  const settings = (
    <Press accessibilityRole="link" accessibilityLabel={t("timeline.settings")} onPress={() => push("/settings?s=places")} className="size-11 items-center justify-center">
      <Icon icon={Settings2} size={20} tone="foreground-secondary" />
    </Press>
  );
  if (!vm.places.length) {
    return (
      <DetailShell
        title={t("timeline.title")}
        action={settings}
        primary={<EmptyState body={t("timeline.noPlaces")} action={{ label: t("timeline.addPlaces"), href: "/settings?s=places" }} />}
      />
    );
  }
  const known = vm.totals.place + vm.totals.unknown + vm.totals.trip;
  return (
    <DetailShell
      title={t("timeline.title")}
      action={settings}
      dateSwitcher={{ mode: "day" }}
      primary={
        <View className="w-full gap-3">
          <Card className="flex-row gap-3 px-4">
            <Stat value={shortDuration(vm.totals.place)} label={t("timeline.atPlaces")} />
            <Stat value={shortDuration(vm.totals.unknown)} label={t("timeline.elsewhere")} />
            <Stat value={shortDuration(vm.totals.trip)} label={t("timeline.travelling")} />
          </Card>
          {known === 0 && vm.entries.every((e) => e.kind === "gap") ? (
            <Card className="px-4">
              <Text className={CAPTION}>{vm.mode === "off" ? t("timeline.trackingOff") : vm.isToday ? t("timeline.emptyToday") : t("timeline.emptyDay")}</Text>
            </Card>
          ) : (
            <Card className="p-1.5">
              <View className="gap-1.5">
                {vm.entries.map((e) => (
                  <Entry key={`${e.kind}-${e.start}`} e={e} timeZone={timeZone} />
                ))}
              </View>
            </Card>
          )}
          {vm.mode === "saver" && <Text className={cn(CAPTION, "px-1")}>{t("timeline.saverNote")}</Text>}
          <Text className={cn(CAPTION, "px-1")}>{t("timeline.editHint")}</Text>
        </View>
      }
      secondary={week.data ? [<Week key="week" vm={week.data} />] : []}
    />
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="min-w-0 flex-1 gap-1">
      <Text className="font-numeric text-xl font-bold leading-7 tabular-nums" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text className={STAT_LABEL} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Health({ steps, avgHr }: { steps: number | null; avgHr: number | null }) {
  const { t } = useTranslation("places");
  if (steps === null && avgHr === null) return null;
  return (
    <View className="flex-row items-center gap-3">
      {steps !== null && (
        <View className="flex-row items-center gap-1" accessible accessibilityLabel={t("health.stepsAria", { value: formatValue("grouped", steps) })}>
          <Icon icon={Footprints} size={12} tone="muted-foreground" />
          <Text className={META}>{formatValue("grouped", steps)}</Text>
        </View>
      )}
      {avgHr !== null && (
        <View className="flex-row items-center gap-1" accessible accessibilityLabel={t("health.hrAria", { value: avgHr })}>
          <Icon icon={HeartPulse} size={12} tone="muted-foreground" />
          <Text className={META}>{t("health.bpm", { value: avgHr })}</Text>
        </View>
      )}
    </View>
  );
}

function Entry({ e, timeZone }: { e: EntryVM; timeZone: string }) {
  if (e.kind === "stay") return <StayRow s={e} timeZone={timeZone} />;
  if (e.kind === "trip") return <TripRow trip={e} timeZone={timeZone} />;
  return <GapRow start={e.start} end={e.end} minutes={e.minutes} timeZone={timeZone} open={e.open} />;
}

function StayRow({ s, timeZone }: { s: StayVM; timeZone: string }) {
  const { t } = useTranslation("places");
  const name = stayName(s.place.id ? s.place : null, s.label);
  const start = clock(s.start, timeZone);
  const end = s.open ? t("stay.now") : clock(s.end, timeZone);
  const duration = shortDuration(s.minutes);
  return (
    <Press
      activeScale={0.98}
      activeBg="bg-accent"
      accessibilityRole="button"
      accessibilityLabel={t("stay.aria", { name, start, end, duration })}
      accessibilityHint={t("stay.editHint")}
      onPress={() => push(stayEditHref(s))}
      className="flex-row gap-3 rounded-lg bg-secondary px-3 py-3"
    >
      <PlaceBadge icon={s.place.icon} />
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className={cn(NAME, !s.place.id && "text-foreground-secondary")} numberOfLines={1}>
            {name}
          </Text>
          <Text className="font-numeric text-[15px] font-bold leading-5 tabular-nums">{duration}</Text>
        </View>
        <Text className={META}>{[t("stay.times", { start, end }), s.open ? t("stay.here") : s.capped ? t("stay.capped") : null, s.overrideId ? t("stay.edited") : null].filter(Boolean).join(" · ")}</Text>
        <Health steps={s.steps} avgHr={s.avgHr} />
        {s.sleep && (
          <View className="mt-1 flex-row items-center gap-1.5 self-start rounded-md bg-sleep/15 px-2 py-1">
            <Icon icon={Moon} size={12} tone="sleep" />
            <Text className="font-numeric text-xs font-medium leading-4 tabular-nums text-sleep">
              {t("stay.asleep", { start: clock(s.sleep.start, timeZone), end: clock(s.sleep.end, timeZone), duration: shortDuration(s.sleep.minutes) })}
            </Text>
          </View>
        )}
      </View>
    </Press>
  );
}

function TripRow({ trip, timeZone }: { trip: TripVM; timeZone: string }) {
  const { t } = useTranslation("places");
  const from = trip.from ? stayName(trip.from.id ? trip.from : null) : null;
  const to = trip.to ? stayName(trip.to.id ? trip.to : null) : null;
  const route = from && to ? t("trip.route", { from, to }) : to ? t("trip.to", { to }) : from ? t("trip.from", { from }) : t("trip.title");
  const parts = [shortDuration(trip.minutes), trip.metres !== null ? distanceShort(trip.metres, trip.approx) : null].filter(Boolean).join(" · ");
  const end = trip.open ? t("stay.now") : clock(trip.end, timeZone);
  return (
    <View accessible accessibilityLabel={t("trip.aria", { route, start: clock(trip.start, timeZone), end, detail: parts })} className="flex-row items-center gap-3 px-3 py-1.5">
      <View className="w-9 items-center">
        <Icon icon={Route} size={16} tone="muted-foreground" />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-[13px] font-medium leading-[18px] text-foreground-secondary" numberOfLines={1}>
          {trip.open ? t("trip.moving") : route}
        </Text>
        <Text className={META}>{t("trip.meta", { start: clock(trip.start, timeZone), end, detail: parts })}</Text>
        <Health steps={trip.steps} avgHr={trip.avgHr} />
      </View>
    </View>
  );
}

function GapRow({ start, end, minutes, timeZone, open }: { start: number; end: number; minutes: number; timeZone: string; open: boolean }) {
  const { t } = useTranslation("places");
  return (
    <View accessible className="flex-row items-center gap-3 px-3 py-1.5">
      <View className="w-9 items-center">
        <Icon icon={MapPinOff} size={16} tone="muted-foreground" />
      </View>
      <Text className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted-foreground">
        {t("gap.line", { start: clock(start, timeZone), end: open ? t("stay.now") : clock(end, timeZone), duration: shortDuration(minutes) })}
      </Text>
    </View>
  );
}

function Week({ vm }: { vm: TimelineWeekVM }) {
  const { t } = useTranslation("places");
  const empty = !vm.places.length && !vm.trips.count && !vm.unknownStops;
  return (
    <SectionShell variant="card" title={t("week.title")}>
      {empty ? (
        <Text className={CAPTION}>{t("week.empty")}</Text>
      ) : (
        <View className="gap-3">
          {vm.places.map((p) => (
            <View key={p.place.id} className="flex-row items-center gap-3" accessible accessibilityLabel={t("week.placeAria", { name: p.place.name, duration: shortDuration(p.minutes), count: p.visits })}>
              <PlaceBadge icon={p.place.icon} size={32} />
              <Text className="min-w-0 flex-1 text-[15px] font-medium leading-5" numberOfLines={1}>
                {p.place.name}
              </Text>
              <View className="items-end">
                <Text className="font-numeric text-[15px] font-bold leading-5 tabular-nums">{shortDuration(p.minutes)}</Text>
                <Text className={META}>{t("week.visits", { count: p.visits })}</Text>
              </View>
            </View>
          ))}
          {vm.unknownStops > 0 && (
            <View className="flex-row items-center gap-3">
              <PlaceBadge icon={null} size={32} />
              <Text className="min-w-0 flex-1 text-[15px] font-medium leading-5 text-foreground-secondary">{t("week.otherPlaces")}</Text>
              <View className="items-end">
                <Text className="font-numeric text-[15px] font-bold leading-5 tabular-nums">{shortDuration(vm.unknownMinutes)}</Text>
                <Text className={META}>{t("week.stops", { count: vm.unknownStops })}</Text>
              </View>
            </View>
          )}
          {vm.trips.count > 0 && (
            <View className="flex-row items-center gap-3 border-t border-border pt-3">
              <View className="size-8 items-center justify-center">
                <Icon icon={Route} size={16} tone="muted-foreground" />
              </View>
              <Text className="min-w-0 flex-1 text-[15px] font-medium leading-5 text-foreground-secondary">{t("week.travel")}</Text>
              <View className="items-end">
                <Text className="font-numeric text-[15px] font-bold leading-5 tabular-nums">{shortDuration(vm.trips.minutes)}</Text>
                <Text className={META}>
                  {t("week.trips", { count: vm.trips.count })}
                  {vm.trips.metres > 0 ? ` · ${distanceShort(vm.trips.metres, false)}` : ""}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
    </SectionShell>
  );
}

function TimelineLoading() {
  const { t } = useTranslation("places");
  return (
    <DetailShell
      loading
      title={t("timeline.title")}
      dateSwitcher={{ mode: "day" }}
      primary={
        <View className="w-full gap-3">
          <Card style={{ height: 76 }} />
          <Card className="gap-1.5 p-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg bg-muted" />
            ))}
          </Card>
        </View>
      }
    />
  );
}
