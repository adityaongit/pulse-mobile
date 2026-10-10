# Screens check

What the owner compares against the Pulse web app, screen by screen, on a phone (nobody can see a phone during the build). Open the same day in both apps and compare. Each stream owns its own section.

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
