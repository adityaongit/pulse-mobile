# Telemetry

Pulse sends short error reports to Sentry so failures that users hit become visible: crashes, and also the quieter
failures where Pulse runs fine but shows less than Health Connect holds (a night's HRV that never reaches Recovery, a
type that is granted but always empty). A sample of sessions also sends performance traces (how long app start, screens
and each sync step take) and a few coded log lines per sync, so an error arrives with the steps that led to it. Health
data never leaves the phone. Reports are **on by default** and
**Settings › App › Privacy › Send error reports** turns them off at once.

The code is `src/lib/telemetry.ts`; the data-gap checks are `src/health/dataGaps.ts`.

```mermaid
flowchart LR
  Crash[JS crash] --> Scrub
  Native[native crash] --> Switch
  Code["report(code, tags)"] --> Once{first time today<br>for this code, tags, version?}
  Once -->|yes| Scrub[scrubEvent: allowlist]
  Once -->|no| Drop[dropped on the phone]
  Switch{Send error reports on?} -->|off| Closed[Sentry closed, nothing sent]
  Scrub --> Switch
  Switch -->|on| Sentry[(Sentry: pulse-fit / pulse-mobile)]
```

## What is sent

- **The problem:** a stable dotted code (below), or a crash's exception type, message and stack frames.
- **Tags:** enums and small counts only, such as a Health Connect record type, an HTTP status, a provider kind, a
  reason code or a number of days.
- **Context:** Pulse's version and build, the Android version, and the phone's manufacturer and model.
- **Release health:** whether each session ended in a crash, so a release's crash-free rate can be compared with the
  one before.
- **A random install id** as Sentry's user. It identifies an install, not a person, and Delete Everything replaces it.
- **Traces** (1 session in 5): app start, time to first display of each screen by its route name (`metric/[key]`, never
  the parameter), and Pulse's own spans: `sync` with its steps `sync.health_connect`, `pipeline` and `maintenance`
  (`src/lib/perf.ts` `timed()`), each with `owner` (app or task) and `source`.
- **Logs**, only from `log()` in `src/lib/telemetry.ts`: `sync.start`, `sync.read` (how many types were read and how
  many records in all), `sync.done` or `sync.skipped` (duration, warning count, whether anything changed) and
  `sync.error` (a coarse error kind). Console output never becomes a log.

A native crash (Kotlin or Java) is sent by the Android SDK, which does not run the JS `beforeSend`: its exception
message and the native device context go as captured. Pulse's native code logs no health values in exception messages,
but that path is not scrubbed the way JS events are.

## What is never sent

- Health data: no values, no records, no dates of readings, no scores.
- Names, emails, the profile, photos, the journal.
- URLs, hosts, query strings, API keys, model ids or prompts. The AI Coach talks to providers whose URLs can hold the
  key (Gemini's `?key=`), so URLs are cut to their path and key-like strings are redacted.
- Breadcrumbs (console lines, network requests, taps), screenshots, the view hierarchy, session replays, profiles.
- HTTP spans: fetch and XHR are not traced at all, because the coach's request URLs can hold its key.
- Route parameters, query strings and any span or log attribute that is not a number, a boolean, a route name or a
  short enum.

`scrubEvent` builds every outgoing event from an allowlist rather than deleting known fields, so a field Sentry adds
later is dropped by default. Transactions (`scrubTransaction`), spans (`scrubSpan`) and logs (`scrubLog`) go through
the same allowlist: `scrubAttributes` keeps the SDK's own keys (`sentry.*`, frame counts, app start), numbers, booleans,
route names and short enums, and drops anything named like params, a URL, a query, a body or a message. Messages go through `scrubText`: URLs keep only their path, key-like strings become
`[redacted]` and every number becomes `#`. Native Android crashes are captured by the native SDK, which keeps its own
breadcrumbs off (`maxBreadcrumbs: 0`); their messages come from Pulse's Kotlin modules, which throw short codes.

## Volume

Sentry's free tier allows 5,000 errors a month. A coded report with the same tags is sent at most **once per install,
app version and local day**; the sent set lives in AsyncStorage (`pulse.telemetry.sent`). Crashes are not deduplicated.
The data-gap checks run at most once a day, after a successful sync. Traces are sampled (`TRACES_SAMPLE_RATE`, 0.2),
well inside the free tier's 5M spans; logs are a handful per sync, well inside its 5 GB.

## Codes

| Code | Tags | When |
|---|---|---|
| `sync.failed` | `owner`, `kind` | A Health Connect sync threw |
| `sync.type_skipped` | `type` | A record type could not be read this sync |
| `sync.permission_lost` | `read` | Health Connect read permissions are gone at boot |
| `pipeline.failed` | `owner`, `kind` | Scoring threw after a sync |
| `maintenance.failed` | `kind` | Storage upkeep threw |
| `import.mismatch.<metric>` | `days` | Health Connect has `<metric>` on 2 or more of the last days where Pulse stored nothing or a different value (the data check's comparison) |
| `import.empty.<type>` | | A granted core type has no record at all in the last 30 days |
| `state.stuck.<score>` | `reason`, `days` | Recovery, Sleep Performance or Strain has shown the same reason instead of a value for 3 or more days while the band was worn |
| `coach.<problem>` | `provider`, `status` | The AI Coach failed: `provider` is the kind (gemini, openai, anthropic, openai-compatible, custom), `status` the HTTP status or 0 |
| `workout.command_failed` | `code`, `kind` | A workout start, pause, resume or finish failed |
| `workout.storage_failed` | `kind` | The recorder could not read or write its storage |
| `workout.ingest_failed` | `kind` | Recorded samples could not be stored |
| `widgets.publish_failed` | `kind` | The widget summary could not be published |
| `update.check_failed` | `status` | The daily update check got an error from GitHub |
| `render.screen` | | A screen's error boundary caught a render error (sent as a crash) |

Add new codes here when you add a `report` or `reportError` call (AGENTS.md).

## Traces and logs in code

- Wrap a slow async step in `traced("area.step", { enumTag: "x", count: 3 }, () => work())`. Outside a traced session
  it just runs the work. `timed()` in `src/lib/perf.ts` already does this for the sync steps.
- Write a log line with `log("info" | "warn" | "error", "area.event", { count: 3 })`. Logs are not deduplicated, so keep
  them to a few per sync, never one per record.
- Names follow the codes' rules: stable, dotted, no values in them.

## Configuration

| Variable | Where | What |
|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | `eas.json`, `preview` and `production` | Where reports go. Public by design: it ships in every APK. Without it, nothing initialises, so development builds send nothing. |
| `SENTRY_ORG`, `SENTRY_PROJECT` | `eas.json`, same profiles | `pulse-fit` and `pulse-mobile`, for the source-map upload |
| `SENTRY_AUTH_TOKEN` | The shell running `eas build --local`, or an EAS secret | Uploads source maps so crash stacks show source lines. Secret: never commit it. Without it the build skips the upload (`plugins/withSentryUpload.js`). |

To create the token: Sentry › Settings › Organization `pulse-fit` › Organization Tokens › Create New Token (scope
`org:ci`). Keep it in this repository's `.env.local` as `SENTRY_AUTH_TOKEN=…` (git-ignored by `.env*.local`; mode
600), so it exists only for this project. Expo commands run here load it; `eas build --local` copies the tracked
files only, so the build commands in `docs/releases.md` export it first. For cloud builds, also run
`npx eas-cli@latest env:create --name SENTRY_AUTH_TOKEN --value … --visibility secret`.

## Turning it off

The switch writes `pulse.telemetry = "off"`, stops `beforeSend` from passing anything still in flight, and closes the
SDK, which drops its queue. Pulse does not start Sentry on later launches while the switch is off.

## Shake to report

With error reports on, shaking the phone opens **Report a problem** (`app/report.tsx`, `src/screens/report`), with a
haptic. More › About › Report a bug opens the same page (it used to open GitHub issues). A switch under Settings › App ›
Privacy turns the shake off (`pulse.shake = "off"`). With error reports off, Send says where to turn them on.

```mermaid
flowchart LR
  A[Accelerometer 20 Hz<br/>app in front, reports on, shake on] --> B{3/4 of readings past 1.33 g<br/>over 0.5 s?}
  B -- no --> A
  B -- yes --> C{onboarding, report page<br/>or a workout recording?}
  C -- yes --> A
  C -- no --> D[Report a problem]
  D -- Send --> E[sendFeedback: Sentry feedback]
```

- The detector (`src/lib/shake.ts`) follows Square's Seismic: at least 4 readings in the last half second, three
  quarters of them past 1.33 g. A shake keeps that up; a step's spike does not. It is pure and tested. The listener (`ShakeToReport.tsx`) runs only while the app is in
  front and both switches are on, so no sensor runs in the background. It ignores shakes during onboarding, on the
  report page and while a workout records, where running shakes the phone.
- What goes: the words the person typed (up to 4,000 characters), the route they shook on as the `screen` tag, the
  install id and the device, OS and app context. Feedback events skip `beforeSend`, but the native device-context
  integration still fills them (battery, memory, storage, locale, kernel), so a global-scope event processor
  (`scrubFeedback`, tested) puts them through `scrubEvent`'s allowlist and keeps only the feedback. Nothing else is
  attached: no screenshot (the screens show health data), no breadcrumbs, no logs.
- The accelerometer is `expo-sensors`. Its manifest asks for `ACTIVITY_RECOGNITION` (for its pedometer), which Pulse
  does not use, so `app.json` blocks it. On Android 12+ it reads only 5 times a second unless the app declares
  `HIGH_SAMPLING_RATE_SENSORS` (an install-time permission, no prompt); too slow to catch a shake, so `app.json` declares
  it and the listener asks for 20 Hz.
- Sentry's own shake option (`enableShakeToReport`) needs SDK 8; Expo SDK 57 pins 7.11, so Pulse detects the shake.
