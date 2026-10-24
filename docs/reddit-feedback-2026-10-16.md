# Reddit feedback: Pulse Mobile launch

Reviewed 2026-10-16. Source: [launch post and discussion](https://www.reddit.com/r/fitbit/comments/1x6m2pc/), including the [linked sync complaint](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph55rth/).

The thread advertised v0.3.0. Reddit displayed 262 comments; its thread JSON returned 259 comments and replies, with no remaining comment placeholders. Counts below refer to distinct users in that returned discussion, not votes. Repeat comments from one user count once. Reports are user observations, not locally reproduced bugs. Most users did not specify their version or phone.

Cross-checked against [Old Reddit with all comments loaded](https://old.reddit.com/r/fitbit/comments/1x6m2pc/nobody_sent_me_a_legal_notice_so_i_put_the_whole/?limit=500). It rendered the same 259 comment IDs, all with comment text and no remaining load-more placeholders. No additional comments were found; the displayed total of 262 remains different from the returned count.

Updated 2026-10-17: Old Reddit with every comment loaded (290 of the 294 Reddit counts; the rest are deleted) added 31 comments posted after the first review, and the repository's GitHub issues (#4 to #9) were added. New reports are folded into the entries below or added as B18 to B20, D7, F25 and F26.

Biggest recurring problems: six-month chart crashes, missing imported data, missing strength workouts, and incorrect step averages used by Pulse Age. Feature requests are listed separately. Replies and three relevant screenshots were checked for context.

## Reported issues

### B1. Six-month charts crash the app

- **Reach:** 5 users. Highest-confidence recurring crash report.
- **Trigger:** Open a metric and select the six-month / 6M range. Reports name HRV, resting heart rate, and multiple other charts.
- **Evidence:** [TopUniversity3469](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwixj2/) reports crashes for any metric; [FixVegetable9071](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgyc2oe/) confirms. [yxtsama](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgx85gp/) reports some charts; [KrizeeK](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1v0e8/) names HRV; [BlackLionFilm](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2xfzn/) names RHR.
- **Version context:** OP initially asked whether this was a PWA issue. The original reporter explicitly confirmed [the same failure on v0.2.0 and v0.3.0](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwkbui/). Do not close this as PWA-only.
- **Later reports:** [dave-r6](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph64uz6/) crashes on 6 months and 1 year. B18's Healthspan crash is the same fault.
- **Status:** No confirmed fix in the thread.
- **Root cause (found 2026-10-17 on the phone):** Trends' chart wrapped each 6M month's labels in a Skia `<Group>` outside the canvas; React Native cannot render a Skia element there and closed the app. Fixed on `fix/reddit-bugs`.

### B2. Sync completes poorly or leaves most metrics empty

- **Reach:** 5 users report broadly missing data; a sixth reports missing heart rate on Pixel Watch 4.
- [being_veblen](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgy55py/) has Fitbit data in Google Health but sees no synced data in Pulse, then [reports it again](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph55rth/). One user, two comments.
- [_amritesh_](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph178e2/) reports no sync and [confirms all requested permissions](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph17i89/). Their screenshot shows empty Sleep, Recovery and Strain, a waiting-for-sleep message, and heart rate marked **8 days ago**.
- [Consistent_Quail_268](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1skdd/) confirms the same issue despite granting permissions.
- [JordanHobson](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwoljw/) gets only heart rate; [all permissions are active and data appears synced](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwqeja/), but other metrics remain absent.
- [Advanced-Eagle9409](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxb0yo/) cannot see all metrics immediately after installing. Permission state and eventual outcome are unknown.
- [Illustrious-Tea-2610](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph0uuur/) uses **Pixel Watch 4** and sees no heart-rate data, asking whether only Fitbit Air is supported.
- **Impact:** Core scores and health views are unavailable or stale. Permission advice alone did not resolve at least two reports. These symptoms may have different causes; Google Health visibility does not by itself establish what was exported to Health Connect.
- **Status:** Unresolved in the discussion. OP requested evidence from JordanHobson.

### B3. All apps sync fails with an invalid time interval

- **Reporter:** [skippybosco](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph26fk4/).
- **Trigger:** Select **All apps** as the source policy. Their sources include Renpho weight and Hevy workouts. They say the failure only occurs with this selection.
- **Observed error:** `Last sync failed: startTime must be before endTime.` Screenshot confirms the error and selected policy. It also shows a recent synced timestamp alongside the failure.
- **Important distinction:** The comment proposes cross-midnight sleep intervals as the cause, using examples such as 22:50 to 05:57. That is the reporter's supplied analysis, not a verified diagnosis. No original diagnostic file is attached in the comment body.
- **Impact:** Combining third-party sources can block a sync. The user cannot tell which source or record failed.
- **Related requests:** Per-app import selection and actionable error details, F19 and F20.

### B4. Strength workouts do not import, affecting Pulse Age

- **Reach:** 2 users, different workout sources.
- [dennis77](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1rs4m/) records workouts through Google Watch / Google Health. They do not appear in Pulse, while Pulse Age says insufficient strength activity is adding years. They also cannot manually log the missing activity.
- [greeknuke](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph29og1/) records strength workouts in **Hevy**, which sends them to Health Connect and then Fitbit. Pulse shows none.
- **Impact:** Missing activity is presented as a lifestyle deficit, damaging trust in Pulse Age.
- **GitHub:** [#6](https://github.com/adityaongit/pulse-mobile/issues/6) (Fitbit Air, Android 16) shows the same "startTime must be before endTime" on the import screen, after re-connecting from sample data.
- **Status:** No workaround or fix confirmed. Manual logging is a separate request, F22.

### B5. Body-fat records are missing

- [dennis77](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1slod/) has body fat logged in Google Health, but Pulse does not show it.
- **Context:** Same user as B4, but a separate record type. Health Connect export, permissions and source policy were not supplied.
- **Status:** Unresolved report; do not assume the workout and body-fat failures share a cause.

### B6. Step averages disagree, including the Pulse Age input

- **Reach:** 2 users.
- [DaveRnD](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwvcm9/) reports incorrect daily steps in Pulse Age. Their comparison screenshot shows **2,218** as Pulse Age's six-month average, versus **8,824** in the six-month Steps chart and **8,817** in its summary, with **93 days with data**. The Pulse Age card attributes **2.8 added years** to daily steps.
- [feliswackis](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph3wboj/) separately reports a six-month step average that is far off, mentioning approximately 5k. The comment does not establish whether 5k is the displayed average or the size of the discrepancy.
- **Impact:** Conflicting views and potentially misleading age contributions. The screenshot demonstrates disagreement, not which denominator or date window is correct.
- **Status:** OP [acknowledged DaveRnD's report](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgww2yp/); no resolution posted.

### B7. Vitals warnings appear inconsistent with displayed values

- **Reach:** 2 related reports, not proven to be one bug.
- [alvaro761991](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxqsh0/) sees **two out-of-range vitals instead of one**. HRV is present and appears in range, but the user suspects it is not being read correctly.
- [Ic3man01](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph07unq/) gets an out-of-range warning for RHR below their average but, in their view, within a normal range.
- **Interpretation:** Check consistency between the count, value, personal baseline and explanation. A lower RHR is not automatically an implementation error; this may partly be unclear baseline messaging.
- **Status:** No values, baseline bounds or resolution supplied.

### B8. VO2 max looks implausible or lacks an understandable calculation

- [Ic3man01](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph07unq/) asks how VO2 max is measured and says it seems out of range.
- **Status:** Accuracy concern, not a confirmed numerical defect. No displayed value, comparison measurement or input data supplied.

### B9. Android system Back exits instead of navigating back

- [ActBig9637](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxf2ov/) says the phone's Back button closes the app; only the app's own back button returns to the previous screen.
- **Expected behavior:** System Back should return through the screen history where an in-app back destination exists.
- **Status:** OP acknowledged the feedback. No affected route or phone model supplied.

### B10. Live heart rate stays on Connecting

- [Infamous_Person101](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwpl8z/) cannot connect live HR; it remains on Connecting.
- **OP guidance:** [Enable heart-rate sharing in the device settings in Google Health](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwx59t/). OP mentions Fitbit Air support and uncertainty about other devices.
- **Status:** Setup or compatibility issue remains possible. Reporter did not confirm whether enabling sharing resolved it.

### B11. Heart-rate data is 20 to 30 minutes old

- [Sure-Calligrapher953](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2dbmv/) reports stale HR, then [specifies 20 to 30 minute delays and asks for 3 to 5 minute freshness](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2hasl/).
- **Context:** User asks whether continuous live HR would drain the battery; OP says it would. Imported HR freshness and live device streaming should be treated separately.
- **Status:** No established source of the delay or fix. Related to B2's eight-day-old screenshot, but materially different in severity.

### B12. SpO2 is absent

- **Reach:** 2 direct missing-data reports, plus a related availability question.
- [fabioqa](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgyc1gp/) sees four vitals but no blood oxygen. [Gongas91](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2c9ml/) says SpO2 is the only missing metric.
- **OP explanation:** [The source does not share the value](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2cdj7/). Treat this as OP's explanation of the current integration, not a verified claim that Health Connect has no SpO2 capability.
- **Status:** Known missing metric in these users' experience; whether the limitation is upstream export, permissions or Pulse import was not independently checked.

### B13. Additional daytime sleep initially missing, later appeared

- [DontLike-Cheesecake](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph0w9s8/) works nights, sleeps roughly **04:00 to 10:00**, then **11:30 to 13:30**. Google Health records the second segment, but it initially seemed absent in Pulse.
- **Outcome:** User later [confirmed it was present](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph19icf/). Discussion points to watch / Google Health sync delay.
- **Status:** Resolved for this reporter. Retain as delayed-data context and a split-sleep scenario, not an open confirmed omission.

### B14. The keyboard covers the Coach's message field

- **Reporter:** a user replying after the launch, with a screenshot of the Coach's first screen: the keyboard is up and the message field is under it, out of sight.
- **Trigger:** Open Coach and tap into the message field. The suggestion cards stay where they were and the composer stays behind the keyboard.
- **Cause found in code:** the Coach screen turned keyboard avoidance off on Android, on the assumption that Android resizes the window for the keyboard. An edge-to-edge window (the rule from Android 15, and Expo SDK 57's default) is not resized on many phones. Task pages, scrolling screens and onboarding had the same assumption.
- **Also:** [GitHub #8](https://github.com/adityaongit/pulse-mobile/issues/8) (Android 17, real data), and OP's [reply](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph5cpxf/) to [firstworldrefugee](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph5cbtp/).
- **Status:** Fixed on `fix/reddit-bugs`, see [reddit-fixes-plan.md](reddit-fixes-plan.md).

### B15. Storage grows without limit

- **Source:** the owner, reviewing the thread, asked whether keeping every user's Google Health data on the phone makes Pulse's storage balloon for people with one, two or five years of history.
- **What the code does today:** the first import reads at most the last 180 days (`DEFAULT_HISTORY_DAYS`), and a re-import reads the same window, so years of history never arrive at once. Nothing is ever deleted, though. Every new day adds its raw heart-rate, steps and HRV samples (`hr_days`, `steps_days`, `hrv_days`) on top of its scores, and the database only grows.
- **Size:** the raw heart rate dominates. Its row holds two JSON arrays, about 10 bytes per sample, so a day costs from about 15 KB (a sample a minute) to about 170 KB (one every 5 seconds); scores and daily metrics are a few KB a day. That is roughly 5 to 60 MB a year, before SQLite's own overhead. Measure a real database on a phone before choosing the numbers below.
- **Impact:** not a first-run problem, but a slow, silent one: a phone that has run Pulse for years carries every raw sample it ever imported.
- **Proposed fix (needs the owner's choice of the retention length):** keep raw intraday samples for a rolling window that covers the longest look-back any score reads from raw data, and keep daily metrics and stored scores forever (they are small). Prune older raw buckets after each sync, then reclaim the space (`PRAGMA auto_vacuum = INCREMENTAL` and `incremental_vacuum`). A `SCORING_VERSION` bump then rescores only the window that still has raw data, and older days keep their stored scores; an older day's screen shows its summary without the intraday chart. Show the database's size in Settings › Data.
- **Status:** Built on `fix/reddit-bugs`: raw heart rate older than 30 days is compacted to one mean per minute after each sync, freed space is vacuumed back, and Settings › Your data shows the database's size. See [reddit-fixes-plan.md](reddit-fixes-plan.md) and the "Storage that stops growing" section of [learning.md](learning.md).

### B16. History bars hide day-to-day changes

- **Reporter:** a user after the launch: the bar chart in a metric's detail page is "too zoomed out, so daily variations are not clear", and asked for a dot per day on Explore's line charts.
- **Cause found in code:** the History chart (`TrendChart`) drew every single-colour metric as bars from zero at W and M. For a level such as resting heart rate (52 to 60 bpm), a day's change was a few pixels at the top of tall bars. Explore drew daily lines with no mark for each day.
- **Status:** Fixed on `fix/reddit-bugs`: History draws on the Trend View's chart, each range at its own grain as WHOOP's and the web's Trend View do: W each day with its value, M each day against weekly ticks, 6M and 1Y a segment per month with its change. Levels are lines on their own range, amounts bars on zero. Explore's daily lines get a dot per day once each day has room for one.

### B17. RHR on Health Monitor differs from the RHR page

- **Reporter:** a user after the launch, with screenshots: Health Monitor's RHR tile reads 52 bpm, the Resting Heart Rate page 57.
- **Cause found in code:** two definitions under one name. Recovery and Health Monitor scored the engine's own aggregates (the mean heart rate over the night's sleep minutes, and the mean of the night's HRV samples in sleep stages), while Home, Trends and the detail pages showed Fitbit's values from Health Connect. HRV had the same split; respiratory rate, skin temperature and SpO2 already read Fitbit's values everywhere.
- **Status:** Fixed on `fix/reddit-bugs`, on the owner's call that Fitbit's values are the source of truth: one resting HR (`dayRestingHr`: Fitbit's daily value, else Pulse's sleep-session estimate) and Fitbit's nightly HRV feed Recovery, its baselines, Health Monitor, HRV Status, Pulse Age, the reports and every screen. `SCORING_VERSION` 29 rescores the history.

### B18. Healthspan's secondary screens close the app

- **Reporter:** [Necessary-Nothing-82](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph7u5q8/), in Portuguese: Healthspan's secondary screens error and close the app. OP asked for a DM.
- **Cause:** each Healthspan contributor's "View trend" opens its Trend View, and its 6M range drew B1's off-canvas Skia Group.
- **Status:** Fixed with B1 on `fix/reddit-bugs`. Checked on the phone: Healthspan, a contributor's View trend, then W, M and 6M, with no crash.

### B19. Naps are not imported

- **Reporters:** [NeedElicitor](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph9lhfh/) says Pulse pulls one sleep a day while Google Health shows the nap; [GitHub #9](https://github.com/adityaongit/pulse-mobile/issues/9) (Samsung S25+, Android 16) reports the same, with "Demo data" in its data field.
- **OP's reply:** [naps do sync](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph9nny9/) when Google Health has them, with screenshots.
- **What the code does:** every sleep session of 20 minutes or more is imported; the longest one ending on a day is that day's night and the rest are naps (`mapSleep` in `src/health/import.ts`). Each sync re-reads the days since the last sync.
- **Status:** Not reproduced. Needs the reporter's Data check (Settings › Data source › Data check), which lists every sleep session Health Connect holds and which app wrote it, and whether #9 ran on sample data, which has its own scripted naps.

### B20. Coach's workout analysis "Expand" starts a new chat

- **Reporter:** [GitHub #5](https://github.com/adityaongit/pulse-mobile/issues/5) (Android 17, real data, with screen recordings): a workout's automatic Coach analysis has an expand control that opens the Coach chat without the analysis, so it has to be asked again.
- **Also asked there:** a setting to turn the automatic analysis off (each one spends the owner's tokens), and the same analysis on Sleep and Recovery (F27).
- **Status:** Open.

## Feature requests

These are requests from the thread, not accepted scope. OP's replies are historical responses, not evidence that a feature has shipped. iOS and server integrations would require a separate scope decision under the current Android-only, on-device project rules.

| ID | Request | Context and sources | Reply / status in thread |
| --- | --- | --- | --- |
| F1 | iOS app | Repeated across many independent users: [leobarca](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwkdtn/), [No-Abbreviations4194](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwsurq/), [ezzeldin132](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwsw1d/), [Strategy_Safe](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxcm3c/), [Mythsteryx](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxmbj2/), and others. Later: [WalkKeeper](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph6jddl/) (offers [TestFlight testing](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph6jowb/)), [Anxious_Ad2407](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph6o03l/), [LevelLongjumping6799](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph72l0f/). | OP repeatedly said soon. [ITGuytech offered publishing-fee / account help](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwuus0/); [fkd_beyondhelloworld offered development help](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2qz4o/). No release verified. |
| F2 | Google Play distribution | [gonomon](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwqvev/), [xxpx](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwydos/), [ashishzxc](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1md8d/) and [Sidd1dec](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgx367v/) ask. Sidd1dec cannot sideload because of phone restrictions; [xiaoyueyoqwq](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1b1yg/) mentions Android Advanced Protection. | OP discussed testing before publication. This is an installation blocker for some users, beyond convenience. |
| F3 | More languages | [Brazilian Portuguese](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph4uah7/), [German](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph3n8j2/), [Russian](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2i05k/), [Polish](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgyjfxo/). Four independent requests. | No implementation confirmed. |
| F4 | Imperial units | [OSUBoglehead](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgx2c2u/) wants imperial units throughout. [jd_delwado](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph555c4/) specifically wants feet and inches instead of cm. Also [GitHub #7](https://github.com/adityaongit/pulse-mobile/issues/7) (inches and pounds), and [jd_delwado again](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph6450g/). | OP said next update. **Built 2026-10-17:** Settings › App › Units (metric or imperial), defaulting to the phone's region. |
| F5 | 12-hour clock preference | [jd_delwado](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph555c4/) wants a 12-hour display instead of 24-hour time. [Repeated](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph6450g/). | **Built 2026-10-17:** Settings › App › Clock (24- or 12-hour), defaulting to the phone's. |
| F6 | Interactive sleep chart | [jd_delwado](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph555c4/) likes sleep presentation but wants interaction, citing Google Health and Zepp as references. [Repeated](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph6450g/): a vertical slider through the night, as Zepp draws it. | Exact gestures / details not specified. |
| F7 | Change graph colours | [praknew01](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph4jiaj/) asks how to change a graph's colour. | No reply captured. |
| F8 | Customise home panels | [Gongas91](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwk4ue/) wants daily steps immediately below heart rate. | OP said it was already on the list. |
| F9 | Home-screen and lock-screen widgets | [DaveRnD](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwoh53/) requests both. [Biggitch73](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph9hiwg/), asked by OP, [describes](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph9hya2/) the Sleep, Recovery and Strain row from the top of the app, with a choice of metrics (Strain swapped for steps or calories eaten), like Google Health's widget. | OP agreed. |
| F10 | Live workout tracking | [Interesting-Ad-4258](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph3my98/) wants BPM, cadence and distance in km during a run after switching to Fitbit Air. | Distinct from showing already-imported workout summaries. |
| F11 | Walk / run route maps | [Proper-Cheesecake270](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1y7p9/) wants maps inside activities and says route data is in Health Connect. | Record availability and permission requirements not verified. |
| F12 | Local or self-hosted LLM integration for the AI coach | [Proper-Cheesecake270](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1y7p9/) uses Ollama via HTTP. [fitzingout](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph203v5/) also wants local LLM / Tailscale access. Owner clarification: users provide a base URL, API key when required, and model name to connect their own LLM endpoint. | OP agreed and invited contributions. Base URL, API key and model configuration were clarified by the owner after reviewing the thread. **Built 2026-10-17:** Coach › Your own server: an OpenAI-compatible URL, an optional key and a model; plain http allowed for home networks and Tailscale. |
| F13 | Calorie intake versus daily budget / deficit | [LegDifficult8992](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgy1z4b/) wants the old Fitbit-style comparison of intake against baseline plus exercise calories. [xlerate](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgyqse4/) supports it. | Two supporters. The author's [duplicate comment](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgy0nlr/) is not another user. |
| F14 | Food tracking, Strava and workout-log integrations | [LegPlenty6091](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph32wy8/) asks to bring other app data into Pulse. | Specific data flows and whether Health Connect is sufficient are unspecified. |
| F15 | Personal control over scoring algorithms | [LegPlenty6091](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph327uy/) asks whether calculations can be changed and whether the open-source app can be edited for personal use. | OP asked what they would change and why. This does not yet establish a request for a full in-app formula editor. |
| F16 | More journal behaviours | [greeknuke](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph29og1/) finds the current list too short and asks for the breadth of WHOOP's journal. | Specific missing behaviours not listed. |
| F17 | Blood-pressure readings and trends | [Exfiltrator](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph0gk28/) has BP in Health Connect but Pulse ignores it. Wants a readings list, graphs, and correlations with running and weight. [Proper-Cheesecake270](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1yjst/) supports it. | Two users. OP agreed. Treat as requested metric support, not a proven regression in an existing BP feature. |
| F18 | Adaptive workout progression | [krone-icals](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgww9ff/) wants reps or maximum weight adjusted using workout history and downward health trends. | OP mentioned [openGYM integration](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgx2pn9/) as an idea. No implementation confirmed. |
| F19 (source policy removed 2026-10-24; Health Connect's own settings pick sources) | Choose individual third-party import sources | [skippybosco](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph26fk4/) needs more control than Fitbit only / Fitbit first / All apps, particularly with Renpho and Hevy. | Motivated by B3. |
| F20 | Actionable sync diagnostics and anomaly handling | [skippybosco](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph26fk4/) wants the failing data identified, correction or bug-report actions from the error, and handling of malformed records. | Their suggested automatic correction is a request, not a validated safe repair strategy. |
| F21 | Inclusive profile wording / HRT option | [SomethingOrAnother42](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwvxd7/) says sex-at-birth wording does not reflect their situation after long-term testosterone therapy. Requests revised wording or an HRT option. | OP agreed to update it. Requires a clear explanation of how any profile input affects calculations. **Built 2026-10-17:** the profile calls it Reference ranges (male or female tables) and says which to pick on long-term hormone therapy. |
| F22 | Manually log missing workouts | [dennis77](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1rs4m/) cannot add strength workouts when import fails. | Separate request from fixing B4. |
| F23 | Home-lab / NAS deployment and chat-based logging | [LegPlenty6091](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph32wy8/) suggests NAS hosting and Hermes integration to add logs through chat. | Exploratory request; clarify whether this belongs in the existing web project rather than Mobile. |
| F24 | Low-battery visibility | [yas0i](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2vc0l/) asks how to know when the battery is low. | Ambiguous: phone versus wearable, and indicator versus notification, are not specified. Clarify before implementation. |
| F25 | A donation link | [Ok_Sound_6778](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph9fjuf/) looked for a way to support the work and found none. | No reply captured. Not now (owner, 2026-10-17). |
| F26 | WHOOP data without Health Connect | [GitHub #4](https://github.com/adityaongit/pulse-mobile/issues/4): Noop writes WHOOP data to Health Connect without skin temperature or continuous HRV, so Pulse sees part of it. Asks for a direct WHOOP source. | Conflicts with the Health Connect only rule; record, do not schedule. |
| F27 | Coach analysis controls | [GitHub #5](https://github.com/adityaongit/pulse-mobile/issues/5): turn the automatic workout analysis off, and offer it on Sleep and Recovery. | Comes with B20. **Built 2026-10-17:** Coach settings › Analyze each workout; off, the pill asks only when tapped. Sleep and Recovery analysis not scheduled. |
| F28 | Heart rate coloured by zone on the Heart Rate page | A user asked why workouts colour heart rate by zone but the Heart Rate page does not. | **Built 2026-10-17:** the Heart Rate page colours the whole day by zone; Strain keeps WHOOP's day view (zones inside workouts only). |

## Documentation, onboarding and trust gaps

These are actionable feedback themes, not verified security vulnerabilities or extra bug confirmations.

### D1. Explain privacy and APK verification clearly

- [hdl_noob](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgynjh4/) asks how to verify that a sideloaded APK is safe, then [repeats that question](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph3w5ja/). One user, two comments.
- [_Nundo](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgywund/) declines to install because they cannot find a clear data-handling explanation; [NihilAlienum](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgzsg6r/) specifically asks for information-protection disclosures.
- [OpeningFew7709](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgy51yq/) and [Beiranvand_](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgx036w/) raise privacy / security concerns. No exploit or concrete vulnerability is demonstrated.
- **Gap:** Users want understandable data-flow disclosures and a way to assess release provenance. OP's [reply about pausing Play Protect](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph3wcgv/) answers installation friction, not the user's verification question. Do not present that reply as evidence of APK safety.

### D2. Explain the data path, supported devices and sync delays

- Users ask about [Garmin](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwx7zk/), [Galaxy Watch](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph201qt/), [Samsung Health / RingConn](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxgq2l/), [Mi Band 10](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwqwlz/), and [other wearables generally](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgx77qi/).
- [SmoothProfessional22](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph0ulgg/) confirms Helios Strap works but asks about scoring accuracy. This is a compatibility success plus an accuracy question, not an import failure.
- OP's generic replies often say Google Health where the relevant mobile data interface is Health Connect. A device matrix should distinguish tested imports, expected imports, and live HR support. [OP explicitly says Garmin needs wider testing](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2geow/).
- [Kztten](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxe0fj/) asks whether manual sync is needed; later replies become a developer API question. Avoid counting that whole subthread as user sync failures.
- B2, B10, B11 and resolved B13 show why onboarding needs to distinguish missing permissions, missing upstream records, stale records, calibration, and live streaming.

### D3. Explain Pulse Age, calibration and estimated metrics

- [justAPutato](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2zrfl/) requests an age feature that [OP says already exists](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph3nfhl/). This is discoverability feedback, not a missing feature.
- [amer1406](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph4efpd/) asks how age is calculated.
- [excursionist_eye](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxaew2/) sees Pulse Age nine years older than actual age. They [accept the reasons and disclose only a week of Fitbit Air history](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxc8c4/). Do not count this alone as a confirmed age bug.
- [godfather0054](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2wink/) is waiting for one remaining calibration day, without alleging a failure.
- **Gap:** Make data sufficiency, provisional status, and input sources understandable. Keep these cases separate from B4 and B6, where missing or conflicting inputs are actually reported.

### D4. Clarify region-locked metric availability

- [am0myn0us](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwjkav/) asks about region-locked SpO2 and AFib markers. [sleepdeviltsu](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxcscs/) asks whether Pulse can make ECG available despite region restrictions.
- These are capability questions, not evidence that Pulse can unlock device features. OP's [broad reply](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgwk13j/) also notes missing SpO2. Explain supported imported records without promising to bypass upstream restrictions.

### D5. Make desktop setup and release updates easier to find

- [jd_delwado](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph555c4/) finds PC / desktop instructions too technical for a non-coder. [crashumbc](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph1ioev/) wants a useful website for viewing data, although their complaint targets Fitbit / Google broadly.
- [totti_07](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgx2exl/) asks how to follow updates; OP suggests starring GitHub. This is a discoverability request, not an explicit request for in-app auto-update.

### D6. Address product presentation and differentiation

- [ronakg](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgx958z/) flags iPhone-framed screenshots advertising an Android app as a trust / attention-to-detail problem.
- [Canon-01](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph0plis/) suggests improving the landing-page domain, without a specific alternative.
- Users ask how Pulse differs from [Halo](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgxcx2m/), [Bevel](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgx9awu/), [Cordaya](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2ga0r/) and [Google Health](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph2qz4o/).
- [EhvinC](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/pgzkaoi/) and others call out the close WHOOP UI resemblance; [x_spz](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph4lf5l/) asks about legal exposure. Record as presentation / originality concerns, not a legal finding.

### D7. Explain the streak and answer the common questions in the app

- [frankybeenz1](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph6kzrr/) cannot tell what the number with the flame in Home's top left counts (the streak).
- [ruvanist](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph9fho7/) asks whether a Pixel Watch works; [Key_Life5859](https://www.reddit.com/r/fitbit/comments/1x6m2pc/comment/ph9a4od/) asks for an AI coach, which Pulse has behind More › Coach. Both belong in D2's device notes and the first-run tour.

## Suggested triage order

1. **Six-month crash, B1:** five independent reports, explicit reproduction steps, persists across two releases.
2. **Import failures, B2 to B5:** core use is blocked; isolate the All apps interval error and missing strength sessions before treating every sync complaint as one bug.
3. **Incorrect score inputs, B6 and B7:** step disagreement and vitals warnings undermine the meaning of the displayed scores.
4. **Navigation and HR connection / freshness, B9 to B11:** everyday usability problems, with source and device constraints still to establish.
5. **Trust and source explanations, D1 to D4:** support recurring installation and data-availability questions with clear, specific information.
6. **Feature backlog:** prioritise separately from defects. Repeated themes include iOS, Play distribution, languages, units, local AI, blood pressure and calorie budgeting.

No code fixes, device reproduction, GitHub issue creation or release verification are included in this report.
