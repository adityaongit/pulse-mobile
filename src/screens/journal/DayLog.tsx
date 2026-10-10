// Journal's day log (spec §11 LG1), pulse's (app)/journal/DayLog.tsx: the selected day's entries, grouped, each opening a
// sheet with its details (app/(sheets)/log-entry.tsx, which also holds Delete).
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { ChevronRight, Plus, type LucideIcon } from "lucide-react-native";
import { clock, dayLabel } from "@/lib/format";
import { LOG_DAYS, type LogData, type LogKind } from "@/lib/log";
import type { LoggedEntry, LogVM, Weighin } from "@/queries/log";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { CAPTION, LABEL } from "@/ui/metrics/primitives";
import { openSheet } from "@/ui/shells/sheets";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { ICON, logHref } from "./LogTiles";

const n = (v: number) => v.toLocaleString("en-US");
const TIME = "shrink-0 font-numeric text-[13px] font-medium leading-4 tabular-nums text-muted-foreground";
const NOT_LISTED = `Total from Google Health. Entries from other apps are listed for the last ${LOG_DAYS} days.`;

const entryHref = (entries: LoggedEntry[], vm: LogVM) => `/log-entry?ids=${entries.map((e) => e.id).join(",")}&d=${vm.day}`;

function Group({ icon, title, total, kind, vm, first, children }: { icon: LucideIcon; title: string; total?: string; kind: LogKind; vm: LogVM; first?: boolean; children: ReactNode }) {
  return (
    <View accessibilityLabel={title} className={cn("border-border py-2", !first && "border-t")}>
      <View className="min-h-11 flex-row items-center gap-3">
        <Icon icon={icon} size={20} tone="foreground-secondary" strokeWidth={1.75} />
        <Text accessibilityRole="header" className={cn(LABEL, "flex-1")}>
          {title}
        </Text>
        {total && <Text className="font-numeric text-[15px] font-bold tabular-nums">{total}</Text>}
        {vm.kinds.includes(kind) && (
          <Pressable accessibilityRole="button" accessibilityLabel={`Log ${title.toLowerCase()}`} onPress={() => openSheet(logHref(kind, vm))} className="-mr-2 size-11 items-center justify-center rounded-full active:bg-muted">
            <Icon icon={Plus} size={20} tone="foreground-secondary" strokeWidth={2} />
          </Pressable>
        )}
      </View>
      <View className="pl-8">{children}</View>
    </View>
  );
}

/** One tappable entry row: title and detail, where it came from, the time. */
function Row({ e, title, detail, time, href }: { e: LoggedEntry; title: string; detail?: string; time: string; href: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}${detail ? `, ${detail}` : ""}, ${time}, ${e.app}`} onPress={() => openSheet(href)} className="-mx-2 min-h-13 flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-accent">
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] leading-[22px]">
          {title}
        </Text>
        <Text numberOfLines={1} className={CAPTION}>
          {detail ? `${detail} · ${e.app}` : e.app}
        </Text>
      </View>
      <Text className={TIME}>{time}</Text>
      <Icon icon={ChevronRight} size={16} tone="muted-foreground" strokeWidth={1.75} />
    </Pressable>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <Text className={cn(CAPTION, "pb-2")}>{children}</Text>;

function Swatch({ color }: { color: string }) {
  return <View accessibilityElementsHidden className={cn("mr-1.5 size-2 rounded-[2px]", color)} />;
}

export function DayLog({ vm }: { vm: LogVM }) {
  const time = (ts: number) => clock(ts * 1000, vm.timeZone);
  const food = vm.food.total;
  const macros = food && food.protein + food.carbs + food.fat > 0 ? food : null;
  const weighin = (w: Weighin, last: boolean) => {
    const parts = [w.kg !== null && `${w.kg} kg`, w.pct !== null && `${w.pct}% body fat`].filter(Boolean).join(", ");
    const change = last && vm.body.change ? `${vm.body.change.kg > 0 ? "+" : vm.body.change.kg < 0 ? "−" : "±"}${Math.abs(vm.body.change.kg)} kg since ${dayLabel(vm.body.change.since, vm.today)}` : undefined;
    return <Row key={w.ts} e={w.entries[0]} title={parts} detail={change} time={time(w.ts)} href={entryHref(w.entries, vm)} />;
  };

  return (
    <Card className="gap-0 px-4 py-1">
      <Group icon={ICON.water} title="Water" total={vm.water.total ? `${n(vm.water.total)} ml` : undefined} kind="water" vm={vm} first>
        {vm.water.entries.length ? (
          <View accessibilityLabel="Drinks" className="flex-row flex-wrap gap-2 pb-2">
            {vm.water.entries.map((e) => (
              <Pressable
                key={e.id}
                accessibilityRole="button"
                accessibilityLabel={`${e.detail}, ${time(e.ts)}, ${e.app}`}
                onPress={() => openSheet(entryHref([e], vm))}
                className="h-11 flex-row items-center gap-2 rounded-full border border-border px-3.5 active:bg-accent"
              >
                <Text className="font-numeric text-[15px] font-bold tabular-nums">{e.detail}</Text>
                <Text className={TIME}>{time(e.ts)}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Empty>{!vm.water.total ? "No drinks logged." : vm.listed ? "Logged in other apps; the drinks show after the next sync." : NOT_LISTED}</Empty>
        )}
      </Group>

      <Group icon={ICON.food} title="Food" total={food ? `${n(food.kcal)} kcal` : undefined} kind="food" vm={vm}>
        {macros && (
          <View className="gap-2 pb-1">
            <View accessibilityElementsHidden className="h-2 flex-row gap-0.5 overflow-hidden rounded-full bg-muted">
              <View className="bg-strain" style={{ flexGrow: macros.protein * 4, flexBasis: 0 }} />
              <View className="bg-optimal" style={{ flexGrow: macros.carbs * 4, flexBasis: 0 }} />
              <View className="bg-warning" style={{ flexGrow: macros.fat * 9, flexBasis: 0 }} />
            </View>
            <View className="flex-row flex-wrap gap-x-4 gap-y-1">
              {(
                [
                  ["Protein", macros.protein, "bg-strain"],
                  ["Carbs", macros.carbs, "bg-optimal"],
                  ["Fat", macros.fat, "bg-warning"],
                ] as const
              ).map(([label, g, color]) => (
                <View key={label} className="flex-row items-center">
                  <Swatch color={color} />
                  <Text className="font-numeric text-[13px] font-semibold leading-4 tabular-nums text-foreground-secondary">
                    {label} {n(g)} g
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
        {food && !vm.listed && vm.food.meals.every((m) => !m.entries.length) && <Empty>{NOT_LISTED}</Empty>}
        {vm.food.meals.map((m) => (
          <View key={m.meal} className="pt-2">
            <View className="flex-row items-center justify-between">
              <Text accessibilityRole="header" className={cn(LABEL, "text-muted-foreground")}>
                {m.label}
              </Text>
              {m.entries.length > 0 && <Text className="font-numeric text-[13px] font-semibold tabular-nums text-muted-foreground">{n(m.kcal)} kcal</Text>}
            </View>
            {m.entries.length ? (
              m.entries.map((e) => {
                const f = e.data as LogData["nutrition-log"];
                const macro = [f.protein != null && `${f.protein} g protein`, f.carbs != null && `${f.carbs} g carbs`, f.fat != null && `${f.fat} g fat`].filter(Boolean).join(", ");
                return <Row key={e.id} e={e} title={`${e.title}, ${n(f.kcal)} kcal`} detail={macro || undefined} time={time(e.ts)} href={entryHref([e], vm)} />;
              })
            ) : (
              <Empty>Nothing logged.</Empty>
            )}
          </View>
        ))}
      </Group>

      <Group icon={ICON.weight} title="Body" kind="weight" vm={vm}>
        {vm.body.weighins.length ? vm.body.weighins.map((w, i) => weighin(w, i === vm.body.weighins.length - 1)) : <Empty>{vm.body.latest ? `No weigh-in. Last: ${vm.body.latest.kg} kg, ${dayLabel(vm.body.latest.day, vm.today)}.` : "No weigh-in."}</Empty>}
      </Group>

      <Group icon={ICON.mood} title="Mood and symptoms" kind="mood" vm={vm}>
        {vm.moods.length + vm.symptoms.length ? (
          [...vm.moods, ...vm.symptoms]
            .sort((a, b) => a.ts - b.ts)
            .map((e) => <Row key={e.id} e={e} title={e.title} detail={e.detail} time={time(e.ts)} href={entryHref([e], vm)} />)
        ) : (
          <Empty>Nothing logged.</Empty>
        )}
      </Group>

      {vm.cycle.length > 0 && (
        <Group icon={ICON.period} title="Cycle" kind="period" vm={vm}>
          {vm.cycle.map((e) => (
            <Row key={e.id} e={e} title={e.title} detail={e.detail} time={e.type === "menstrual-period" ? dayLabel(e.day, vm.today) : time(e.ts)} href={entryHref([e], vm)} />
          ))}
        </Group>
      )}
    </Card>
  );
}
