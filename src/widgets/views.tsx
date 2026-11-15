// The home-screen widgets' layouts. They use the widget library's own primitives (RemoteViews, not React Native views),
// with the palette's concrete colours for light and dark. Every text and percentage is computed before this file, so a
// widget never reads the database itself.
import { FlexWidget, SvgWidget, TextWidget, type WidgetRepresentation } from "react-native-android-widget";
import type { DayState, HabitStats } from "@/core/habits/logic";
import type { Habit } from "@/core/habits/types";
import { habitIcon } from "@/core/habits/icons";
import { i18n } from "@/i18n/config";
import { periodText, streakText } from "@/lib/habits";
import { addDays } from "@/lib/time";
import { DARK, LIGHT, type Palette } from "@/ui/palette";

export type Theme = "light" | "dark";
type Hex = `#${string}`;
const pal = (theme: Theme): Palette => (theme === "light" ? LIGHT : DARK);
const accent = (habit: Habit, theme: Theme): Hex => pal(theme)[habit.color] as Hex;
const chip = (theme: Theme): Hex => pal(theme).secondary as Hex;
const fg = (theme: Theme): Hex => pal(theme).foreground as Hex;
const muted = (theme: Theme): Hex => pal(theme)["muted-foreground"] as Hex;
const card = (theme: Theme): Hex => pal(theme).card as Hex;

export type HabitWidgetView = {
  habit: Habit;
  stats: HabitStats;
  /** Days for the history/check strip, oldest first. */
  days: { day: string; state: DayState }[];
  /** 0-100 scores for the chart, oldest first. */
  scores: number[];
};

export type TodayView = {
  cards: { habit: Habit; stats: HabitStats }[];
  done: number;
  total: number;
};

const shell = (theme: Theme, size?: { w: number; h: number }) => ({
  width: "match_parent" as const,
  height: "match_parent" as const,
  padding: 12,
  backgroundColor: card(theme),
  borderRadius: 18,
  flexDirection: "column" as const,
  justifyContent: "space-between" as const,
});

const spark = (values: number[], color: string) => {
  const w = 200;
  const h = 48;
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (Math.max(0, Math.min(100, v)) / 100) * h).toFixed(1)}`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
};

const openHabit = (habit: Habit) => ({ clickAction: "OPEN_URI" as const, clickActionData: { uri: `pulse://habits/${habit.id}` } });

/** 2x2: the habit's name, a big tick (tap toggles), the score and today's target line. */
function Check({ view, theme }: { view: HabitWidgetView; theme: Theme }) {
  const { habit, stats } = view;
  const done = stats.today.state === "done";
  const off = !stats.scheduled;
  const numeric = habit.kind === "numeric";
  const circle = (
    <FlexWidget
      style={{ width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: done ? accent(habit, theme) : "#00000000", borderWidth: done ? 0 : 2, borderColor: muted(theme) }}
      {...(numeric ? openHabit(habit) : { clickAction: "toggle", clickActionData: { habitId: habit.id } })}
      accessibilityLabel={`${habit.name}, ${i18n.t(!stats.scheduled ? "habits:card.weekdays" : done ? "habits:card.doneToday" : "habits:card.notDoneToday")}`}
    >
      <TextWidget text={off ? "–" : numeric ? String(stats.today.value ?? "—") : done ? "✓" : ""} style={{ fontSize: off ? 26 : numeric ? 22 : 36, fontWeight: "bold", color: done ? "#ffffff" : muted(theme), textAlign: "center" }} allowFontScaling={false} />
    </FlexWidget>
  );  return (
    <FlexWidget style={shell(theme)} {...openHabit(habit)}>
      <TextWidget text={`${habitIcon(habit)} ${habit.name}`} maxLines={2} truncate="END" style={{ fontSize: 13, fontWeight: "600", color: fg(theme) }} allowFontScaling={false} />
      <FlexWidget style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "match_parent" }}>
        {circle}
        <FlexWidget style={{ alignItems: "flex-end", justifyContent: "center" }}>
          <TextWidget text={`${Math.round(stats.score * 100)}%`} style={{ fontSize: 20, fontWeight: "bold", color: accent(habit, theme) }} allowFontScaling={false} />
          <TextWidget text={i18n.t("habits:card.score")} style={{ fontSize: 9, color: muted(theme) }} allowFontScaling={false} />
        </FlexWidget>
      </FlexWidget>
      <TextWidget text={periodText(habit, stats)} maxLines={1} truncate="END" style={{ fontSize: 10, color: muted(theme) }} allowFontScaling={false} />
    </FlexWidget>
  );
}

/** 4x2: the score number and its 30-day curve. */
function Score({ view, theme }: { view: HabitWidgetView; theme: Theme }) {
  const { habit, stats } = view;
  return (
    <FlexWidget style={shell(theme)} {...openHabit(habit)}>
      <FlexWidget style={{ flexDirection: "row", justifyContent: "space-between", width: "match_parent", alignItems: "center" }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget text={`${habitIcon(habit)} ${habit.name}`} maxLines={1} truncate="END" style={{ fontSize: 13, fontWeight: "600", color: fg(theme) }} allowFontScaling={false} />
        </FlexWidget>
        <TextWidget text={streakText(habit, stats.current)} style={{ fontSize: 10, color: muted(theme) }} allowFontScaling={false} />
      </FlexWidget>
      <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end", flexGap: 8, width: "match_parent" }}>
        <TextWidget text={`${Math.round(stats.score * 100)}%`} style={{ fontSize: 32, fontWeight: "bold", color: accent(habit, theme) }} allowFontScaling={false} />
        <TextWidget text={i18n.t("habits:card.score")} style={{ fontSize: 9, color: muted(theme), marginBottom: 6 }} allowFontScaling={false} />
      </FlexWidget>
      <SvgWidget svg={spark(view.scores, accent(habit, theme))} style={{ width: "match_parent", height: 38 }} />
    </FlexWidget>
  );
}

/** 2x2: the current streak, with the best under it. */
function Streak({ view, theme }: { view: HabitWidgetView; theme: Theme }) {
  const { habit, stats } = view;
  return (
    <FlexWidget style={shell(theme)} {...openHabit(habit)}>
      <TextWidget text={`${habitIcon(habit)} ${habit.name}`} maxLines={2} truncate="END" style={{ fontSize: 13, fontWeight: "600", color: fg(theme) }} allowFontScaling={false} />
      <TextWidget text={String(stats.current)} style={{ fontSize: 40, fontWeight: "bold", color: accent(habit, theme), textAlign: "center" }} allowFontScaling={false} />
      <FlexWidget style={{ alignItems: "center", width: "match_parent" }}>
        <TextWidget text={streakText(habit, stats.current)} style={{ fontSize: 11, color: muted(theme) }} allowFontScaling={false} />
        <TextWidget text={`${i18n.t("habits:detail.best")}: ${stats.best > 0 ? streakText(habit, stats.best) : "—"}`} style={{ fontSize: 9, color: muted(theme) }} allowFontScaling={false} />
      </FlexWidget>
    </FlexWidget>
  );
}

/** The weeks the days span, Monday first, as a column of seven days each. */
function weeksOf(days: HabitWidgetView["days"]): string[][] {
  const first = days[0]?.day ?? "";
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
  const monday = addDays(first, -((dow + 6) % 7));
  const weeks: string[][] = [];
  for (let start = monday; start <= (days[days.length - 1]?.day ?? first); start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

/** 4x3: the last ten weeks, a column per week, Monday at the top. */
function History({ view, theme }: { view: HabitWidgetView; theme: Theme }) {
  const { habit, days } = view;
  const byDay = new Map(days.map((d) => [d.day, d.state]));
  const shown = weeksOf(days).slice(-10);
  return (
    <FlexWidget style={shell(theme)} {...openHabit(habit)}>
      <TextWidget text={`${habitIcon(habit)} ${habit.name}`} maxLines={1} truncate="END" style={{ fontSize: 13, fontWeight: "600", color: fg(theme) }} allowFontScaling={false} />
      <FlexWidget style={{ flexDirection: "row", justifyContent: "space-between", width: "match_parent", flex: 1 }}>
        {shown.map((week) => (
          <FlexWidget key={week[0]} style={{ flexDirection: "column", flexGap: 2 }}>
            {week.map((day) => {
              const state = byDay.get(day)?.state ?? "empty";
              const done = state === "done";
              return <FlexWidget key={day} style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: done ? accent(habit, theme) : state === "skip" ? muted(theme) : state === "no" ? chip(theme) : pal(theme)["card-hover"] }} />;
            })}
          </FlexWidget>
        ))}
      </FlexWidget>
      <TextWidget text={i18n.t("habits:detail.history")} style={{ fontSize: 9, color: muted(theme) }} allowFontScaling={false} />
    </FlexWidget>
  );
}

/** 4x4: today's habits with a tappable tick each (numeric habits open their screen). */
function Today({ view, theme }: { view: TodayView; theme: Theme }) {
  const shown = view.cards.slice(0, 5);
  return (
    <FlexWidget style={shell(theme)} clickAction="OPEN_URI" clickActionData={{ uri: "pulse://habits" }}>
      <FlexWidget style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "match_parent" }}>
        <TextWidget text={i18n.t("habits:widget.today")} style={{ fontSize: 13, fontWeight: "700", color: fg(theme) }} allowFontScaling={false} />
        <TextWidget text={view.total === 0 ? i18n.t("habits:summary.noneToday") : i18n.t("habits:widget.done", { done: view.done, total: view.total })} style={{ fontSize: 10, color: muted(theme) }} allowFontScaling={false} />
      </FlexWidget>
      {shown.length === 0 ? (
        <TextWidget text={i18n.t("habits:summary.noneToday")} style={{ fontSize: 12, color: muted(theme) }} allowFontScaling={false} />
      ) : (
        <FlexWidget style={{ flexDirection: "column", flexGap: 6, width: "match_parent", flex: 1, justifyContent: "center" }}>
          {shown.map(({ habit, stats }) => {
            const done = stats.today.state === "done";
            const numeric = habit.kind === "numeric";
            const off = !stats.scheduled;
            return (
              <FlexWidget key={habit.id} style={{ flexDirection: "row", alignItems: "center", flexGap: 8, width: "match_parent" }}>
                <FlexWidget
                  style={{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: done ? accent(habit, theme) : "#00000000", borderWidth: done ? 0 : 1.5, borderColor: muted(theme) }}
                  {...(numeric ? openHabit(habit) : { clickAction: "toggle", clickActionData: { habitId: habit.id } })}
                >
                  <TextWidget text={off ? "–" : numeric ? String(stats.today.value ?? "") : done ? "✓" : ""} style={{ fontSize: numeric ? 8 : 12, fontWeight: "bold", color: done ? "#ffffff" : muted(theme) }} allowFontScaling={false} />
                </FlexWidget>
                <FlexWidget style={{ flex: 1 }} {...openHabit(habit)}>
                  <TextWidget text={`${habitIcon(habit)} ${habit.name}`} maxLines={1} truncate="END" style={{ fontSize: 12, color: fg(theme) }} allowFontScaling={false} />
                </FlexWidget>
                <TextWidget text={`${Math.round(stats.score * 100)}%`} style={{ fontSize: 10, color: muted(theme) }} allowFontScaling={false} />
              </FlexWidget>
            );
          })}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

/** 1x1: the habit's icon and a tick dot; tap toggles a yes/no day, a numeric habit opens. */
function Dot({ view, theme }: { view: HabitWidgetView; theme: Theme }) {
  const { habit, stats } = view;
  const done = stats.today.state === "done";
  const numeric = habit.kind === "numeric";
  return (
    <FlexWidget
      style={{ width: "match_parent", height: "match_parent", padding: 5, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: done ? accent(habit, theme) : card(theme), borderWidth: done ? 0 : 1, borderColor: chip(theme) }}
      {...(numeric ? openHabit(habit) : { clickAction: "toggle", clickActionData: { habitId: habit.id } })}
      accessibilityLabel={`${habit.name}, ${i18n.t(!stats.scheduled ? "habits:card.weekdays" : done ? "habits:card.doneToday" : "habits:card.notDoneToday")}`}
    >
      <TextWidget text={habitIcon(habit)} style={{ fontSize: 22, textAlign: "center" }} allowFontScaling={false} />
      <TextWidget text={!stats.scheduled ? "–" : done ? "✓" : ""} style={{ fontSize: 11, fontWeight: "bold", color: done ? "#ffffff" : muted(theme), textAlign: "center" }} allowFontScaling={false} />
    </FlexWidget>
  );
}

function Empty({ theme, text }: { theme: Theme; text: string }) {
  return (
    <FlexWidget style={shell(theme)} clickAction="OPEN_URI" clickActionData={{ uri: "pulse://habits" }}>
      <TextWidget text={i18n.t("habits:widget.empty")} style={{ fontSize: 13, fontWeight: "600", color: fg(theme) }} allowFontScaling={false} />
      <TextWidget text={text} maxLines={2} style={{ fontSize: 11, color: muted(theme) }} allowFontScaling={false} />
    </FlexWidget>
  );
}

/** A 1x1 widget with no habit chosen yet. */
function EmptyDot({ theme }: { theme: Theme }) {
  return (
    <FlexWidget style={{ width: "match_parent", height: "match_parent", padding: 5, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: card(theme), borderWidth: 1, borderColor: chip(theme) }} clickAction="OPEN_URI" clickActionData={{ uri: "pulse://habits" }}>
      <TextWidget text="＋" style={{ fontSize: 24, color: muted(theme), textAlign: "center" }} allowFontScaling={false} />
    </FlexWidget>
  );
}

/** The component a widget name draws, in both schemes. */
export function widgetRepresentation(name: string, view: HabitWidgetView | TodayView | null): WidgetRepresentation {
  if (!view)
    return name === "HabitDot"
      ? { light: EmptyDot({ theme: "light" }), dark: EmptyDot({ theme: "dark" }) }
      : { light: Empty({ theme: "light", text: i18n.t("habits:widget.emptyBody") }), dark: Empty({ theme: "dark", text: i18n.t("habits:widget.emptyBody") }) };
  const draw = (theme: Theme) =>
    name === "HabitDot" ? Dot({ view: view as HabitWidgetView, theme }) : name === "HabitCheck" ? Check({ view: view as HabitWidgetView, theme }) : name === "HabitScore" ? Score({ view: view as HabitWidgetView, theme }) : name === "HabitStreak" ? Streak({ view: view as HabitWidgetView, theme }) : name === "HabitHistory" ? History({ view: view as HabitWidgetView, theme }) : Today({ view: view as TodayView, theme });
  return { light: draw("light"), dark: draw("dark") };
}
