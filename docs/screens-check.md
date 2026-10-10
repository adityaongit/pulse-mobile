# Checking the screens on your phone

One section per screen stream. Put the phone next to the Pulse web app (the same install's data cannot be shown on both,
so compare against the web app's demo or your own account in light and dark at about 390 px) and go through the list.

## Every screen: the header

At rest, the first line of content sits below the header's soft fade, not under it, on every screen (the web's sticky header
takes its 24 px fade in layout): the Home wordmark, a detail screen's first card, a tab's first section. Scroll a little and
content slides under the fade. Check Home, Health, Journal, More and a detail screen such as Recovery.

## Every screen: no white flash

Push a detail screen, go back, switch tabs and open a sheet, in dark mode first: the ground behind the moving screen is the
app's own (dark in dark mode, the light grey in light mode), never white. A cold start still shows the splash first.

## Recovery, Strain and Activities

Routes: `/recovery`, `/strain`, `/activities`, `/activity/<id>`. Open them from Home's rings and activity rows, or in Expo
Go with `exp://<your computer's LAN IP>:8081/--/recovery` (and `/strain`, `/activities`). Each takes `?d=YYYY-MM-DD` for a
day (the date label in the header changes it).

```mermaid
flowchart LR
  H[Home] --> R[/recovery]
  H --> S[/strain]
  H --> A[/activities]
  S --> AC["/activity/id"]
  A --> AC
  AC -->|menu| S
```

### Known gap to expect

The coach pill on an activity is not shown: the coach reads as not set up, so the templated insight card shows, as the web
does with no coach key. Weekly Trends closes Recovery (five cards) and Strain (six): one card per metric over the seven
days ending on the day shown, that day's column highlighted, each card a link (chevron) to its Trend View on W.

### Recovery

- Header: the date as the title with a small "i"; the ring is large with the percentage, the band word and any tags
  (provisional, stale baseline) as on the web.
- A notched card under the ring: Heart rate variability, Resting heart rate, Respiratory rate, Sleep performance. Each
  row: the value, the 30-day average under it, a coloured arrow, a chevron that opens the Trend view. The strip under the
  rows reads "Today vs. last 30 days" with the green up and orange down arrows.
- The insight card (one sentence naming the input that moved the score most) with "Explore your recovery insights".
- "Behavior insights": a lightbulb card with chips (green up, orange down, grey), shown only when yesterday had behaviours.
- With no score (no sleep yet, too few nights): the ring shows the reason, the rows show their reasons, no insight card.
- While loading: the shell with grey bars at the final size, no layout jump when data arrives.

### Strain

- Ring with the 0 to 21 scale, the Strain Target arc and the "so far" tag on today.
- Card rows: Strain Target (a range like "12.0 - 15.0", its own "i", an "estimate" tag while the target is a cold start),
  Heart rate zones 1-3, Heart rate zones 4-5, Strength activity time, Steps, Distance, Floors, Active minutes, Active Zone
  Minutes, Active calories. Values right-aligned in one column down the card. "Today vs. prior 30 days" strip.
- The coach line card ("Your target today is ..." or the rest or past-target copy) with "Explore your strain insights".
- "Heart rate" card: the day's line, workouts shaded, dashed "now" line today; scrub with a finger.
- "Time in zones": zone rows with minutes and share, the "Zones on your heart-rate reserve ..." note under them.
- "Activities": the day's workouts as timeline rows (strain chip, name, distance and pace, times), each opens the activity;
  "No activities on this day." when none.

### Activities

- "Last 30 days" summary card: count, time, average strain (blue).
- A sport filter row (All, Runs, Rides, Walks, Strength, Workouts) only when more than one sport exists; the chosen pill is
  filled. It scrolls sideways.
- Day groups newest first: day label, "steps, Day strain" line on the right, the workouts in one inset card. Today is
  always first; with nothing yet it reads "No activities yet today. Workouts appear after Fitbit syncs them."
- "Show older" adds 30 days; "No older activities" at the end. Empty state when there are no workouts in the month.

### Activity

- Header: back arrow, the sport icon, the sport name and "Today 07:12 to 08:01" under it, a round "..." button. The "..."
  opens a small panel under it: "Strain for this day" and "Heart-rate settings" (the settings screen opens when its
  stream lands). A tap outside closes it.
- Hero: Activity strain in blue with a grey chip showing this kind's 30-day average, and Activity steps for runs and walks.
- Heart rate chart for the workout window and the zone rows (with "View heart-rate settings" under them; runs show the
  typical band per zone once there are three earlier workouts of that kind).
- "Key statistics": tiles scroll sideways, the next one peeking at the edge, snapping tile by tile: Calories, Average heart
  rate, Max heart rate, Duration, then Distance and Pace for runs and walks, Distance for rides.
- "Heart rate recovery": the drop in the first minute with Good, Typical or Low, and the one-line explanation.
- The templated insight card under everything ("You spent N minutes in zones ...").
- With the band off: one "Band not worn" notice replaces the chart, the zones and the empty tiles.
- An unknown id shows "This activity isn’t available." (the web shows its 404 page).

## Home and Sleep

```mermaid
flowchart LR
  Home["Home (tab)"] -->|dial, Sleep card| Sleep["/sleep"]
  Home -->|nap row| Nap["/sleep/nap/[id]"]
  Home -->|"+" key| Plus["Sheet: Add to today"]
  Plus -->|Complete your journal| Checkin["Sheet: Check in"]
  Home -->|CUSTOMIZE| Dash["Sheet (screen): Customize dashboard"]
  Home -->|Tonight's sleep arrow| Sleep
```

### Home (`/`, the first tab)

| Compare | Pass when |
|---|---|
| Top | Wordmark, then three equal dials (Sleep, Recovery, Strain), 24 px under them the Health Monitor and Stress Monitor cards side by side, then the coach card, then the alert if any. No day strip (the web has none: spec C4). |
| Header | Pill and calendar change the day (the screen shows its skeleton while the day loads, as the web's `loading.tsx`). Once the dials scroll under the header, the ring row appears. It appears once the dials (their labels included) have scrolled under the header, as on the web; the note under the dials does not count. No streak and no sync status yet (other streams). |
| No band data | Dials show their reasons; one line "No band data yet" with an (i) opens the web's two-paragraph card; the phone's own tiles (steps, distance, calories, active minutes) replace the monitor cards. |
| Coach card | One card: the check pill shows 1. Several: a second card peeks under; tapping the pill cycles with a quick fade and nothing below moves. |
| My Day | Section title with the white "+" key at the right; the outlook or review banner (tap: centred info card); Today's activities (the expand icon opens All activities), sleep and nap rows, "Add activity" opens the info card "Add an activity"; Tonight's sleep (today only; the arrow opens Sleep scrolled to its Tonight's sleep card); My journal (seven circles, check badge on done days; Behaviour insights); Energy Bank. |
| Tonight's sleep | Bedtime and typical wake in the big numerals joined by a dashed rule; the Peak / Perform / Get by toggle changes the bedtime; "Need tonight". Times shrink on a narrow phone (32, 26, 22 px). |
| My Dashboard | One card per chosen metric, in order; the Stress tile has the day's line; Strain & recovery chart under them (hidden with fewer than two scored days); CUSTOMIZE with the pencil. |
| Bottom | "Your week in review" banner with the date range. |
| "+" sheet | A sheet titled "Add to today" (or "Add to Mon., Sep. 28") with Add activity and Complete your journal. The web draws a dropdown under the key, and the key turns into an X: not here. |
| Customize dashboard | Full-screen sheet. Drag a row by the three-line handle: it follows the finger, the others slide, the page must not scroll under the drag. Minus removes. Tap a row in "Add to My Dashboard" to add it at the end; search filters by name and group; "No data yet" marks empty metrics. Save shows "Success" and Home shows the new order; Save is off with no metrics. A failed save shows its message above the button (the web: a toast). |

### Sleep (`/sleep`)

| Compare | Pass when |
|---|---|
| Header and hero | The date is the header title (calendar paints Sleep colours); the large dial with the status bar under its label. |
| Summary card | Three rows (Hours vs. needed, Sleep consistency, Sleep efficiency) with status bars, then the Poor / Sufficient / Optimal legend; the notch points at the dial. |
| Insight card | The sentence, then "Explore your sleep insights" opens the Sleep trend. |
| Last night's sleep | The kit's stages card: hours, heart rate over the night, Breakdown / Timeline. |
| Hours vs. needed | Percentage and arrow, the hours bar fading in, the need bar built from three parts, the legend (Healthy Minimum, Recent Strain, Sleep Debt, Naps). First week: the "settles after 7 nights" line. |
| Sleep consistency | Five bars between 21:00 and 13:00 (axis in 4-hour steps), last night in blue with its bed and wake times, the two dashed lines of the usual times easing between nights. The lines are drawn in pixels once measured: check they run edge to edge with no gap at the sides. |
| Sleep efficiency | Asleep bar cut where you woke, awake bar on the hatched track with the same marks, Wake events. |
| Tonight's sleep | Four rows (Peak, Perform, Get by, Typical wake) with times; "Need tonight". |
| Missing | No Sleep Stress card (off on the web too). Weekly Trends closes the page: seven cards (Sleep Performance, Hours vs. Needed in hours and in %, Restorative Sleep, Sleep Consistency, Time in Bed, Sleep Efficiency). Home's Tonight's sleep arrow opens Sleep with the Tonight's sleep card at the top of the screen, as the web's `/sleep#planner` (not checked on a device: if it stays at the top, say so). |

### Nap (`/sleep/nap/[id]`)

From a nap row on Home: title Nap, subtitle "Today 14:10 to 14:50", back goes to that day's Sleep; one card with the time asleep, the heart rate and the stages if Fitbit staged it (otherwise the kit's "no stage data" line). The loading state is the web's activity skeleton, as the web.

One section per screen stream. Open each route on the phone, put the Pulse web app beside it (`pnpm dev` in the pulse repository, a browser at about 390 px wide, seeded or your own data), and compare what is listed. "Same" means the same copy, numbers, colours, order and rough spacing; a few pixels of text metrics differ between React Native and a browser.

## Trends, metrics and reports

Routes: `/trends`, `/trend/<key>` (for example `/trend/hrv`), `/metric/<key>` (for example `/metric/steps`), `/reports`, `/reports/<period>` (`/reports/2026-W39`, `/reports/2026-09`). Deep link with `pulse://trends` and so on, or tap through More, a Details link, a Trend view link or a metric row.

```mermaid
flowchart LR
  More --> Trends["/trends"]
  Trends -->|Details| Metric["/metric/[key]"]
  Trends -->|metric row| Sheet["sheet: Metric"]
  Sheet -->|a choice| Trends
  Recovery["Recovery, Sleep, Strain"] --> TrendView["/trend/[key]"]
  More --> Reports["/reports"]
  Reports --> Report["/reports/[period]"]
```

### /trends

| Compare | What to look for |
|---|---|
| Picker row | Section name over the metric name, up-down chevrons; a tap opens the "Metric" sheet: five sections with their counts, the current one open, its metrics as chips, the current chip filled. A choice closes the sheet and switches, keeping the range. Check the sheet's height when you open another section (it should grow or shrink to fit). |
| Chart card | Title is the metric, "Details" link at the top right. Four-way toggle W / M / 6M / 1Y spans the card above the average; the average, the change chip ("vs. prior month"), bars (W, M) or a line (6M, 1Y), Strain, Steps and Stress leave today empty. |
| Range | Pick 1Y, then change metric: the range stays. Go Back and the range is as you left it. |
| Averages card | Four rows "Last 7 days" to "Last 12 months", each "vs. the 7 days before" etc., the prior average under the value and a toned arrow. |
| States | A metric with no data in the year (for example Glucose): the "no data" placeholder; Recovery while calibrating: nights left. Loading shows the real picker and labels with bars for values. |

### /trend/\<key\>

| Compare | What to look for |
|---|---|
| Metric menu | Full-width card with the metric's icon, caps name and chevron; a tap drops a panel under it with the screen's other metrics, a check on the current one. A choice keeps the range and day. |
| Headline | "Average" (or "Weekly total") label, 34 px value, the change chip; at the right the W / M / 6M toggle (three equal 56 px segments) and the period stepper `‹ Mar 17 - Apr 15, 26 ›`: previous greys out before the first synced day, next greys out on the latest period. |
| Verdict and chart | One sentence in 17 px, then the legend (Typical range, stack swatches or rings), then the chart. Check each kind: Recovery bars (band colours), HRV line with the shaded typical range, Hours of Sleep pair of lines with day labels in W, Restorative stack, Time in Bed bed-to-wake bars with clock labels, HR Zones weekly stacks. 6M: faint daily line under one level segment per month with its value and change. M bars: dashed average line with the "AVG." pill at the left. |
| Below | Footnote with the info glyph, "Add activity" (opens the info card) on zones and strength, the breakdown bar with counts, and the "What is …?" card. |

### /metric/\<key\>

Compare Steps (hourly view, 7,000-step days, weekday pattern), Calories (stack, workouts), Weight (latest reading label, 7-day line, readings), Active minutes (this week meter and 12 weeks), Water or Calories eaten (entries, macros), Heart rate average (shaded range, unusual days) and a metric with no data ever.

| Compare | What to look for |
|---|---|
| Header | The date switcher under the title; stepping days reloads the screen. |
| Hero | 64 px value, "So far" tag on today's running total, the chip against the 30-day average (hidden on a running total), the caption "30-day average …". |
| History card | Toggle W / M / 6M / 1Y; change it and the "Last 30 days" card under it changes its title and numbers at once. Today's running total is a gap. |
| Stats card | Daily average with the prior average, Total (summable metrics), Highest and Lowest with their dates, "Days with data" as "28 of 30". |
| Sections | By kind as the web; the hourly card sits directly under the hero; "About …" last. |

### /reports and /reports/\<period\>

| Compare | What to look for |
|---|---|
| Archive | Weekly / Monthly switch, weeks grouped by month ("SEPTEMBER 2026"), the last three months until "Show earlier weeks", a Recovery ring and value on each row, "Partial week" under the current one; Monthly groups by year. Empty state when nothing is scored. |
| Report | Period pill with stepper (next greyed on the latest), Week / Month toggle, "Partial week" tag, three dials with their "+4 vs. last week" captions, the insight card, Recovery breakdown, Averages with "vs. last week", Training balance, Top journal effects, Best and worst day (a tap opens Home on that day). A period with no data shows "No data for this week." and the "Latest week" button. |

### Known differences from the web (React Native)

- The metric picker is a bottom sheet only; the web's 768 px popover is a laptop layout.
- The charts draw in Skia and do not animate in; the web's bars and lines animate on first show.
- On Trends and metric screens the range toggle is drawn by the screen above the kit's chart, not inside it (same place and look), so the Averages card can follow it.
- "Show earlier weeks" lists every week at once inside the page's scroll view (the shell has no list mode).

## Health

Open the web app at 390 px wide, light and dark, and the app side by side.

### Health tab (`/health`, `app/(tabs)/health.tsx`)
- Card order and spacing: Stress Monitor, the orb with Pace of Aging, Health Monitor, Fitness, Heart rate, then the footnote.
- Stress Monitor: "Today's high stress" value and chip beside the small stress line (line colours follow the stress levels).
- The orb (260 px, no card around it): colour for the years younger or older, the number, "Pulse Age", the delta line. On load the particles gather in over about a second; press and hold pulls them in and swirls them; scrolling the page still works while a finger is on it. Compare how smooth it feels on a release build (see "Orb" below).
- Pace of Aging card: the chip (Slower, Faster, No change), the ruler with Slow and Fast ends, GO TO HEALTHSPAN.
- Health Monitor: five icons with a check, warning or `--`, and the "n/5 within range" bar.
- Fitness: VO2 max, category colour, percentile, Training load and its chip. Heart rate: the newest reading and "x minutes ago" (the dot pulses when it is under 5 minutes old).
- The loading skeleton shows for a moment on a cold start and matches the final layout.

### Health Monitor (`/health/monitor`)
- The "n/5" hero with its chip, the date switcher steps days, the illness alert (red ring) appears only when the web shows it.
- Five vital tiles (two per row, the last across both) with the sparkline and the range chip; each opens its metric screen on the same day.
- Heart rhythm: with no readings, the one quiet row; with readings, the latest ECG card, earlier rows, the irregular rhythm count and the disclaimer. A reading opens the ECG sheet (bottom sheet: value, chip, date, explanation, disclaimer).
- Measurements card: weight and body fat rows with the 30-day comparison.

### Stress Monitor (`/health/stress`)
- The gauge and its caption ("Last updated hh:mm" or "Day average"), the insight card, the day chart (scrub with a finger), Total day (bars, per-level times, "typical" row), 30-day trend.
- The info buttons open the same copy as the web.

### Fitness (`/health/fitness`)
- VO2 max hero, Percentile ruler with the five category names under it, the VO2 max trend (opens on 6M), Training load with its ruler and sentence.
- Fitness, fatigue and form chart: Fitness line and area (blue), Fatigue line (amber), Form bars (green, amber when negative), month labels, scrub tooltip, legend with today's values.

### Healthspan (`/health/healthspan`)
- The 300 px orb on the flat dark ground, "Your age: n", the week switcher, "Next update in n days" under the title.
- Scroll: the orb shrinks into the header with "Years younger" or "Years older" on the left and "Pace of aging" on the right.
- Pace of Aging card, insight, Pulse Age history with the "Your age" line, then Sleep, Strain and Fitness cards. Tapping a factor opens it in place (target, evidence, source, VIEW TREND); `?contributor=` is not linked anywhere yet.

### Heart rate (`/health/heart-rate`)
- The big reading with its three stats (Range, Average, Resting; a past day has no Average), the day chart (scrub), Time in zones with its note.
- Live updates are a stub: the screen runs its 60 s timer while focused on today but the pull (`src/screens/health/live.ts`) says "not connected", so nothing changes until Google connect is built. Leaving the screen must stop the timer.

### Orb
- Compare the entry, the idle drift, the press and swirl, and the collapsed mini orb. Check dark and light. Particle density is the web's (about 2,600 at 300 px); if the Healthspan screen drops frames on a release build, lower `particles.at320` in `src/screens/health/orb.ts`.
- The text blur in the web's entry has no counterpart: the text fades up without it.

Each stream adds a section: what to compare against the web app, per route.

## Settings, More and onboarding

Open the web app beside the phone (`pnpm dev` in the pulse repo, devtools at 390 px). Compare light and dark. The phone has no accounts, so the web's Account card, Delete account, Sign out, photo, password, admin and Google email do not exist here: that is expected.

```mermaid
flowchart TD
  A[Fresh install or Delete everything] --> B[/onboarding/]
  B -->|Save and continue| C[Home]
  C --> D[More tab]
  D --> E[Account & settings rows] --> F[/settings?s=profile, source, app/]
  D --> G[/more/behaviours/] & H[/more/data/] & I[/more/how-it-works/] --> J[/more/how-it-works/score/]
```

| Route | Compare |
|---|---|
| Fresh install | Clear the app's data (or Settings > Profile > Delete everything, twice). The app opens on **onboarding**, not Home, with no tab bar. Android back does not leave onboarding for Home. After Save and continue it lands on Home, and the Journal's nine default behaviours exist. |
| `/onboarding` | Wordmark at the top; "Two things Google doesn’t share"; birth date field opens three wheels (month, day, year) with Done; sex segmented control; the time zone as one line with Change (it opens the searchable list, offsets like GMT+5:30); "Save and continue". Empty birth date or sex shows the red field messages. Check the time zone list opens without a visible hitch the first time (it builds about 420 zones once). |
| More tab | Rows and captions as the web: Account & settings (Profile, Data source, App), Reports (latest week and month captions, All reports), Trends, Journal ("n of m shown"), Help ("n scores"), Your data, About card. Reports, Trends and Journal rows open other streams' screens. |
| `/settings?s=profile` | Profile card rows (birth date, age, sex, height, max HR with set/estimated, time zone), Edit opens the profile sheet (all five fields), saving shows the toast and the rows change. Delete everything sits below, quiet and red; two confirmations; then the app restarts into onboarding. |
| `/settings?s=source` | Not connected: status line, body copy, Connect Google (shows "Connecting Google isn’t available in this build yet."; the connect step is not built). With a stored grant (not testable until connect exists): Sync now + Disconnect, Switch Google account, the Data types fold (opens itself when something fails or is behind), import progress, "Pulse needs new permissions". No email under the name. |
| `/settings?s=app` | Appearance: System, Light, Dark with icons; the choice applies at once and survives a restart. App card: two switches (Recovery ready, Pulse can’t sync); they are stored, nothing is scheduled yet. |
| `/more/behaviours` | Intro; search; category tabs (the web fades the tab row at the right edge, the phone does not); Selected / Not selected groups; ticking keeps a row in place; "Save behaviours" appears above the round button once something changed; "Your own" adds a behaviour (32 characters, duplicate and limit messages). |
| `/more/data` | Cards Daily scores and Journal with counts, CSV and JSON buttons open the system share sheet with `pulse-daily-<today>.csv` etc.; open a CSV and check the columns against the web's export. The Coach card shows only after a saved chat. Caption about tokens and keys. |
| `/more/how-it-works` and `/score` | One row per score with its summary; each explainer has the summary, "Open {score}" (to a screen another stream builds), four cards, short details beside their terms, Previous / Next replacing the screen. |
| Back and sheets | Swipe-back (iOS) and the back gesture (Android) on every pushed screen above; the profile sheet drags down to close. |

## Journal and Log

Run in Expo Go on Android and in the development build on an iPhone, in light and dark. Open the web app (`/journal`) beside the phone. The Google connect step does not exist yet, so every log sheet opens on "Connect Google to log to Google Health." and a log write cannot succeed: that is the expected state until the connect step lands.

| Where | Compare with the web | Keyboard |
|---|---|---|
| Journal tab (`/journal`) | Header with the date pill; the 30-day strip with a check badge per day; sections in order: Log, Check-in, Logged today, Insights, This week, History. Each section title folds on tap. Tap a strip day, a History row or the pill to change the day: every section follows it. While loading, the skeleton of the web's `loading.tsx`. | none |
| Log tiles | Water, Food, Weight, Mood, Symptoms (Period and Ovulation only on a female profile): 96 px cards, icon and plus, the day's figure and the name; the row scrolls edge to edge and snaps. Tap opens that log sheet. | none |
| Check-in card | "Log what you did today. Pulse compares it with tomorrow's Recovery." and Check in; once done, the green "Checked in" chip, the day's behaviours as pills, Edit check-in. | none |
| Logged today | Water, Food (macro bar, meals), Body, Mood and symptoms, Cycle (female only): the plus on each group, entry rows with the app and the time, empty lines. An entry row opens the entry sheet. | none |
| This week | Two column charts, Water and Food, the day highlighted, "avg ..." beside each title; drag across one for the tooltip. | none |
| History | Rows with the day, up to two behaviour pills and "+N", the selected day marked at the left edge; Show 30 days / Show last week; the empty state "No check-ins yet. ..." with Check in. | none |
| Insights teaser and `/journal/insights` | The coach-style card with the strongest effect; See all. The Insights page: Recovery / HRV / Sleep toggle (the URL param `m`), the ranked bars, "Keep logging to unlock" with progress bars, the footnote. Tap a row: the behaviour sheet (`/journal/impact`): the big signed figure, Days with / without, 90% confidence, averages. | none |
| Check-in sheet (round button, or Check in / Edit check-in) | Full screen with the sand glow. Header: the X at the left, Journal in the middle, the pencil at the right (as the web). "<  TODAY  >" and the pill day strip; the heading ("What's happening today, October 8?"); Daytime, Nighttime, Status and Your behaviours sections, each question on its card with the grey X and check keys (X lights white, check lights blue); a Yes on Alcohol, Caffeine or Electrolytes opens its follow-up slider ("--" until moved). Notes; Save journal. | Add a behaviour (the field and its Add button above the keyboard); Notes (the box grows, stays above the keyboard) |
| Check-in: save and close | Save journal shows the Saved screen for 1.6 s, then closes; the Journal card turns to "Checked in" and the strip day gets its badge. X, swipe down and Android Back ask "Dismiss journal?" when answers changed (the X always asks until the box is ticked); "No, complete journal" returns. A day change with unsaved answers asks the same. | |
| Log water | Add +250 ml / +500 ml (saves at once), "Today: n ml", Other amount, Time; Save. | Amount: numeric keypad |
| Log food | Meal chips, Name, Calories, Protein / Carbs / Fat, Time. | Name: text keyboard; Calories: numeric; macros: decimal |
| Log weight | Weight and Body fat (optional), Time. | decimal keypad on both |
| Log mood / symptoms / ovulation | Overall and Feelings chips; Symptoms chips (cycle ones only on a female profile); Result chips; Time. | none |
| Log period (female profile) | First day and Last day (date pickers), flow chips. | none |
| Time fields | iOS: the system compact date-time picker in the field. Android: tap the field for the date dialog, then the time dialog. Nothing later than now. Expo Go: the picker is `@expo/ui/community/datetime-picker`, the drop-in for `@react-native-community/datetimepicker`; Expo's SDK 57 docs list it as included in Expo Go on Android and iOS (docs.expo.dev/versions/v57.0.0/sdk/ui/drop-in-replacements/datetimepicker), so these fields work in Expo Go without a development build. | system picker |
| Not connected | Every log sheet shows "Connect Google to log to Google Health." and a Connect Google button (it opens Settings). Deleting an entry that Google holds shows "Reconnect Google in Settings to delete it there." as a toast. | none |
| Entry sheet (tap a row in Logged today) | Title and caption (meal, day and time), the value (food: four tiles), Logged in, In Google Health, Delete entry (red) then Keep / Delete with the caption of where it is deleted; a weigh-in shows both values and "Delete weigh-in". | none |
| Toasts | After a log save and a delete: one card at the foot of the screen under the sheet, as Sonner's (popover fill, border, 16 px icon, 13 px text), about 4 s, a new one replacing the last. The Settings and More toasts are the same card. | none |

Differences you will see, on purpose (React Native cannot do the web's version):

- The check-in heading wraps at 285 px (the web's `16ch`); there is no `ch` unit.
- Date and time fields use the system pickers (see docs/learning.md), so they look like each platform's, not like a browser's.
- "Don't show me this message again" and the folded sections are remembered until the app is closed, not across launches (they need a settings key).
- Sonner stacks several toasts; here one shows at a time. A toast is drawn under a sheet that is still open, so every toast in the app comes after its sheet closes.
