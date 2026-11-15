// Habits `/habits`: a grid of habits by day, Loop's numbers. The left column holds the habit, the right one a scrollable
// month of ticks with today first; a tap ticks a day, a long press opens the menu. The tracker is Pulse's own: local
// SQLite, no health source.
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Activity, Archive, ArchiveRestore, CircleCheckBig, Code2, Pencil, Plus, SkipForward, Trash2, Utensils, type LucideIcon } from "lucide-react-native";
import type { Habit } from "@/core/habits/types";
import { habitIcon } from "@/core/habits/icons";
import type { ActivityDayVM, HabitCardVM } from "@/queries/habits";
import { getHabits } from "@/queries/habits";
import type { FoodOrdersVM } from "@/queries/foodOrders";
import { leetcodeView } from "@/leetcode/view";
import { useLeetCode } from "@/state/leetcode";
import { archiveHabit, clearHabitEntry, deleteHabit, setHabitEntry, skipHabitDay, toggleHabit } from "@/actions/habits";
import { actionCtx } from "@/state/app";
import { habitsChanged } from "@/state/habits";
import { useScreen } from "@/screens/useScreen";
import { DAY, clock, formatDay } from "@/lib/format";
import { Card, CardFill } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { MenuPanel, useMenu } from "@/ui/Menu";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { ConfirmDialog, lengthText } from "@/screens/gym/parts";
import { EmptyState } from "@/ui/shells/EmptyState";
import { PageShell } from "@/ui/shells/PageShell";
import { QueryError } from "@/ui/shells/QueryError";
import { SectionShell } from "@/ui/shells/SectionShell";
import { push } from "@/ui/navigate";
import { toast } from "@/ui/Toast";
import { ActivityCluster, DayHeading, DayMark, HabitValueDialog, habitColor } from "./parts";
import { useFoodOrders } from "./useFoodOrders";
import { ACTIVITY_LOOK } from "./activity";
import { InfoDialog } from "@/ui/shells/InfoDialog";

const nowS = () => Math.floor(Date.now() / 1000);

export function HabitsScreen() {
  const { t } = useTranslation("habits");
  const { data, error, reload } = useScreen(getHabits, ["habits"], { eager: true, freshMs: 0 });
  const food = useFoodOrders();
  const leetcodeState = useLeetCode();
  // The table's LeetCode row: the connected profile's last 30 days, newest first, as submissions per day.
  const leetcode = leetcodeState.snapshot
    ? leetcodeView(leetcodeState.snapshot, actionCtx().timeZone, nowS()).activity.slice(-30).reverse().map((d) => ({ day: d.day, count: d.submissions }))
    : null;
  const [value, setValue] = useState<{ habit: Habit; day: string; initial: number | null } | null>(null);
  const [removing, setRemoving] = useState<Habit | null>(null);
  const changed = () => habitsChanged();

  const store = () => actionCtx().store;
  const toggle = async (habit: Habit, day: string) => {
    if (habit.kind === "numeric") {
      const entry = (await store().habitEntries(day, day)).find((e) => e.habitId === habit.id);
      setValue({ habit, day, initial: entry && !entry.skip ? entry.value : null });
      return;
    }
    await toggleHabit(store(), habit, day, nowS());
    changed();
  };
  const skip = async (habit: Habit, day: string) => {
    await skipHabitDay(store(), habit, day, nowS());
    changed();
  };
  const saveValue = async (habit: Habit, day: string, amount: number) => {
    await setHabitEntry(store(), habit, { day, value: amount }, nowS());
    setValue(null);
    changed();
  };
  const clearValue = async (habit: Habit, day: string) => {
    await clearHabitEntry(store(), habit.id, day);
    setValue(null);
    changed();
  };
  const archive = async (habit: Habit) => {
    await archiveHabit(store(), habit.id, true, nowS());
    changed();
    toast.success(t("menu.archived"));
  };
  const restore = async (habit: Habit) => {
    await archiveHabit(store(), habit.id, false, nowS());
    changed();
    toast.success(t("menu.unarchived"));
  };

  return (
    <PageShell
      title={t("title")}
      loading={!data}
      actions={
        <>
          <Press activeScale={0.96} accessibilityRole="button" accessibilityLabel={t("food.scan")} disabled={food.scanning} onPress={() => void food.scan(true)} className="h-9 flex-row items-center gap-1.5 rounded-full bg-secondary px-3">
            <Icon icon={Utensils} size={15} tone="foreground-secondary" strokeWidth={2} />
            <Text className="text-[12px] font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary">{food.scanning ? t("food.scanning") : t("food.scan")}</Text>
          </Press>
          <Press activeScale={0.96} accessibilityRole="button" accessibilityLabel={t("new")} onPress={() => push("/habits/edit")} className="h-9 flex-row items-center gap-1.5 rounded-full bg-secondary px-3">
            <Icon icon={Plus} size={16} tone="foreground" strokeWidth={2.4} />
            <Text className="text-[12px] font-bold uppercase leading-4 tracking-[0.1em]">{t("new")}</Text>
          </Press>
        </>
      }
    >
      {!data ? (
        error ? <QueryError compact error={error} reload={reload} /> : <View className="h-40" />
      ) : (
        <View className="gap-3">
          {data.habits.length === 0 && <EmptyState icon={CircleCheckBig} body={t("emptyBody")} action={{ label: t("new"), onClick: () => push("/habits/edit") }} />}
          {(data.habits.length > 0 || food.data || data.activityWeek > 0 || Object.keys(data.activity).length > 0 || leetcode) && (
            <HabitGrid
              days={data.days}
              cards={data.habits}
              today={data.today}
              food={food.data ?? null}
              activity={data.activity}
              activityWeek={data.activityWeek}
              leetcode={leetcode}
              onToggle={toggle}
              onSkip={skip}
              onDelete={setRemoving}
              onArchive={archive}
            />
          )}
          {data.archived.length > 0 && (
            <SectionShell variant="section" title={t("archived")}>
              <Card className="px-3 py-1">
                <CardFill />
                {data.archived.map((card, i) => (
                  <View key={card.habit.id} className={cn("flex-row items-center gap-2 py-1.5", i > 0 && "border-t border-border")}>
                    <Text className="min-w-0 flex-1 text-[14px] leading-5 text-foreground-secondary" numberOfLines={1}>
                      {card.habit.name}
                    </Text>
                    <Press accessibilityRole="button" accessibilityLabel={t("menu.unarchive")} onPress={() => void restore(card.habit)} className="h-8 flex-row items-center gap-1.5 rounded-full bg-secondary px-3">
                      <Icon icon={ArchiveRestore} size={14} tone="foreground-secondary" />
                      <Text className="text-[11px] font-bold uppercase tracking-[0.08em]">{t("menu.unarchive")}</Text>
                    </Press>
                  </View>
                ))}
              </Card>
            </SectionShell>
          )}
        </View>
      )}

      {value && (
        <HabitValueDialog
          key={`${value.habit.id}-${value.day}`}
          habit={value.habit}
          day={value.day}
          initial={value.initial}
          onClose={() => setValue(null)}
          onSave={(amount) => void saveValue(value.habit, value.day, amount)}
          onClear={() => void clearValue(value.habit, value.day)}
          onSkip={() => {
            void skip(value.habit, value.day);
            setValue(null);
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        title={t("deleteTitle")}
        body={t("deleteBody")}
        confirm={t("delete")}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await deleteHabit(store(), removing.id);
          setRemoving(null);
          changed();
        }}
      />
    </PageShell>
  );
}

/** The list as a table: a fixed name column and a month of days that scrolls under today's date header. Habits, food
 *  orders, the month's workouts and LeetCode are its rows. */
function HabitGrid({
  days,
  cards,
  today,
  food,
  activity,
  activityWeek,
  leetcode,
  onToggle,
  onSkip,
  onDelete,
  onArchive,
}: {
  days: string[];
  cards: HabitCardVM[];
  today: string;
  food: FoodOrdersVM | null;
  activity: Record<string, ActivityDayVM>;
  activityWeek: number;
  leetcode: { day: string; count: number }[] | null;
  onToggle: (habit: Habit, day: string) => Promise<void>;
  onSkip: (habit: Habit, day: string) => Promise<void>;
  onDelete: (habit: Habit) => void;
  onArchive: (habit: Habit) => Promise<void>;
}) {
  const { t } = useTranslation("habits");
  const { t: tl } = useTranslation("leetcode");
  const { c } = useTheme();
  const [openDay, setOpenDay] = useState<string | null>(null);
  // The row stays once there is a workout in the month, so today's empty ring has somewhere to be.
  const hasActivity = Object.keys(activity).length > 0;
  return (
    <Card className="py-0">
      <CardFill />
      <View className="flex-row">
        <View className="w-36 shrink-0 border-r border-border">
          <View className="h-9 border-b border-border" />
          {cards.map((card, i) => (
            <HabitNameCell key={card.habit.id} card={card} today={today} first={i === 0} onSkip={onSkip} onDelete={onDelete} onArchive={onArchive} />
          ))}
          {food && <GridNameCell icon={Utensils} label={t("food.title")} first={cards.length === 0} />}
          {hasActivity && (
            <GridNameCell icon={Activity} label={t("activity.title")} sub={t("activity.week", { count: activityWeek })} first={cards.length === 0 && !food} href="/activities" tall />
          )}
          {leetcode && <GridNameCell icon={Code2} label={tl("title")} first={cards.length === 0 && !food && !hasActivity} href="/leetcode" />}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
          <View>
            <View className="h-9 flex-row border-b border-border">
              {days.map((d) => (
                <DayHeading key={d} day={d} today={today} />
              ))}
            </View>
            {cards.map((card, i) => {
              const color = habitColor(c, card.habit.color);
              return (
                <View key={card.habit.id} className={cn("h-11 flex-row", i > 0 && "border-t border-border")}>
                  {card.days.map((d) => {
                    const off = d.state.state === "off";
                    return (
                      <Press key={d.day} accessibilityRole="button" accessibilityLabel={formatDay(d.day, DAY.long)} disabled={off} accessibilityState={{ disabled: off }} onPress={() => void onToggle(card.habit, d.day)} className="h-11 w-10 items-center justify-center">
                        <DayMark habit={card.habit} state={d.state} color={color} size={24} today={d.day === today} />
                      </Press>
                    );
                  })}
                </View>
              );
            })}
            {food && (
              <View className={cn("h-11 flex-row", cards.length > 0 && "border-t border-border")}>
                {food.days.map((d) => (
                  <CountCell key={d.day} count={d.count} tone="optimal" />
                ))}
              </View>
            )}
            {hasActivity && (
              <View className={cn("h-14 flex-row", (cards.length > 0 || !!food) && "border-t border-border")}>
                {days.map((day) => (
                  <Press
                    key={day}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("activity.title")} · ${formatDay(day, DAY.long)}`}
                    onPress={() => setOpenDay(day)}
                    className="h-14 w-10 items-center justify-center"
                  >
                    <ActivityCluster kinds={activity[day]?.kinds ?? []} today={day === today} />
                  </Press>
                ))}
              </View>
            )}
            {leetcode && (
              <View className={cn("h-11 flex-row", (cards.length > 0 || !!food || hasActivity) && "border-t border-border")}>
                {leetcode.map((d) => (
                  <CountCell key={d.day} count={d.count} tone="coach" />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
      <ActivityDayDialog day={openDay} today={today} items={openDay ? (activity[openDay]?.items ?? []) : []} onClose={() => setOpenDay(null)} />
    </Card>
  );
}

/** A day of the Activity row, opened: each workout with its kind, start time and length. */
function ActivityDayDialog({ day, today, items, onClose }: { day: string | null; today: string; items: ActivityDayVM["items"]; onClose: () => void }) {
  const { t } = useTranslation("habits");
  const { t: tc } = useTranslation("common");
  const { c } = useTheme();
  return (
    <InfoDialog
      open={!!day}
      onClose={onClose}
      title={day === today ? tc("today") : day ? formatDay(day, DAY.long) : ""}
      action={{ label: t("activity.all"), href: "/activities" }}
      body={
        items.length ? (
          <View>
            {items.map((item, i) => {
              const look = ACTIVITY_LOOK[item.kind];
              return (
                <View key={item.id} className={cn("flex-row items-center gap-3 py-2.5", i > 0 && "border-t border-border")}>
                  <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: c[look.color] }}>
                    <Icon icon={look.icon} size={16} tone="background" strokeWidth={2.4} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15px] font-semibold leading-5" numberOfLines={1}>
                      {item.name ?? t(`activity.kind.${item.kind}`)}
                    </Text>
                    <Text className="font-numeric text-[12px] leading-4 tabular-nums text-muted-foreground">{clock(item.startTs * 1000)}</Text>
                  </View>
                  <Text className="font-numeric text-[14px] tabular-nums text-foreground-secondary">{lengthText(Math.max(0, item.endTs - item.startTs))}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          t("activity.empty")
        )
      }
    />
  );
}

/** A day's count (food orders, LeetCode submissions) in the row's tint. */
function CountCell({ count, tone }: { count: number; tone: "optimal" | "coach" }) {
  return (
    <View className="h-11 w-10 items-center justify-center">
      <View className={cn("size-7 items-center justify-center rounded-full", count > 0 ? (tone === "optimal" ? "bg-optimal/15" : "bg-coach/15") : "bg-secondary")}>
        <Text className={cn("font-numeric text-[12px] font-semibold leading-4", count > 0 ? (tone === "optimal" ? "text-optimal-text" : "text-coach-text") : "text-muted-foreground")}>{count || "·"}</Text>
      </View>
    </View>
  );
}

/** A non-habit row's fixed cell: a line icon, the row's name and an optional line under it; its screen opens on tap. */
function GridNameCell({ icon, label, sub, first, href, tall }: { icon: LucideIcon; label: string; sub?: string; first: boolean; href?: string; tall?: boolean }) {
  const content = (
    <>
      <Icon icon={icon} size={16} tone="foreground-secondary" />
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold leading-5" numberOfLines={1}>
          {label}
        </Text>
        {!!sub && (
          <Text className="text-[11px] leading-4 text-muted-foreground" numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
    </>
  );
  return (
    <View className={cn(tall ? "h-14" : "h-11", "flex-row items-center px-3", !first && "border-t border-border")}>
      {href ? (
        <Press accessibilityRole="link" accessibilityLabel={label} onPress={() => push(href)} className="min-w-0 flex-1 flex-row items-center gap-2">
          {content}
        </Press>
      ) : (
        <View className="min-w-0 flex-1 flex-row items-center gap-2">{content}</View>
      )}
    </View>
  );
}

/** A habit's fixed cell: tapping opens it, holding opens the menu the tick columns have no room for. */
function HabitNameCell({
  card,
  today,
  first,
  onSkip,
  onDelete,
  onArchive,
}: {
  card: HabitCardVM;
  today: string;
  first: boolean;
  onSkip: (habit: Habit, day: string) => Promise<void>;
  onDelete: (habit: Habit) => void;
  onArchive: (habit: Habit) => Promise<void>;
}) {
  const { t } = useTranslation("habits");
  const { ref, anchor, open, close } = useMenu();
  return (
    <View ref={ref} collapsable={false} className={cn("h-11 flex-row items-center px-3", !first && "border-t border-border")}>
      <Press
        accessibilityRole="link"
        accessibilityLabel={card.habit.name}
        accessibilityHint={t("menu.label")}
        accessibilityActions={[{ name: "longpress", label: t("menu.label") }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === "longpress" && open()}
        onPress={() => push(`/habits/${card.habit.id}`)}
        onLongPress={open}
        delayLongPress={400}
        className="min-w-0 flex-1 flex-row items-center gap-2"
      >
        <Text className="text-[17px] leading-5">{habitIcon(card.habit)}</Text>
        <Text className="shrink text-[15px] font-semibold leading-5" numberOfLines={1}>
          {card.habit.name}
        </Text>
      </Press>
      <MenuPanel anchor={anchor} onClose={close} align="start">
        <MenuItem icon={Pencil} label={t("menu.edit")} onPress={() => (close(), push(`/habits/edit?id=${card.habit.id}`))} />
        <MenuItem icon={SkipForward} label={t("menu.skip")} onPress={() => (close(), void onSkip(card.habit, today))} />
        <MenuItem icon={Archive} label={t("menu.archive")} onPress={() => (close(), void onArchive(card.habit))} />
        <MenuItem icon={Trash2} label={t("menu.delete")} danger onPress={() => (close(), onDelete(card.habit))} />
      </MenuPanel>
    </View>
  );
}

function MenuItem({ icon, label, onPress, danger }: { icon: LucideIcon; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Press activeBg="bg-fill-hover" accessibilityRole="button" onPress={onPress} className="h-11 flex-row items-center gap-3 rounded-xl px-3">
      <Icon icon={icon} size={18} tone={danger ? "recovery-red-text" : "foreground-secondary"} />
      <Text className={cn("text-[15px] font-medium", danger && "text-recovery-red-text")}>{label}</Text>
    </Press>
  );
}
