# Handoff: Pulse Mobile after the Health Connect rewrite (2026-10-11, evening)

Start a new Claude Code session in `~/personal/pulse-mobile`, paste this file, and say what to do first. `main` is at
`aa2963c`; the branch `feat/health-connect` is the same commit.

## What changed in this session

The owner decided:
- the app reads **Health Connect only**;
- it is **Android only**;
- the code no longer has to match the pulse web app;
- the one bar is that **the UI looks like the PWA**.

halo is the reference for engine code. It is a fork of pulse at `~/personal/halo`, read-only, and copying from it is
allowed.

Everything below is on `main`, tried on the owner's phone (OnePlus CPH2691, Android 16):

| Area | State |
|---|---|
| Engine | halo's Health Connect source, async SQLite store, scoring v19 and queries. Google OAuth and drizzle are gone. |
| Perf | A 120 Hz request (`plugins/withHighRefreshRate.js`), the header collapse fix, the 200 ms `ios_from_right` push, `removeClippedSubviews` on long pages, an orb made of static SVG layers, and scoped re-renders (`keepEqual`). |
| Live heart rate | A 60 s Health Connect ticker, the Home heart-rate card (shown from SQLite at launch), and Fitbit Air live heart rate over Bluetooth (`react-native-ble-plx` + `modules/pulse-bt`). |
| Background | WorkManager sync. The owner's phone shows "Synced · 11.1 s". |
| Notifications | 7 local alerts, plus a test button. The owner confirmed the test works. |
| New scores | HRV Status, Training Readiness / Status / Effect, Recovery Time, Activity Cost, detected workouts. |
| New screens | Coach (BYOK, key saved, answers), Nutrition, Breathe, Live workout (owner: work), Chart explorer, Goals and Weekly plan, report share. |
| Small items | Launcher shortcuts (owner: work), profile name and photo, deep links to tabs, Health Connect's official icon, the native-style switch. |

Rules that changed: AGENTS.md is rewritten (Health Connect, Android only, halo as the reference). `main` takes tested
work directly as a fast-forward, with no PR.

## How to build and try it on the phone

Local release builds, signed with the template's debug key. `adb install -r` over the installed build keeps its data;
never install an EAS-signed build over it.

```sh
S=<scratch dir>; rsync -a --delete --exclude node_modules --exclude .git --exclude '/android' --exclude .claude ./ $S/
ln -s $PWD/node_modules $S/node_modules   # once
cd $S && CI=1 npx expo prebuild --platform android --no-install   # only after a native change
cd android && ANDROID_HOME=~/Library/Android/sdk ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/release/app-release.apk
```

Things to watch when building:
- Exclude only the root `/android`. A bare `--exclude android` also drops `modules/pulse-bt/android`, and the module
  silently goes missing: that is why "Open Google Health" failed earlier.
- The shell's `cd` is zoxide. A relative `cd` can fail and skip the rest of a `&&` chain, so use absolute paths.
- Jank: `dumpsys gfxinfo`. Root causes: a Perfetto trace with callstack sampling, after adding
  `<profileable android:shell="true"/>` to the scratch manifest only.
- The memory file `pulse-device-testing` has the details.

The last measurement was back to back on the same phone:

| | Scroll jank | Navigation janky frames | Navigation p99 |
|---|---|---|---|
| Pulse | 0.33% | 28 | 38 ms |
| halo | 0% | 32 | 32 ms |

## Open items, most important first

1. **The Health tab still stutters when it opens.** The owner reports it; it was not traced yet.
   - Trace a switch from Home to the Health tab with Perfetto, as docs/learning.md "Long pages and the first draw"
     does.
   - Suspects: the orb's SVG layers mounting with the tab, and the Health hub's many cards.
   - Possible fixes: mount the orb after the tab settles, apply `removeClippedSubviews` in PageShell (only DetailShell
     has it), or prerender the tab.
2. **UI gaps the owner keeps finding.** Compare each screen with the PWA, using the design skills the owner named:
   `make-interfaces-feel-better`, `web-design-guidelines`, `frontend-design`.
   - The weekly plan section in Settings › Goals: the hints now sit under each row, but it has not been looked at on
     the phone since.
   - The profile edit sheet: smaller fields, Save pinned. Confirm on the phone.
   - The coach screen: the composer is now at the bottom. Confirm with a long conversation and the keyboard up.
3. **Not tried on the phone yet**:
   - Nutrition's photo and text estimate (the coach key exists now);
   - the chart explorer's gestures;
   - goals and weekly plan cards on Strain;
   - the profile photo with the camera;
   - a cold-start notification tap.
4. **`docs/plan.md` still describes the Google-era plan.** Rewrite it, or replace it with `docs/rewrite-plan.md`.
5. **Housekeeping**:
   - Delete the merged agent worktrees in `.claude/worktrees/` and their `worktree-agent-*` branches (`git worktree
     remove`, `git branch -D`).
   - Done 2026-10-17: food estimates read the coach setup through `src/coach/session` (`src/nutrition/model.ts` is gone).

## How the owner wants work done

- Hinglish replies, short and direct.
- Measure on the phone before claiming a fix. Never add a timing constant without a measurement behind it.
- Agents must be lean: targeted reads, the full check suite once at the end, short reports.
- After checks pass and the phone test passes, push straight to `main`.
