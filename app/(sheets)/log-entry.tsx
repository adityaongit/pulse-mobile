import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { deleteLogEntry } from "@/actions/log";
import { store } from "@/data/store";
import { clock, dayLabel } from "@/lib/format";
import { MEALS, RECONNECT, type LogData } from "@/lib/log";
import { parseDay } from "@/lib/url";
import { getLogEntries, type LoggedEntry } from "@/queries/log";
import { todayOf } from "@/queries/common";
import { toast } from "@/ui/Toast";
import { useScreen } from "@/screens/useScreen";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/Button";
import { haptic } from "@/ui/haptics";
import { CAPTION } from "@/ui/metrics/primitives";
import { SheetScreen } from "@/ui/shells/SheetScreen";
import { closeSheet } from "@/ui/shells/sheets";
import { Text } from "@/ui/Text";

const n = (v: number) => v.toLocaleString("en-US");
const MEAL_LABEL = Object.fromEntries(MEALS) as Record<string, string>;

type Loaded = Awaited<ReturnType<typeof getLogEntries>>;

/** What the sheet is titled and captioned: the entry (or a weigh-in's two), and where in the day it sits. */
function heading({ entries, day, today, timeZone }: Loaded) {
  const time = (ts: number) => clock(ts * 1000, timeZone);
  const when = dayLabel(day, today);
  const e = entries[0];
  if (entries.length > 1) return { title: "Weigh-in", kicker: `${when}, ${time(e.ts)}` };
  if (e.type === "nutrition-log") return { title: e.title, kicker: `${MEAL_LABEL[(e.data as LogData["nutrition-log"]).meal] ?? (e.data as LogData["nutrition-log"]).meal} · ${when}, ${time(e.ts)}` };
  // A period shows its first day; an ovulation test, its time; the rest, the day and time.
  if (e.type === "menstrual-period") return { title: e.title, kicker: dayLabel(e.day, today) };
  if (e.type === "ovulation-test") return { title: e.title, kicker: time(e.ts) };
  return { title: e.title, kicker: `${when}, ${time(e.ts)}` };
}

/**
 * The details of one row of the day's log (Journal's DayLog): its entry, or a weigh-in's weight and body fat, where it was
 * logged, and Delete. /log-entry?ids=a,b&d=2026-10-02. A sheet is a route, so it loads its entries by id.
 */
export default function LogEntrySheet() {
  const { ids = "", d } = useLocalSearchParams<{ ids?: string; d?: string }>();
  const { data } = useScreen((ctx) => getLogEntries(ctx, ids.split(",").filter(Boolean), parseDay(d, todayOf(ctx)).d), [ids, d]);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Kept while the entries are deleted underneath it, so the sheet never empties or changes mid-way.
  const [shown, setShown] = useState<Loaded | null>(null);
  if (!removing && data && data.entries.length && data !== shown) setShown(data);

  const remove = async () => {
    if (!shown) return;
    setRemoving(true);
    let failed: { e: LoggedEntry; error: string } | null = null;
    for (const e of shown.entries) {
      const r = await deleteLogEntry(store, { id: e.id }).catch(() => ({ ok: false as const, error: "network" }));
      if (!r.ok) {
        failed = { e, error: r.error };
        break;
      }
    }
    setRemoving(false);
    setConfirming(false);
    closeSheet();
    if (!failed) return void toast.success("Deleted");
    const why = failed.error === RECONNECT ? "Reconnect Google in Settings to delete it there." : failed.error === "network" ? "Try again." : failed.error;
    // A weigh-in is two points: say which one stayed when the first went.
    toast.error(failed.e === shown.entries[0] ? `Couldn’t delete. ${why}` : `${failed.e.title} wasn’t deleted. ${why}`);
  };

  if (!shown) return <SheetScreen title="" size="default"><View className="h-40" /></SheetScreen>;

  const { title, kicker } = heading(shown);
  const entry = shown.entries[0];
  const foreign = shown.entries.some((e) => e.fromApp);
  const food = entry.type === "nutrition-log" ? (entry.data as LogData["nutrition-log"]) : null;

  return (
    <SheetScreen
      title={title}
      description={kicker}
      size="default"
      footer={
        confirming ? (
          <View className="gap-2">
            <Text className={cn(CAPTION, "text-center")}>
              {foreign ? "Pulse asks Google Health to delete it. If the app that logged it says no, delete it there." : entry.atGoogle ? "It is deleted from Google Health too." : "It is deleted from Pulse."}
            </Text>
            <View className="flex-row gap-2">
              <Button size="sheet" variant="secondary" className="flex-1" disabled={removing} onPress={() => setConfirming(false)}>
                Keep
              </Button>
              <Button size="sheet" variant="outline" className="flex-1" textClassName="text-recovery-red-text" disabled={removing} onPress={() => void remove()}>
                {removing ? "Deleting…" : "Delete"}
              </Button>
            </View>
          </View>
        ) : (
          <Button size="sheet" variant="secondary" textClassName="text-recovery-red-text" onPress={() => {
            haptic.warning();
            setConfirming(true);
          }}>
            {shown.entries.length > 1 ? "Delete weigh-in" : "Delete entry"}
          </Button>
        )
      }
    >
      <View className="gap-5 pt-2">
        {food ? (
          <View className="flex-row gap-2">
            {(
              [
                ["kcal", food.kcal],
                ["Protein", food.protein],
                ["Carbs", food.carbs],
                ["Fat", food.fat],
              ] as const
            ).map(([label, v]) => (
              <View key={label} className="flex-1 gap-0.5 rounded-xl bg-muted p-2.5">
                <Text className="font-numeric text-xl font-bold leading-6 tabular-nums">{v == null ? "--" : label === "kcal" ? n(v) : `${v} g`}</Text>
                <Text className="text-xs font-semibold leading-4 text-foreground-secondary">{label}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className="font-numeric text-2xl font-bold leading-8 tabular-nums">{shown.entries.map((e) => e.detail).join(" · ")}</Text>
        )}
        <View className="border-t border-border">
          {(
            [
              ["Logged in", entry.app],
              ["In Google Health", entry.atGoogle ? "Yes" : "Not yet, in Pulse only"],
            ] as const
          ).map(([label, value]) => (
            <View key={label} className="min-h-12 flex-row items-center justify-between gap-4 border-b border-border">
              <Text className="text-[15px] text-foreground-secondary">{label}</Text>
              <Text className="text-[15px] font-semibold">{value}</Text>
            </View>
          ))}
        </View>
        {foreign && <Text className={CAPTION}>Logged in another app. To change it, edit it there; Pulse picks up the change on the next sync.</Text>}
      </View>
    </SheetScreen>
  );
}
