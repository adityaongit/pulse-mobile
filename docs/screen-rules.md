# Screen rules (Phase 2 and after)

Every screen stream follows these. A stream brief adds its own scope on top.

## Look: exactly the Pulse PWA

- Each screen is the web page ported line for line: `src/app/(app)/<route>/page.tsx` in the pulse repo and the
  components it uses. Same layout, order, copy, spacing, tokens, colours, states and reason codes. Copy is final: never
  reword it.
- Build only from the kit (`src/ui`): shells, metrics, charts, `Text`, `Card`, `Button`, `Icon`. No platform-default
  visuals: no Material components, no system headers or tab bars, no new visual ideas. If React Native cannot reproduce
  something the web does, say so in the report with the exact difference; do not invent a substitute.
- Native only in behaviour: the native stack's push and swipe-back, sheets as routes (`src/ui/shells/sheets.ts`), the
  centred info card (`InfoButton`).
- Haptics, always through `src/ui/haptics.ts` (its header lists where each kind fires). The kit already fires them for
  `Button` (primary and sheet buttons), tabs, segmented controls, day changes, chart scrubbing and pull to refresh. A
  screen adds: `haptic.tap()` on a custom action control, `haptic.success()` after a save (DoneScreen does it),
  `haptic.error()` when a save fails, `haptic.warning()` when a destructive confirm appears, `haptic.toggle(on)` on a
  switch. Never on a row or link that only navigates.
- Every metric renders its five states through `MetricState` with the reason codes of `src/lib/reasons.ts`.
- The web's `loading.tsx` skeleton for a route is what the screen shows while its data loads.

## Data

- Routes are files under `app/`. Tab roots are `app/(tabs)/index.tsx` (Home), `health.tsx`, `journal.tsx`, `more.tsx`;
  every other screen is a route outside the group (for example `app/sleep.tsx`, `app/activity/[id].tsx`), so it pushes
  over the tabs with the native transition.
- A screen loads its view model with `useScreen((ctx) => getX(ctx, ...), [deps])` (`src/screens/useScreen.ts`). Never
  call the database or a repository from a component.
- Queries are `src/queries/<name>.ts`, ported from pulse `src/server/queries/<name>.ts`: identical logic, reads through
  `ctx.store` repositories and the shared helpers in `src/queries/common.ts`. View-model types are `src/queries/types.ts`
  (a copy of pulse's). Mappers and info copy shared by screens are in `src/screens/_lib/`.
- The web's Server Actions become functions in `src/actions/<name>.ts` taking the `Store` (`src/data/store.ts`), with
  pulse's zod validation; after a write they call `dataChanged()` so every mounted screen reloads.
- The day parameter is the route param `d` (the web's `?d=`), read with `useLocalSearchParams` and resolved with
  `parseDay` from `src/lib/url.ts` against `todayOf(ctx)`.
- One person per install: no user ids, no demo mode, no admin. Google is reached only through `src/google/*`.

## Tests

- Port pulse's test for each query file onto `seededCtx()` (`src/queries/testing.ts`: the F2 seed scored on SQLite, at
  F6's time zone, profile and `now`).
- Where F6 has cases for a query (Home, Sleep, Recovery, Strain, Metric detail), `expectF6(query, day, vm, key?)` must
  pass for every F6 day. F6 was recorded in pulse's demo mode: a field that differs only because the phone has no demo
  mode is reported with its exact values, never patched to match.

## Performance

The app must stay at the frame rate of the phone. On every screen:

- Render maps view models to props and nothing more. Heavy shaping (arrays of hundreds of points) happens once, in the
  query or under `useMemo`, never on every render.
- Long lists (more than about 30 rows) use `FlatList`, not a `.map` inside a `ScrollView`.
- Animation runs on the UI thread (Reanimated shared values, Skia), never a `setState` per frame.
- Charts get arrays prepared once; do not rebuild them per render or per gesture.
- No timers or polling, except the live heart-rate screen (one pull every 60 s, stopped when the screen loses focus,
  with `useFocusEffect`).
- Screens never run sync or the pipeline; the background stream owns that.
- Smoothness is judged on a release build: development mode and Expo Go are slower by design.

## Shared files

Do not edit: `src/ui/**`, `src/queries/common.ts`, `src/queries/types.ts`, `src/queries/testing.ts`,
`src/screens/_lib/**`, `src/screens/useScreen.ts`, `src/data/**`, `src/pipeline/**`, `src/google/**`, `src/core/**`,
`src/lib/**`, `src/profile.ts`, `app/(tabs)/_layout.tsx`, `package.json`. Put the exact change you need and why in your
report. The one exception: a stream that adds a sheet route adds its `<Stack.Screen name="(sheets)/<name>" ...>` line
to `app/_layout.tsx` and nothing else there.
