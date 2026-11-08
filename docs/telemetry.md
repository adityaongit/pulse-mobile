# Telemetry

Pulse sends short error reports to Sentry so failures that users hit become visible: crashes, and also the quieter
failures where Pulse runs fine but shows less than Health Connect holds (a night's HRV that never reaches Recovery, a
type that is granted but always empty). Health data never leaves the phone. Reports are **on by default** and
**Settings › App › Privacy › Send error reports** turns them off at once.

The code is `src/lib/telemetry.ts`; the data-gap checks are `src/health/dataGaps.ts`.

```mermaid
flowchart LR
  Crash[JS or native crash] --> Scrub
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

## What is never sent

- Health data: no values, no records, no dates of readings, no scores.
- Names, emails, the profile, photos, the journal.
- URLs, hosts, query strings, API keys, model ids or prompts. The AI Coach talks to providers whose URLs can hold the
  key (Gemini's `?key=`), so URLs are cut to their path and key-like strings are redacted.
- Breadcrumbs (console lines, network requests, taps), screenshots, the view hierarchy, session replays, traces.

`scrubEvent` builds every outgoing event from an allowlist rather than deleting known fields, so a field Sentry adds
later is dropped by default. Messages go through `scrubText`: URLs keep only their path, key-like strings become
`[redacted]` and every number becomes `#`. Native Android crashes are captured by the native SDK, which keeps its own
breadcrumbs off (`maxBreadcrumbs: 0`); their messages come from Pulse's Kotlin modules, which throw short codes.

## Volume

Sentry's free tier allows 5,000 errors a month. A coded report with the same tags is sent at most **once per install,
app version and local day**; the sent set lives in AsyncStorage (`pulse.telemetry.sent`). Crashes are not deduplicated.
The data-gap checks run at most once a day, after a successful sync.

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

## Configuration

| Variable | Where | What |
|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | `eas.json`, `preview` and `production` | Where reports go. Public by design: it ships in every APK. Without it, nothing initialises, so development builds send nothing. |
| `SENTRY_ORG`, `SENTRY_PROJECT` | `eas.json`, same profiles | `pulse-fit` and `pulse-mobile`, for the source-map upload |
| `SENTRY_AUTH_TOKEN` | The shell running `eas build --local`, or an EAS secret | Uploads source maps so crash stacks show source lines. Secret: never commit it. Without it the build skips the upload (`plugins/withSentryUpload.js`). |

To create the token: Sentry › Settings › Organization `pulse-fit` › Organization Tokens › Create New Token (scope
`org:ci`). Keep it outside every repository, readable only by you, in `~/.config/pulse-mobile/sentry.env` (mode 600)
as `export SENTRY_AUTH_TOKEN=…`; the build commands in `docs/releases.md` source that file. For cloud builds, also run
`npx eas-cli@latest env:create --name SENTRY_AUTH_TOKEN --value … --visibility secret`.

## Turning it off

The switch writes `pulse.telemetry = "off"`, stops `beforeSend` from passing anything still in flight, and closes the
SDK, which drops its queue. Pulse does not start Sentry on later launches while the switch is off.
