# Live workout recorder

Open **Workout** in the bottom bar to start a session or browse saved workouts. Existing `/workout-live` links open the tab after onboarding; the standalone recorder remains available from onboarding. The previous live Strain coach and its summaries remain available under **Open Strain coach**.

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

One ongoing, private notification shows state, active elapsed time, Pause/Resume and Finish. The chronometer continues while recording or waiting for the sensor, freezes while paused, and is removed by Finish. Tapping it returns to Workout. Health readings are not included in notification text. Android notification settings and dismissal remain under the owner's control.

## Scope and validation

All capture and storage are local to this installation. No account, Drive integration, GPS/pace recording or Health Connect write permission is added. Workouts do not feed daily scoring, avoiding duplicate load when Health Connect imports overlapping sessions. The scoring kernels remain unchanged. New copy is in the English `workouts` namespace and uses the existing English fallback for other languages.

Automated coverage includes observed-time/load gaps, session parsing and persistence, replay idempotency, native journal recovery, and notification state/actions. Native tests require Java 21 for Robolectric's Android API 36 runtime. Android sources under `android/` are generated through Expo prebuild; the native module is maintained under `modules/`.

Emulator fixtures and screenshots use synthetic readings. The recorder has also been exercised for pause/resume, screen-lock clock advancement, interruption recovery, notification permission denial, navigation between tabs, and finish/save. Physical-phone acceptance remains necessary for:

- First connection and incoming live HR from Fitbit Air or another BLE heart-rate peripheral.
- Locked-screen capture, reconnect after sensor loss/another app, and observed coverage in the saved trace.
- OEM battery restrictions, long-session power use, large fonts and TalkBack.

The PR records validation for its isolated branch and includes real Android emulator captures with sample data.
