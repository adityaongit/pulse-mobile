# Live workout recorder

Start a workout from Home: **Start activity** on the Today's Activities card, or the first entry in My Day's **+** menu. The screens follow WHOOP's activity flow; `whoop-ui.md` has the spec and `reference/` the screenshots it was read from. `/workout-live` (the notification, Strain, More and onboarding link there) opens the running workout, else the start screen. Recorded workouts show among the day's activities and open `/workout/[id]`, where they can be deleted. The earlier Strain Coach screen is removed: the live dial now shows the day's Strain against its target.

## Recording

Choose Walking, Running, Cycling, Strength, HIIT or Other workout. Enable heart-rate sharing on a compatible BLE Heart Rate Service sensor, connect it in Pulse, and start. Fitbit Air sharing is enabled through Google Health; actual device compatibility still requires a physical-phone check.

Pulse displays a circular heart-rate indicator, zone, active duration and estimated session cardio load. Pause ends the sampling segment; resume/reconnect begins a new one. Missing readings, pauses, disconnected periods and interrupted-process time do not add estimated load. Finish saves the session, average/max heart rate, observed coverage, zone time and HR chart.

Cardio load reuses the existing TRIMP kernel. It is a **Pulse estimate** and can differ from Fitbit's value. Calibration requires a recent recorded resting HR, valid maximum HR and supported profile settings. Missing calibration leaves load unavailable while HR recording remains usable. Demo/default baselines are not substituted for calibration.

## Native capture and storage

The local Expo module `modules/pulse-workouts` owns an Android `connectedDevice` foreground service, its GATT connection, monotonic clock and recording wake lock. Leaving the tab or locking the screen does not transfer capture ownership to React. The display-only BLE controller yields its connection during capture without changing its remembered auto-connect preference.

The service writes an app-private append-only journal. Five-second checkpoints flush accepted samples and publish a committed byte cursor. `Store.workouts` drains committed samples into the separate `pulse-workouts.db`; metadata, samples and cursor commit together. Replayed sequence IDs are idempotent. Native code never writes SQLite directly. The existing health import/reimport lifecycle does not erase personal workouts.

Process interruption recovers the last committed capture as **Interrupted** and requires an explicit resume or finish. The final uncommitted checkpoint can be lost in process/power failure. No continuous HR trace or downtime is fabricated. Full reset uses a persistent reset marker and refuses to reset while a workout is active.

## Ongoing notification

Start/resume requests notification access and checks that the **Workout recording** channel is enabled. When blocked, Pulse explains the requirement and offers system settings; Pause and Finish remain available.

One ongoing notification shows the activity, the live bpm, the active elapsed time and the zone bar, with Pause/Resume and Finish. It is public, so the card shows on the lock screen as WHOOP's does; the owner can hide it under Android's lock-screen notification settings. The chronometer continues while recording or waiting for the sensor, freezes while paused, and is removed by Finish. Tapping it returns to the live screen.

## Scope and validation

Capture and storage are local to this installation; no account, Drive integration or GPS/pace recording is added. The band shares only heart rate over Bluetooth, so the live screen shows heart rate, Strain, zones and calories, and nothing from the phone's own sensors. Steps, distance and pace come from the band's records in Health Connect: the activity page shows them for the workout's window once Google Health has synced them. On Finish, Pulse writes the workout's exercise session (type, start, end, title) to Health Connect with the `WRITE_EXERCISE` permission it asks for at Start; Google Health reads it from there. The next sync imports it like any other workout, so its page is the regular activity page, scored by the pipeline from the heart rate the band writes; the recorded copy stays only as the live trace. Deleting the workout deletes the session from Health Connect too. Without the permission the workout stays on the phone. The scoring kernels remain unchanged. New copy is in the English `workouts` namespace and uses the existing English fallback for other languages.

Automated coverage includes observed-time/load gaps, session parsing and persistence, replay idempotency, native journal recovery, and notification state/actions. Native tests require Java 21 for Robolectric's Android API 36 runtime. Android sources under `android/` are generated through Expo prebuild; the native module is maintained under `modules/`.

Emulator fixtures and screenshots use synthetic readings. The recorder has also been exercised for pause/resume, screen-lock clock advancement, interruption recovery, notification permission denial, navigation between tabs, and finish/save. Physical-phone acceptance remains necessary for:

- First connection and incoming live HR from Fitbit Air or another BLE heart-rate peripheral.
- Locked-screen capture, reconnect after sensor loss/another app, and observed coverage in the saved trace.
- OEM battery restrictions, long-session power use, large fonts and TalkBack.

The PR records validation for its isolated branch and includes real Android emulator captures with sample data.
