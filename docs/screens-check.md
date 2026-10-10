# Screens check

What the owner compares against the web app, screen by screen. One section per stream; each stream edits only its own.

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
| Check-in sheet (round button, or Check in / Edit check-in) | Full screen with the sand glow. Header: Journal, pencil and X. "<  TODAY  >" and the pill day strip; the heading ("What's happening today, October 8?"); Daytime, Nighttime, Status and Your behaviours sections, each question on its card with the grey X and check keys (X lights white, check lights blue); a Yes on Alcohol, Caffeine or Electrolytes opens its follow-up slider ("--" until moved). Notes; Save journal. | Add a behaviour (the field and its Add button above the keyboard); Notes (the box grows, stays above the keyboard) |
| Check-in: save and close | Save journal shows the Saved screen for 1.6 s, then closes; the Journal card turns to "Checked in" and the strip day gets its badge. X, swipe down and Android Back ask "Dismiss journal?" when answers changed (the X always asks until the box is ticked); "No, complete journal" returns. A day change with unsaved answers asks the same. | |
| Log water | Add +250 ml / +500 ml (saves at once), "Today: n ml", Other amount, Time; Save. | Amount: numeric keypad |
| Log food | Meal chips, Name, Calories, Protein / Carbs / Fat, Time. | Name: text keyboard; Calories: numeric; macros: decimal |
| Log weight | Weight and Body fat (optional), Time. | decimal keypad on both |
| Log mood / symptoms / ovulation | Overall and Feelings chips; Symptoms chips (cycle ones only on a female profile); Result chips; Time. | none |
| Log period (female profile) | First day and Last day (date pickers), flow chips. | none |
| Time fields | iOS: the system compact date-time picker in the field. Android: tap the field for the date dialog, then the time dialog. Nothing later than now. | system picker |
| Not connected | Every log sheet shows "Connect Google to log to Google Health." and a Connect Google button (it opens Settings). Deleting an entry that Google holds shows "Reconnect Google in Settings to delete it there." as a toast. | none |
| Entry sheet (tap a row in Logged today) | Title and caption (meal, day and time), the value (food: four tiles), Logged in, In Google Health, Delete entry (red) then Keep / Delete with the caption of where it is deleted; a weigh-in shows both values and "Delete weigh-in". | none |
| Toasts | After a log save and a delete: a card at the foot, about 4 s (inside the sheet when it stays open). | none |

Differences you will see, on purpose (React Native cannot do the web's version):

- The check-in header keeps the X at the right beside the pencil and the title sits 22 px left of centre; the web has the X at the left. The kit places a header `action` where the X would be.
- The check-in heading wraps at 285 px (the web's `16ch`); there is no `ch` unit.
- Date and time fields use the system pickers (see docs/learning.md), so they look like each platform's, not like a browser's.
- "Don't show me this message again" and the folded sections are remembered until the app is closed, not across launches (they need a settings key).
- A toast is drawn by the screen that shows it (Journal and the log sheets), not by one app-wide host.
