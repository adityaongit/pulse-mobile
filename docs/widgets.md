# Android home screen widgets

Pulse supports three providers: Small (one metric), Medium (up to three), and Large (up to six, plus a dedicated heart-rate card). Each instance chooses from Recovery, Day Strain, Sleep Performance, Steps, Calories, HRV, Resting Heart Rate and Stress Monitor; Small/Medium also offer Heart Rate as a selectable metric. Existing scoring and Health Connect permissions are unchanged.

## Use

Install a native build containing `modules/pulse-widgets`; an OTA JavaScript update or Expo Go cannot add the native providers. Complete onboarding and sync, then open Settings → App → Home screen widgets. Choose a size and confirm Android's pin request. Alternatively, long-press the home screen and choose Widgets → Pulse. Tap the widget's ⋮ control to choose metrics; supported launchers also offer reconfiguration on long press. Selection is saved separately for every widget. Tap a metric to open its Pulse detail screen.

Launcher grid sizes vary. The target footprints are 2×2, 4×2 and 4×4; providers declare minimum dimensions and can be resized. The widget follows the phone's light/dark appearance. Metric labels, missing-value reasons, number formatting and status labels follow Pulse's selected language after a refresh. The native configuration screen and gallery currently use English fallback strings. Sync timestamps use the phone's clock format.

## Data, freshness and privacy

- Widgets use `getHome` and the same stored recent-heart-rate helper as Home through the existing Store interface, not additional Health Connect reads or a second scoring engine. Foreground and existing background sync publish after scoring; app writes/display-language changes and newly imported foreground heart-rate samples also refresh the projection. When no widget is installed, these hooks skip the Home query; Settings can prepare the first summary before pinning. A first widget added through the gallery may prompt you to open Pulse and sync.
- Only a versioned summary is written to an app-private atomic file in `noBackupFilesDir`. It contains the nine available metrics, labels and freshness metadata, without raw records or profile details. The launcher receives the rendered values: add widgets only where displaying health information is appropriate. No network, new permission, service or wake lock is added.
- Values retain the existing nullable/provisional states. Missing or nonfinite numbers display `--`, with an explanation; genuine zero remains zero. Strain labels retain values above 100%, while the ring caps at 100%.
- The footer shows the original Health Connect sync time, or a stale warning when over three hours old. Sample data is explicitly marked. If the snapshot's local day differs from today in the profile time zone, values are suppressed until Pulse refreshes. Native scheduled redraws re-evaluate this state from the cache, without waking the JavaScript runtime for a health read.
- Android may delay scheduled/background work. The nominal 30-minute widget redraw and existing background sync do not promise exact timing or live readings. Day rollover and stale warnings appear on the next host redraw, sync or app refresh.
- Reset clears the summary and redraws installed widgets as empty; switching between sample data and Health Connect also clears before replacing data. Non-health per-widget metric preferences survive. JavaScript generation checks and a native invalidation epoch captured at sync start prevent a publication already in flight from restoring a cleared summary. Uninstall removes the cache and preferences.
- Revoking Health Connect permission does not remotely erase data that the launcher has already rendered. Opening Pulse with no granted read permissions clears its cached widget summary. Use Pulse's reset or remove the widget to hide previously rendered values immediately.

## Implementation and builds

`src/widgets/model.ts` projects Home into a small bridge payload. `publish.ts` serializes publications, checks source/profile validity, and isolates failures from health sync. `modules/pulse-widgets` is an autolinked local Expo Android module with RemoteViews providers and a native configuration activity. `plugins/withWidgets.js` adds manifest declarations during CNG. Generated `android/` stays ignored. English Android strings derive from `src/i18n/locales/en/widgets.json` via `plugins/widgetResources.js`; the parity test prevents drift.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm exec expo export --platform android --output-dir ../pulse-widget-bundle
pnpm exec expo prebuild --platform android --no-install
./android/gradlew -p android :pulse-widgets:compileDebugKotlin :app:processDebugResources
```

Remove the temporary bundle after checking it. A complete development APK can be built using the repository's existing Android/EAS workflow. An APK signed with another developer's key cannot update the original installation; do not uninstall an existing app just to test a fork without exporting needed data first.

## Owner phone validation still required

No device automation is used, as required by `AGENTS.md`. Before release, check on a physical Android phone:

1. Add all three sizes both from Settings and the launcher gallery; cancel an add, configure, resize, remove and re-add. Confirm no clipping at normal and large system font scales in light/dark modes.
2. Pick different metrics on two instances; confirm selections remain independent after process death, reboot and a native rebuild.
3. Tap every supported metric and confirm the correct detail route. Check missing/calibrating values, valid zero, a strain above 100 and provisional labels.
4. Compare against Pulse Home after manual sync and an allowed background sync. Confirm demo labels, stale timestamps, and day rollover in the profile time zone.
5. Reset while a refresh is pending, restart, switch demo → Health Connect and back, and revoke read permissions. Confirm cleared and previous-day data is not presented as a current reading.
6. Check that no-pin launchers show the manual gallery instructions. Confirm widget updates require neither a new permission nor additional Health Connect access.

Automated test/build results and their limits belong in the change's review notes; passing JavaScript tests or Kotlin compilation alone does not establish launcher behavior or Fitbit hardware compatibility.

## Rendering and stored heart rate

Score dials use Pulse's colored progress rings with white/dark foreground values, rather than horizontal progress bars. RemoteViews ImageViews display bounded native Canvas bitmaps; the native renderer handles widget dimensions and keeps the content together. Other selected metrics use compact cards. Existing metric selections are preserved; newly added widgets default to Sleep, Recovery and Strain in Home order.

Large always includes a dedicated Heart Rate card in addition to its six configurable metrics. Small and Medium can select Heart Rate from the metric picker. The card shows the latest **stored** sample's bpm and actual measurement time/age, plus the 30 minutes ending at that sample. Missing minutes stay gaps; no line is fabricated across them. Future, nonfinite or nonpositive readings display no value. The timestamp is separate from the full-sync footer; an older last-known measurement is explicitly marked. Bluetooth streaming is not exposed as a live background widget feed.

The existing foreground ticker publishes when it imports new heart-rate samples, reusing the Store-backed helper. Background widgets still follow the existing sync/redraw schedule; this adds no new Health Connect read or background service. A summary predating the current profile-local day stays suppressed until refreshed. The summary reader accepts both eight-metric and nine-metric caches; opening Pulse and syncing adds heart-rate data to existing widgets.

Native JVM tests use Robolectric 4.17 with native graphics to inflate/draw the actual RemoteViews layouts, test minimum sizes, light/dark and 130% font scale, check empty/previous-day states, verify the uncapped Strain label, and exercise old-cache/reset invalidation. This is a host-side render, not device or launcher automation. Tests save synthetic previews under the module's ignored `android/build/widget-previews/` directory:

```sh
./android/gradlew -p android :pulse-widgets:testDebugUnitTest
```

For local full release assembly, the SDK's original 512 MiB metadata limit was insufficient for R8/lint. Use command-local memory settings (no generated native edits):

```sh
./android/gradlew -p android :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a -Pexpo.useLegacyPackaging=true \
  '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1536m' --max-workers=2
```

A regression check on Android 11 (API 30) exposed overlap with the sync footer because pre-Android 12 RemoteViews cannot apply the newer explicit height action. Bitmap ImageViews now use intrinsic aspect-ratio measurement (`wrap_content` + `adjustViewBounds`) there. API 30 and API 35 minimum-size renders both pass, with footer-overlap assertions.
