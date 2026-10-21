# AGENTS.md

Guide for coding agents (and humans) working on Pulse Mobile: an Android app (Expo) where every byte lives on the phone. It reads the owner's Fitbit data from **Health Connect**, keeps it in SQLite, and turns it into recovery, strain, sleep, Pulse Age, stress, Energy Bank and journal insights. There is no server, no account and no Google sign-in: one install is one person.

The engine (Health Connect source, storage, scoring, view models) comes from **halo**, a fork of the same pulse app, at `~/personal/halo`. halo is the reference for engine code: read it beside every change to `src/health`, `src/data`, `src/core`, `src/pipeline` and `src/queries`, and do things the way it does. The UI is Pulse's own and keeps the look of the pulse PWA. The move and its phases are in `docs/rewrite-plan.md`.

## Expo has changed: do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json` (SDK 57 today, React Native 0.86).
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt, an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need. Never answer from memory.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm start` | Dev server (`expo start`) |
| `pnpm android` | `expo run:android`: build and run a development build on an emulator or a device (needs Android Studio) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest in Node (`src/**/*.test.ts`, `scripts/**/*.test.ts`) |
| `npx expo install <pkg>` | Add a dependency. Always use this instead of `pnpm add` for anything native: it picks the version that matches the SDK |
| `npx expo install --fix` | Fix package versions that do not match the SDK |
| `npx expo-doctor` | Diagnose dependency and config issues |
| `npx expo export --platform android --output-dir <tmp dir>` | Bundle check: Metro builds the Android bundle. Use a directory outside the repo and delete it after |
| `npx eas-cli@latest build --profile development` | Cloud development build (profiles in `eas.json`: `development`, `preview`, `production`) |

Run `pnpm typecheck && pnpm lint && pnpm test` before every commit. Run the bundle check when you change `babel.config.js`, `metro.config.js`, `app.json`, or add a dependency.

## Layout

```
app/          Expo Router routes: one file per screen, _layout.tsx files are navigators. Routes live in the root app/, not in src/.
src/
  health/     Health Connect: permissions, record → row mapping, sync, source policy, data check (halo)
  data/       the Store interface, the async expo-sqlite store, the in-memory store for tests, the demo seed (halo)
  core/       pure TypeScript: engine/ (the Pulse engine, from the reference study: every score the screens show), scoring and algorithms (halo's, kept for the extras listed in docs/engine-plan.md Phase 7)
  pipeline/   stage 1 and stage 2: imported rows to stored scores (halo)
  queries/    view models (halo), plus Pulse-only extras the screens need (trendView, homeExtras, mobileExtras, journalExtras, shell)
  lib/        time, yield (time slicing), format, bands, reasons, url and the UI catalogues
  state/      app.ts: boot, status, the sync run, the data version, the query and action contexts
  background/ runSync.ts (the shared sync + scoring run) and lock.ts; the background task comes later
  actions/    writes: journal, log, dashboard, profile, preferences, export, calendar
  screens/    the screens, built from src/ui; useScreen.ts is the view-model cache
  ui/         tokens, shells, kit, charts
  dev/        development screens (kit); the routes in app/dev/ load them in development builds only
plugins/      config plugins (withHighRefreshRate)
scripts/      release tooling
docs/         rewrite-plan.md, plan.md, design/spec.md, learning.md, onboarding.md, runbooks
```

## Rules

- **Health Connect only, Android only.** No Google sign-in, no network source, no iOS config. The app asks for Health Connect read permissions only and never writes to Health Connect.
- **No auth.** No accounts, no login screen, no user ids.
- **Owner's own name and photo are fine.** The rule against storing a Google account's email, name or picture is about Google accounts. A display name and photo the owner types or picks (Settings › Profile) stay in the profile, the photo as a file in the app's document directory; neither leaves the phone.
- **Only `src/data` touches SQLite.** Everything else goes through the `Store` interface (`src/data/store.ts`). Tests use the in-memory store (`src/data/memory.ts`).
- **No I/O in `src/core`.** Pure TypeScript only: no database, no network, no clock reads, no React.
- **The reference study is the reference for `src/core/engine`.** The Pulse engine's kernels follow the study at `~/personal/pulse/docs/research/bevel/` (start at `pulse-gaps.md`), with the fixes in `docs/engine-plan.md`. Code, comments, copy, commits and docs call it the Pulse engine and never name the app the study describes; comments cite it as "reference study, `<doc>.md` § `<section>`".
- **halo is the reference elsewhere.** Engine code outside `src/core/engine` (`src/health`, `src/data`, `src/pipeline`, `src/queries`, the old `src/core/scoring` and `src/core/algorithms`) follows halo. Copy its code and its way of doing things; it is the same pulse code under the same license and copyright owner. Pulse-only additions live in their own files (the `*Extras.ts` queries) so the copies stay comparable.
- **No secrets in logs.** Never log health-record bodies or keys. Secrets (the coach key, later) live only in `expo-secure-store`.
- **Honest states.** Every nullable metric is `{ value, reason, provisional }`, using the reason codes in `src/lib/reasons.ts`. Never show a fabricated number. Where a source has no data for a card, hide the card or show its reason; never invent a value.
- **Scales.** Strain is a percent: 0 to 100 on most days, up to about 129; rings fill at 100 and labels show the real value. Recovery is 1 to 100, Stress and the Sleep Score 0 to 100, Energy Bank 1 to 100. Halo's Effort (0 to 100) still feeds halo's extras only. Recovery's `sleepPerf` is on [0, 1].
- **Causality.** A day's scores depend only on that day and earlier days. Baselines fold from earlier nights only. Never let a later night change history.
- **Scoring version.** A change to what the pipeline stores bumps `SCORING_VERSION` (`src/pipeline/types.ts`), which rescores the history. A change to the import mapping bumps `IMPORT_VERSION` (`src/health/sync.ts`), which re-imports the history window.
- **Long loops yield.** The import and the pipeline await `slice()` (`src/lib/yield.ts`) in long loops so taps and frames get through.
- **UI.** The look is the pulse PWA's. Build from the shells and kit in `src/ui`, using NativeWind classes and the tokens. Spec decisions and deviations live in `docs/design/spec.md`. A screen that needs a changed view-model field adapts its code, not its look.
- **Copy.** User-facing text goes through i18n keys (docs/i18n.md); no literal copy in components. It says Pulse, Pulse Age and Health Connect. Where the reference study and WHOOP (noop, `~/personal/noop`) name the same feature differently, the screens use WHOOP's name: Sleep Performance (the study's Sleep Score), Sleep Debt (Sleep Bank), Sleep Need (Sleep Needed), Strain Target (Target Strain), Training Load (Cardio Load), Stress Monitor (Stress). Biological Age is Pulse Age; Energy Bank keeps its name (WHOOP has none).
- **Shared files.** The `Store` interface, the UI tokens and the kit's exports change only in the orchestrating session, between waves. A stream that needs a change asks for it in its report.
- **No native edits.** `android/` is generated (Continuous Native Generation) and git-ignored. Never create or edit it by hand. Configure native behavior in `app.json` and config plugins.
- **Development builds.** Health Connect is a native module, so the app needs a development build (`pnpm android` or `npx eas-cli@latest build --profile development`), not Expo Go.
- **Prefer Expo modules** over third-party libraries. Docs: https://docs.expo.dev/versions/latest/index.md

## Git

- Use the `git` CLI only, never `gh`.
- Commit as `adityaongit`, email `74150665+adityaongit@users.noreply.github.com`. Check `git config user.email` before committing.
- Conventional commit messages, signed off (`git commit -s`).
- Once typecheck, lint, test and the bundle check pass and the change has been tried on the phone, fast-forward `origin/main`. Never force-push.

## Testing

- Vitest runs in Node. Store, pipeline, health and query tests run on the in-memory store (`MemoryStore`), most over halo's 180-day demo seed (`seedDemo`) scored by `runPipeline`.
- Algorithms get golden-value or property tests beside the file. Queries and actions get tests on the in-memory store.
- No local e2e and no device automation. The owner checks on a phone. CI is the gate.

## Docs

- Explanations, runbooks and guides are markdown in `docs/`. Use mermaid flowcharts for flows and architecture.
- Keep `docs/learning.md` current: when you make an Expo or React Native choice, add one short section.
- `docs/onboarding.md` describes the first run; `docs/rewrite-plan.md` the move to Health Connect and halo's engine.
