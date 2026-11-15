# Habits

Pulse's habit tracker (`/habits`), in the Journal's old place. It is modelled on Loop Habit Tracker
([iSoron/uhabits](https://github.com/iSoron/uhabits)): a daily list of habits, a strength score per habit, streaks,
a history calendar, and Android home-screen widgets.

## What a habit is

A habit is yes/no (did it or not) or numeric (an amount), with a target per period:

- **Period** `day`, `week` (Monday to Sunday), `month`, or `interval` (every N days, 2 to 365).
- **Weekdays only** a daily habit due Monday to Friday. Weekends are neutral: they cannot be ticked, they do not
  enter the score, and they do not break a streak.
- **Target** a number of times per period for yes/no, an amount per period for numeric. `targetType` is `at_least` or
  `at_most` (numeric only). An interval habit's yes/no target is one per N-day block; its numeric target is the amount
  per block.
- **Entry** one per habit per day: yes/no `1`/`0`, numeric the amount, and `skip` for a day that is not counted. No row
  means unknown.
- **Colour** one of the palette keys, **icon** an emoji derived from the habit's id (stable, no extra column), and
  **archive** to take a habit out of the daily list without deleting its history.

The schema is `habits` and `habit_entries` in `src/data/db.ts`; everything talks to it through the `Store` interface. Like
the gym, habits are the owner's own local data: no health source imports or exports them, and `clearAll` (a source switch)
leaves them. "Delete everything" clears them through `clearHabits()`.

## The score

`src/core/habits/logic.ts` ports Loop's `models/Score.kt`, `ScoreList.kt` and `StreakList.kt`:

- `multiplier = 0.5 ^ (sqrt(frequency) / 13)`, where frequency is `target / daysInPeriod` for yes/no and
  `1 / daysInPeriod` for numeric (the target amount does not change how fast the score moves). An interval habit's
  period is its N days.
- A yes/no habit counts its done days in a window of the period. Weekly and monthly habits double the window and the
  target, as Loop does, so one done day does not jolt a weekly score. Every-N-days habits get the same smoothing.
- A numeric habit sums its amounts in the period window. `at_most` turns the share around: at the limit the share is 0.
- `score = previous * multiplier + share * (1 - multiplier)`. Skips leave the score and the window untouched; so do
  weekends of a weekdays-only habit.
- Completion is the period total against the target. Streaks count consecutive completed periods (days, weeks, months
  or N-day blocks) and ignore the current unfinished period when it is not met yet. A weekday habit's Friday and
  Monday touch.

The score is computed on read: a habit's card and detail need a few hundred days at most, and nothing is stored that a
change to the formula would make stale.

## Screens

- `/habits` — a table of habits: a fixed column of icons and names, then a month of days with today first that
  scrolls sideways. Tapping a day ticks it (yes/no) or opens the amount dialog (numeric); tapping a name opens the
  habit, holding it opens the menu for edit, skip, archive and delete. After the habits come **Food orders** (a month of
  per-day counts from the SMS confirmations), one **Activity** row for the month's workouts (see below) and, when a profile is connected,
  **LeetCode** (a month of submissions). The Activity or LeetCode name opens `/activities` or `/leetcode`; **Scan** beside
  New habit reads new food orders (`docs/food-orders.md`).
- `/habits/[id]` — the large strength ring, current and best streaks, the last 20 weeks as a calendar, the 90-day score
  curve, the question and notes.
- `/habits/edit` — new/edit form: name, question, type, colour, period (daily, weekdays, weekly, monthly or every N
  days), target, unit, at least/at most, notes.

The old Journal is retired from normal navigation: its Home card, the round check-in action, the More group and the
Coach check-in link are gone. The `/journal` route still exists for old links, but nothing links to it.

## Widgets

Five widgets are declared in `app.json` through the `react-native-android-widget` config plugin. Expo SDK 57's
`expo-widgets` is iOS-only, so this app uses the community library, whose widgets are RemoteViews drawn from JS.

| Widget | Size | What it shows | Tap |
|---|---|---|---|
| `HabitDot` | 1×1 | icon and a tick dot | tick toggles a yes/no day in place; numeric opens the habit |
| `HabitCheck` | 2×2 | icon, name, big tick (or amount), score | tick toggles a yes/no day in place; numeric opens the habit |
| `HabitScore` | 4×2 | score, streak, 30-day curve | opens the habit |
| `HabitStreak` | 2×2 | current and best streak | opens the habit |
| `HabitHistory` | 4×3 | ten weeks of days | opens the habit |
| `HabitToday` | 4×3 | today's habits, done/total | each tick toggles; a row opens the habit |

The five per-habit widgets are configurable: adding one opens `src/widgets/config.tsx`, which lists the active habits
and stores `pulse.habitWidget.<widgetId> = <habitId>` in AsyncStorage. Long-pressing a widget reopens that screen.

`src/widgets/task.tsx` is the headless task handler. It opens the same SQLite store, toggles the day for a `toggle`
click, and redraws the widget. `src/widgets/update.ts` redraws every habit widget after a write in the app through the
habit screens' `habitsChanged()` (`src/state/habits.ts`). Android refreshes them at most every 30 minutes on its own
(`updatePeriodMillis`), and a widget redraws when its day changes on the next click or scheduled update.

Add a widget from the Android launcher's widget picker (long-press the home screen → Widgets → Pulse). Deleting a widget
removes its stored habit choice; deleting a habit leaves the widget showing "Choose a habit".

## Tests

`src/core/habits/logic.test.ts` pins the score to Loop's published values (0.655747 after 20 daily ticks, 0.596033 with
three skips), weekly completion, numeric targets and streaks. `src/actions/habits.test.ts` covers the writes, and
`src/data/db.contract.test.ts` runs the SQLite round-trip.

## The Activity row

Every workout Health Connect holds for the month sits in one row, not a row per exercise type. Each day shows a bubble
per kind of workout done that day, in that kind's colour and glyph:

| Kind | Health Connect types | Colour |
|---|---|---|
| Walking | walking, hiking | optimal green |
| Running | running, treadmill | red |
| Cycling | biking, cycling | strain blue |
| Strength | strength training, weightlifting, calisthenics, HIIT | violet |
| Elliptical | elliptical | amber |
| Racket sports | badminton, tennis, squash, padel, table tennis | coach blue |
| Swimming | pool, open water | sleep blue |
| Yoga | yoga, pilates, stretching | yellow |
| Workout | anything else | grey |

One kind fills the cell, two overlap, three make a triangle, and more show "+N". A day with none is a bare ring, today's
in blue. The name cell says how many days this week (Monday on) had a workout. Tapping a day opens its sessions with
start time and length, and a link to all activities.

Folding types into kinds is `activityKind` in `src/queries/habits.ts`; the colours and glyphs are
`src/screens/habits/activity.ts`.

