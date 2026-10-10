# Handoff: Pulse Mobile, end of the 2026-10-11 session

Paste this into a new Claude Code session started in `~/personal/pulse-mobile`, then say what to do first. It holds
the state, the rules, the open problems with what is known about each, and the next steps.

## 1. What this is

`pulse-mobile` is the React Native (Expo SDK 57, React Native 0.86, Expo Router) version of the Pulse web app, where
every byte lives on the phone: Google Health data pulled by the phone, SQLite, Pulse's own scoring, the same screens,
no server and no accounts. The plan is `docs/plan.md`. The web app is `~/personal/pulse` (its `main` is the
reference for every port; a read-only checkout lives at `~/personal/worktrees/pulse/reference`).

## 2. Where things stand

| Phase | State |
|---|---|
| 0 Scaffold, contracts, parity fixtures | merged to `main` (PR #1) |
| 1 Data layer, pipeline, Google client and sync, UI kit | merged to `main` (PR #2) |
| 2 Screens (six streams), native pass, integration | on branch **`phase-2`**, pushed, **not merged**: 51 commits ahead of `main` |
| 3 Coach, background, release | **parked by the owner**; do not start it |

On `phase-2`: typecheck, lint and `pnpm test` are green (99 test files, 984 tests); both platforms bundle. F6 view
models match pulse on every recorded day for Home, Sleep, Recovery, Strain and Metric detail (24 cases); F3 and F4
score hashes match on the SQLite repositories. **Nothing on `phase-2` is verified on a phone beyond what the owner
looked at on 2026-10-11** (see section 5).

Pulse repo: branch `feat/export-mobile-fixtures` (the fixture export script) is pushed and its PR is not merged.

## 3. Rules (owner's; they override defaults)

- **Git:** `git` CLI only, never `gh`. Identity `adityaongit`, email `74150665+adityaongit@users.noreply.github.com`
  (set locally in this repo). Conventional commits, signed off (`git commit -s`). Never push to `main`; each phase lands
  as a pull request the owner merges. Docs go in markdown files in the repo, never Artifacts.
- **Report before changing:** after an investigation, report the measured cause and a numbered list of proposed changes,
  then wait for the owner's go. An unannounced edit was rejected before.
- **Measure before fixing:** no guess-patch loops. State a hypothesis with the measurement that confirms it; ship only
  the confirmed fix; revert a failed attempt before the next.
- **The UI looks exactly like the Pulse PWA, on both platforms.** Native only in behaviour (native stack transitions,
  swipe-back, form-sheet drag, haptics, real blur). Never platform-default visuals: native tabs and Material were tried
  and rejected. Port the web component line for line; when React Native cannot do something, say exactly what differs.
- **No auth:** no accounts, login, user ids, or identity scopes (`openid`, `email`, `profile`). Google is only "connect
  your Google Health data".
- **Haptics everywhere they mean something** (`src/ui/haptics.ts` lists the vocabulary). No sounds unless the owner says.
- **Pull-to-refresh stays** (owner, 2026-10-11).
- **Phone only:** `app.json` `platforms` is iOS and Android; the web target was removed on purpose.
- **No local e2e and no device automation.** When something must be seen on a phone, tell the owner exactly what to run
  and what to look at. The owner runs the iOS Simulator and an Android phone with Expo Go.
- **Agents:** the orchestrator (you) fans work out to subagents in their own git worktrees under
  `~/personal/worktrees/pulse-mobile/`, Sonnet by default, Opus for parity-critical ports, Haiku for mechanical checks.
  Show the owner the agent table before a wave. Briefs stand alone and forbid spawning agents, background processes and
  widening scope. Shared files (`src/ui/**`, `src/data/schema.ts`, repository interfaces, `src/queries/common.ts`,
  `app/_layout.tsx`) change only in the orchestrator's hands, between waves. When merging, resolve each conflicted file
  by reading it; a merge on 2026-10-11 was committed with conflict markers because a shell loop did not split the file
  list, so never automate conflict resolution without checking for markers file by file.

## 4. Commands

| Command | What it does |
|---|---|
| `pnpm start` | Dev server (development build mode; `--go` for Expo Go) |
| `npx expo start --go` then `i` | Expo Go in the iOS Simulator (the CLI installs the right Expo Go) |
| `pnpm ios` / `pnpm android` | Build and run a development build locally (Xcode / Android Studio) |
| `pnpm typecheck && pnpm lint && pnpm test` | Before every commit |
| `npx expo export --platform android --platform ios --output-dir <tmp>` | Bundle check, temp dir outside the repo |
| `scripts/sync-core.sh ~/personal/worktrees/pulse/reference` | Re-copy `src/core`, the synced `src/lib` files and `time.ts` from pulse; a clean `git status` means no drift |

On the phone: More, Development, **Load demo data** (`app/dev/demo.tsx`) fills 180 days ending now and scores them,
with timings per phase. `/dev/parity` runs the F3 score check under Hermes; `/dev/time` the F5 time check; `/dev/kit`
the UI kit. `docs/screens-check.md` lists what to compare per screen.

## 5. Open problems, most important first

1. **Home and detail headers do not behave like the PWA on a phone.** Owner: "too much height", "I doubt fixing these
   small issues is making you write patch fixes". Measured: the header heights now equal the web's (inset + 44 row +
   24 fade; collapsed adds the 40 px ring row or the 62 px detail row). The real difference: the web on a phone runs a
   **scroll-linked morph** (pulse `src/components/shells/HomeHeader.tsx` around lines 200-300, `morphKeyframes`, and
   `CollapsingHeader.tsx` for detail screens): the dials shrink into the ring row as the page scrolls, so no gap opens.
   The kit ported only the web's fallback (the discrete swap used on laptops and with reduced motion). **Do this as a
   proper port, not a patch:** port the morph with Reanimated (scroll-driven interpolation on the UI thread), Home and
   detail headers, keeping the discrete swap for reduced motion as the web does. Then compare side by side with the real
   PWA (method in section 6) before calling it done.
2. **Audit of other components (owner asked, 2026-10-11), findings only, nothing changed yet:**
   - *Animated layout properties* (the cause of the see-through header): none left. The dashboard editor's drag uses a
     transform and the Pulse Age contributor list uses Reanimated layout transitions, both on the UI thread.
   - *Web phone behaviour replaced by a simpler fallback:* only the Home header (item 1). The web's detail headers use a
     discrete collapse, as the port does.
   - *Press feedback is instant everywhere:* the web eases scale and colour over 150 ms when a control is pressed
     (`transition-[scale,background-color]` with its standard easing on ScoreDial, KeyStatRow, DayStrip, ActivityCard,
     SleepStages, DriverList, the primitives, buttons). The port uses NativeWind `active:` classes, which jump with no
     easing: 65 places in 45 files (`grep -rn "active:scale\|active:bg" src app`). Proposed fix: one kit pressable that
     animates scale and background colour with Reanimated using the web's duration and easing, swapped in for every
     `active:` press state.
   - *Charts do not animate in* (web bars and lines draw in on load; noted by the trends stream).
   - *Deviations each stream reported* (each needs the side-by-side check before changing): Home's plus menu is a sheet,
     not the web's dropdown, and its key does not turn into an X; the activity and trend menus are `Modal` panels; the
     Behaviours tabs have no right-edge fade; the orb's entry has no blur; the Healthspan accordion fades instead of
     clipping height; skeleton rings use a border inside the box where the web's ring sits outside (4 px); "x minutes
     ago" does not tick; the check-in remembers "don't show again" and folded sections only until the app closes.
   The other 60-odd web files with motion (sheets, dialogs, calendar, toasts, page enter, tabs, switch) are not yet
   compared; do that in the side-by-side pass.
3. **Visual parity overall is unverified.** The six screen streams ported from the web code without seeing either app.
   Run the side-by-side method in section 6 over every route, light and dark, and list differences before fixing any.
4. **Missing in the headers:** the web's sync status ("Now" with the band icon, right of the date pill) and the streak
   flame next to the avatar. Port pulse's `SyncStatus` and `Streak` (in `src/components/shells/TopBar.tsx` and
   `HomeHeader.tsx`) into the kit and wire them to `src/queries/settings.ts` (`getShellStatus`, `getWearStreak`).
5. **Fixed on 2026-10-11, needs the owner's eyes:** content under the header on every page (cause: the web's header
   takes its 24 px fade in the layout, the port did not; fixed in `ScreenScroll`), the see-through collapsed row (cause:
   the fill grew by animating height around an SVG and the grown part was never painted; now fixed-height fill plus an
   opacity band, `src/ui/shells/Header.tsx`), the white flash on navigation (navigation theme and root colour), the
   onboarding "VirtualizedLists nested" errors, the Skia path deprecation warnings (the orb). If a Skia warning still
   shows, trace which component's path parsing triggers it.
6. **Performance on the phone is unmeasured.** The pipeline now yields every 8 ms (`breathe()` in
   `src/pipeline/data.ts`); in Node a 180-day recompute went from one 1.7 s block to a longest block of about 28 ms.
   Load demo data on the phone and read the timings; judge smoothness on a release build, not Expo Go.
7. **Google connect is not built.** Google no longer allows custom URI schemes for Android OAuth clients, so the plan's
   browser redirect cannot work on Android. Recommended: Google's Android `AuthorizationClient` (silent fresh tokens,
   no secret, no server). The owner asked how Baro does it; Baro documents only that it has no server and calls Google
   from the phone. Everything waits on this: real data, log writes, live heart rate, Settings' Connect and Sync now.
   Stubs: `src/google/token.ts` (`TokenSource`), `src/screens/settings/connect.ts`, `src/screens/health/live.ts`,
   `tokenSource()` in `src/actions/log.ts`. The owner still has to create the OAuth clients (`docs/google-console.md`)
   and send the client ids.
8. **Smaller known items:** the `/dev` routes ship their fixtures (bundle about 16 MB) and must be stripped from release
   builds; two copied pulse tests are excluded (they import pulse server code); pulse's core still uses `localeCompare`
   in `reports.ts` and `journalImpact.ts` (same order on the fixtures, may differ on Hermes; fix in pulse first); the
   orb's frame rate (about 2,600 particles) is unmeasured.

## 6. How to check visual parity (do this before fixing visuals)

1. Run the web app with demo data: in `~/personal/pulse`, `docker compose -f compose.dev.yaml up -d`, then
   `DATA_SOURCE=demo pnpm dev` (see pulse `AGENTS.md`).
2. Capture each route at 390 px wide, light and dark, with the browser tools (chrome-devtools MCP: `emulate` a phone,
   `take_screenshot`), including the scrolled states (header collapsed).
3. Ask the owner for the same screens from the Simulator after **Load demo data**, or use their screenshots.
4. List every difference with both measurements, then propose fixes and wait for the go.

## 7. Map of the code

- `app/`: routes. Tabs in `app/(tabs)/`, sheets in `app/(sheets)/` (registered in `app/_layout.tsx`, which also holds the
  profile gate and the navigation theme), dev screens in `app/dev/`.
- `src/ui/`: the kit (shells, metrics, Skia charts, `Toast`, `Button`, `cn` = tailwind-merge, `haptics.ts`, tokens in
  `global.css` and `palette.ts`).
- `src/screens/`: screen components per area; `useScreen.ts` loads a view model and reloads on `dataChanged()`.
- `src/queries/`: view-model queries ported from pulse; `testing.ts` is the seeded test database (F2 scored, F6 context).
- `src/actions/`: writes (profile, journal, log, dashboard, export, reset), each followed by `dataChanged()`.
- `src/pipeline/`: scoring, F3 and F4 parity tests (also on SQLite).
- `src/data/`: schema, migrations, repositories (`Store`, `transaction`), sample BLOB encoding.
- `src/google/`: client, mappers, sync, log writes (no token source yet).
- `src/seed/`: pulse's demo generator and `loadDemoData`.
- `src/core`, synced `src/lib` files, `src/time.ts`: byte copies of pulse, changed only through `scripts/sync-core.sh`.
- Docs: `docs/plan.md`, `docs/screen-rules.md` (rules every screen follows), `docs/screens-check.md`,
  `docs/kit-check.md`, `docs/learning.md` (React Native notes for the owner), `docs/google-console.md`,
  `docs/hermes-parity-check.md`, `docs/hermes-time-check.md`.

## 8. Suggested first steps for the next session

1. Read this file, `docs/plan.md`, `docs/screen-rules.md` and `AGENTS.md`.
2. Ask the owner to reload and confirm item 5's fixes, and whether `phase-2` should be merged as is or after item 1.
3. Run the side-by-side parity check (section 6) for Home and one detail screen; report the differences.
4. Propose the scroll-linked header morph port (item 1) and the kit pressable (item 2) with the web lines they mirror;
   on the owner's go, build them, then the header sync status and streak (item 4).
