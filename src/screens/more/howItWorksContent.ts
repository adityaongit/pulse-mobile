// "How Pulse works" (More): one explainer per score, written from src/core and docs/algorithms. Every number here
// is the code's; when the code changes, change this file.
export type HowRow = { term: string; detail: string }
export type HowSection = { title: string; paragraphs?: string[]; rows?: HowRow[] }
export type ScoreDoc = {
  /** URL segment: /more/how-it-works/<slug>. */
  slug: string
  /** Display name, e.g. "Recovery", "Pulse Age". */
  name: string
  /** One short sentence (max ~70 characters) shown as the page intro and as a caption. */
  summary: string
  /** The in-app screen where the score lives, e.g. "/recovery", "/health/healthspan"; null if none. */
  href: string | null
  /** In this order: "What goes in", "How it is weighted", "What the bands mean", optionally "A worked example" (real numbers run through the code), "Limits". Omit a section only if it truly does not apply (say so in Limits instead). */
  sections: HowSection[]
}
export const SCORE_DOCS: ScoreDoc[] = [
  {
    slug: "recovery",
    name: "Recovery",
    summary: "How ready your body is to take on strain today, from 1 to 100%.",
    href: "/recovery",
    sections: [
      {
        title: "What goes in",
        paragraphs: [
          "Pulse scores Recovery each morning from last night’s main sleep, comparing each vital with your own baseline: its average and spread over the last 60 days.",
        ],
        rows: [
          { term: "Heart rate variability", detail: "The mean of Fitbit’s HRV readings while you slept, in ms. Higher is better." },
          { term: "Resting heart rate", detail: "Your mean heart rate while you slept, in bpm. Lower is better." },
          { term: "Sleep Performance", detail: "Last night’s Sleep Performance, 0 to 100." },
          { term: "Respiratory rate", detail: "Breaths per minute asleep, in rpm. Higher than usual counts against you." },
          { term: "Skin temperature", detail: "Last night against your skin-temperature baseline. Only warmer than usual counts, and only against you." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "HRV and resting heart rate are each placed on 0 to 100 by how far last night sits from your baseline, in units of its usual spread: at baseline 50, one spread better 100, one spread worse 0.",
        ],
        rows: [
          { term: "HRV", detail: "40%" },
          { term: "Resting heart rate", detail: "30%" },
          { term: "Sleep Performance", detail: "30%" },
          { term: "Respiratory rate", detail: "Then up to 10 points up or down." },
          { term: "Skin temperature", detail: "Then up to 30 points down when you run warm; never up." },
        ],
      },
      {
        title: "What the bands mean",
        paragraphs: ["The result is kept between 1 and 100%."],
        rows: [
          { term: "67-100%", detail: "Green: your body is primed for strain." },
          { term: "34-66%", detail: "Yellow: you are maintaining; moderate strain fits." },
          { term: "1-33%", detail: "Red: your body needs rest." },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Recovery shows from your second night, once there is a night to compare with, and is Provisional until your data spans 60 days. It needs HRV and heart rate in last night’s sleep and a Sleep Performance; without them there is no score rather than a guess. Blood oxygen is not used: Fitbit does not share it with Health Connect. Recovery is an estimate from a wrist sensor: it reads your body, not your plans or how you feel.",
        ],
      },
    ],
  },
  {
    slug: "strain",
    name: "Strain",
    summary: "The load of your day as a percent: 0 to 100 on most days, above 100 on a very big one.",
    href: "/strain",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Heart rate while awake", detail: "Minute averages outside sleep and recorded workouts. Each covers the gap to the next one, up to 30\u00a0minutes; minutes below Zone 1 are left out." },
          { term: "Workouts", detail: "Every heart-rate reading during a recorded workout, each covering the gap to the next one." },
          { term: "Steps", detail: "The steps you take while awake, outside workouts." },
          { term: "Max heart rate", detail: "The value in Settings; else 220 − your age. Zone 1 starts at 50% of it, then 60, 70, 80 and 90%." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Each second of heart rate earns units by its zone, rising smoothly across the zone: the harder your heart works, the faster units add up.",
        ],
        rows: [
          { term: "Below Zone 1", detail: "0 to 1 unit a second (workouts only)" },
          { term: "Zone 1", detail: "2 units a second" },
          { term: "Zone 2", detail: "3 to 4 units a second" },
          { term: "Zone 3", detail: "4 to 7 units a second" },
          { term: "Zone 4", detail: "7 to 12 units a second" },
          { term: "Zone 5", detail: "12 to 20 units a second" },
        ],
      },
      {
        title: "What the bands mean",
        paragraphs: [
          "Strain = 16 × atan(steps ÷ 7,000) + 66 × atan(units ÷ 20,000). Both parts flatten as they grow, so each point of Strain is harder to earn than the last. An hour in the middle of Zone 3 gives about 19,800 units, worth 52; add 8,000 steps and the day comes to 65. The most a day can reach is about 129.",
        ],
        rows: [
          { term: "Up to 40%", detail: "Light" },
          { term: "41-60%", detail: "Moderate" },
          { term: "61-79%", detail: "Strenuous" },
          { term: "80% and up", detail: "All out" },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Strain needs heart rate or steps for the day; otherwise the day shows Not enough data. Today’s Strain is a running total until midnight. Each activity also gets its own Strain from its units alone: 66 × atan(units ÷ 20,000).",
          "Heart rate misses effort that barely raises it, such as heavy lifting with long rests. The ring fills at 100% and stays full above it; the number shows the real value.",
        ],
      },
    ],
  },
  {
    slug: "strain-target",
    name: "Strain Target",
    summary: "A Strain range for today, set by your Recovery and your recent Strain.",
    href: "/strain",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Today’s Recovery", detail: "Moves and widens the range. Without a Recovery score Pulse reads it as 50%." },
          { term: "Your last 14\u00a0days of Strain", detail: "Folded into a base, the newest days counting most; a day without Strain counts as 0." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "The base starts at the oldest day and each day after moves it a quarter of the way to that day's Strain. Recovery then scales the base: at 50% it stays, at 100% it rises 30%, at 0% it drops 30%. The range runs from that centre minus 5 to 10 points, to the centre plus 10 to 30 points, wider with a higher Recovery. The low end stays between 20 and 120, the high end between 40 and 120.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "Below the range", detail: "A lighter day than your body can take today." },
          { term: "Inside the range", detail: "Training builds fitness without digging a recovery hole." },
          { term: "Above the range", detail: "More strain than today’s Recovery suggests; expect it to show tomorrow." },
        ],
      },
      {
        title: "A worked example",
        paragraphs: [
          "Take 14 days of past Strain, oldest first: 45, 50, 20, 55, 48, 40, 60, 47, 52, 25, 50, 45, 55, 50. Today's own Strain is left out. Folded day by day, the base comes to 47.9.",
          "Today's Recovery is 72%, so the centre is 47.9 × 1.13 = 54.2. The range runs from 54.2 − 8.6 to 54.2 + 24.4: a target of 46 - 79%. With the same history and a Recovery of 30%, the centre drops to 42.2 and the target to 36 - 58%.",
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "With fewer than 14\u00a0days of Strain the base folds what there is, so the first weeks read as an estimate. The target does not know your training plan, races or injuries. It is a guide, not a prescription.",
        ],
      },
    ],
  },
  {
    slug: "sleep",
    name: "Sleep Performance",
    summary: "How well last night’s sleep met your need, from 0 to 100%.",
    href: "/sleep",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Time asleep", detail: "Your main sleep against tonight’s sleep need. Naps are not counted here." },
          { term: "Deep sleep", detail: "Deep sleep as a share of your need." },
          { term: "REM sleep", detail: "REM sleep as a share of your need." },
          { term: "Heart-rate dip", detail: "How far your heart rate fell while asleep, against your daytime resting level." },
          { term: "Efficiency", detail: "Time asleep as a share of time in bed." },
          { term: "Continuity", detail: "How few times you woke during the night." },
        ],
        paragraphs: [
          "Your sleep need is a 7.5-hour goal, plus a little more after a day of higher Strain than usual (2% for each spread above your 30-day average), plus a quarter of your sleep debt.",
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Each part is scored against its target and capped at full marks; parts close to their target score nearly full, parts well short drop off steeply. Deep, REM and heart-dip targets depend on your age and sex.",
        ],
        rows: [
          { term: "Time asleep, 35%", detail: "Full marks at 100% of your need." },
          { term: "Deep sleep, 20%", detail: "Full marks at about 15% of your need, less with age." },
          { term: "REM sleep, 20%", detail: "Full marks at 20% of your need." },
          { term: "Heart-rate dip, 10%", detail: "Full marks at a dip of about 30%, less with age." },
          { term: "Efficiency, 7.5%", detail: "Full marks at 97%; falls off quickly below it." },
          { term: "Continuity, 7.5%", detail: "Full marks up to 5 wake-ups; falls off with each one after." },
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "85-100%", detail: "Optimal" },
          { term: "70-84%", detail: "Sufficient" },
          { term: "0-69%", detail: "Poor" },
        ],
        paragraphs: [
          "The key statistics use their own marks for optimal and sufficient: hours vs. needed 85% and 70%, efficiency 85% and 75%, restorative 40% and 30%, consistency 80% and 70%.",
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Sleep Performance scores the main sleep only, once Fitbit has processed it. A night without stages leaves out deep and REM, and a night without heart rate leaves out the dip; the other parts share their weight. Sleep stages come from a wrist sensor and are an estimate.",
        ],
      },
    ],
  },
  {
    slug: "sleep-planner",
    name: "Sleep Planner",
    summary: "Tonight’s sleep need, and the bedtimes that meet it.",
    href: "/sleep",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Your sleep goal", detail: "7.5 hours a night." },
          { term: "Today’s Strain", detail: "Strain above your 30-day average adds to the need." },
          { term: "Sleep debt", detail: "What your last 7 days’ sleep owes against your goal." },
          { term: "Your recent nights", detail: "Your usual wake time, sleep efficiency and time to fall asleep." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Tonight’s need = 7.5 hours + 2% for each spread today’s Strain sits above your 30-day average + a quarter of your sleep debt.",
          "Sleep debt adds up the last 7 days’ sleep, naps included, less 7.5 hours each, with recent days counting most: last night in full, each day before it about three quarters of the one after. A negative bank is debt; naps pay it down.",
          "Bedtimes count back from your usual wake time on recent weekday or weekend mornings, to match tomorrow, adding the time your usual efficiency and time to fall asleep cost, up to an hour each.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "Peak", detail: "100% of tonight’s need." },
          { term: "Perform", detail: "85% of tonight’s need." },
          { term: "Get by", detail: "70% of tonight’s need." },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "The planner needs a few main sleeps before it gives bedtimes. It assumes tomorrow looks like your recent mornings and cannot see alarms or plans. Strain later today changes tonight’s need. It is a guide, not a prescription.",
        ],
      },
    ],
  },
  {
    slug: "pulse-age",
    name: "Pulse Age",
    summary: "How old your body behaves, and how fast that is changing.",
    href: "/health/healthspan",
    sections: [
      {
        title: "What goes in",
        paragraphs: ["Nine habits and vitals over the 28 days ending each Sunday, each against a reference for a healthy person of your age and sex."],
        rows: [
          { term: "Sleep hours", detail: "Reference 7.5 hours; much shorter or longer costs years." },
          { term: "Sleep consistency", detail: "Reference 70." },
          { term: "Steps", detail: "Reference 8,000 a day, 6,000 from 60." },
          { term: "Heart rate zones 2-3", detail: "Reference 150 minutes a week." },
          { term: "Heart rate zones 4-5", detail: "Reference 10 minutes a week." },
          { term: "Strength activity", detail: "Reference 10 minutes a week." },
          { term: "Resting heart rate", detail: "Reference from a table for your age and sex." },
          { term: "VO2 max", detail: "Fitbit’s readings. Reference from a table for your age and sex." },
          { term: "Lean body mass", detail: "100 less your body fat %. Reference: 100 less the typical body fat for your age and sex." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Each factor maps to a change in mortality risk against its reference, and that change becomes years: 10 × the natural log of the risk ratio. At the reference a factor adds nothing; better takes years off, worse adds them. The factors present are scaled up to stand for all nine.",
          "Pace of Aging is your Pulse Age divided by your age, from 0.6x to 1.6x.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "Younger than your age", detail: "Your factors beat the reference on balance." },
          { term: "Older than your age", detail: "They fall short of it." },
          { term: "Pace below 1.0x", detail: "Your body behaves younger than your age." },
          { term: "Pace above 1.0x", detail: "It behaves older." },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Time in zones is counted by Pulse from your heart rate, on the same five zones as Strain, and weekly minutes are your 28-day total divided by four. Pulse Age needs 5 of the 9 factors and updates each Sunday. It rests on population studies, not a clinical test of your body.",
        ],
      },
    ],
  },
  {
    slug: "stress",
    name: "Stress Monitor",
    summary: "How hard your body is working while you are not exercising, from 0 to 100.",
    href: "/health/stress",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Heart rate", detail: "Each 6-minute stretch of the day." },
          { term: "Heart rate variability", detail: "At night Fitbit writes HRV every 5 minutes; the latest reading within 36 minutes counts." },
          { term: "Workouts and exercise", detail: "Left out: stress is not shown while you exercise." },
          { term: "Your baselines", detail: "Your awake heart rate over the last 30 days, and your 30-day HRV." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Each 6-minute stretch’s heart rate is placed among your awake heart rates of the last 30 days: the higher it ranks, the higher the stress. Where an HRV reading counts, 40% of the score comes from it instead, against your 30-day HRV: lower than usual reads as more stress. Today Pulse shows the latest reading; past days show the day’s average.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "0-29", detail: "Low: calm." },
          { term: "30-59", detail: "Medium: more active than your calm level." },
          { term: "60-100", detail: "High: well above your usual heart rate while you are not exercising." },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Stress needs 5 days of data and is Provisional until your data spans 30 days. It reads heart rate and HRV, so caffeine, heat, illness or walking about raise it too. It is not a measure of how you feel.",
        ],
      },
    ],
  },
  {
    slug: "energy-bank",
    name: "Energy Bank",
    summary: "An estimate of how much energy you have in reserve, 1 to 100%.",
    href: "/",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Sleep", detail: "Charges the bank." },
          { term: "Stress", detail: "Each 6-minute stretch’s stress, as in the Stress Monitor: calm time charges a little, higher stress drains." },
          { term: "Workouts", detail: "Drain through the stress your heart rate shows." },
          { term: "Yesterday", detail: "The level carries across midnight; it does not restart each morning." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: ["Every 6 minutes the bank moves one step:"],
        rows: [
          { term: "Asleep", detail: "A full 7.5-hour night charges about 80 points." },
          { term: "Awake and calm", detail: "Stress under 20 charges about 15 points over a full waking day." },
          { term: "Awake and stressed", detail: "Stress of 20 or more drains, faster the higher it is: about 60 points over a full waking day at the base rate." },
          { term: "Near the ends", detail: "Charging slows near 100 and draining slows near 1." },
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "67-100%", detail: "Plenty in reserve." },
          { term: "34-66%", detail: "Pace yourself." },
          { term: "1-33%", detail: "Running low." },
        ],
        paragraphs: ["The three biggest drains are listed by name."],
      },
      {
        title: "Limits",
        paragraphs: [
          "Energy Bank runs from your first day but shows from the eighth, once it has settled; until then it is calibrating. It is a model, not a measurement: it cannot see mental effort that leaves heart rate unchanged, food or caffeine.",
        ],
      },
    ],
  },
  {
    slug: "health-monitor",
    name: "Health Monitor",
    summary: "Last night’s vitals against your own normal ranges.",
    href: "/health/monitor",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Resting heart rate", detail: "Your mean heart rate while you slept, in bpm." },
          { term: "Heart rate variability", detail: "The mean of Fitbit’s HRV readings while you slept, in ms." },
          { term: "Respiratory rate", detail: "Breaths per minute asleep, in rpm." },
          { term: "Skin temperature", detail: "Last night against your skin-temperature baseline, in degrees." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "For every vital, your normal range is the average of your last 30 nights, last night included, ± one standard deviation. A value inside it is within range; below or above it is low or elevated.",
          "The illness signal compares resting heart rate, HRV, skin temperature and respiratory rate with your 30 nights before. A vital fires at 2 standard deviations in the unwell direction and adds 22 points per extra deviation, up to 40. With at least 2 vitals firing, 25 points is mild and 50 is raised. If you logged alcohol, sauna or travel the day before, Pulse takes that as the likely cause instead.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "Within range", detail: "Inside your normal range." },
          { term: "Elevated or Low", detail: "Outside it; the chip names the bound you crossed." },
          { term: "Illness signal", detail: "Several vitals moved together, a pattern often seen early in illness." },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "A one-standard-deviation range is narrow on purpose: about a third of ordinary nights fall outside it, so one flagged vital on its own is common. The illness signal stays quiet until 14 of your last 30 nights have resting heart rate or HRV. A flagged vital is a prompt to notice, not a diagnosis.",
        ],
      },
    ],
  },
  {
    slug: "fitness",
    name: "Fitness level",
    summary: "Your VO2 max compared with people of your age and sex.",
    href: "/health/fitness",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "VO2 max", detail: "Your latest run value from the last 90\u00a0days; otherwise Fitbit’s latest daily estimate, marked Provisional." },
          { term: "Age and reference ranges", detail: "From your profile." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Pulse places your VO2 max in the FRIEND reference table (Kaminsky 2015): lab treadmill tests from 7,783 adults without heart disease, by sex and age decade. It reads between the published percentiles and keeps the result between the 5th and the 95th. Under 20 uses the 20-29 row; 80 and over uses 70-79. A man of 35 at 45.0\u00a0ml/kg/min sits just under the 60th percentile: Good.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "80th percentile and up", detail: "Superior" },
          { term: "60th-79th", detail: "Excellent" },
          { term: "40th-59th", detail: "Good" },
          { term: "20th-39th", detail: "Fair" },
          { term: "Below the 20th", detail: "Poor" },
        ],
      },
      {
        title: "A worked example",
        paragraphs: [
          "Take a woman of 52 whose Fitbit reports a VO2 max of 30 ml/kg/min from a recent run. Pulse picks the FRIEND treadmill row for women aged 50 to 59. That row reads 27.6 at the 75th percentile and 32.0 at the 90th.",
          "Her 30 sits between those two columns. Pulse reads linearly between them: it is 2.4 above the 75th-percentile value, out of a 4.4 gap, and the gap spans 15 percentile points. So the percentile is 75 plus 15 times 2.4 divided by 4.4, which is 83.2. Pulse shows it as the 83rd percentile.",
          "The bands are cut at the 20th, 40th, 60th and 80th percentiles, so 83.2 lands in Superior. Running Pulse's fitness level function on 30, age 52 and female returns exactly that.",
          "For comparison, a man of 35 with a VO2 max of 45 sits between the 50th and 75th columns of his row (42.4 and 49.2). That gives 59.6, just under the 60 cut-off, so he is Good rather than Excellent. The same VO2 max is a different percentile at a different age or sex, which is the point of the table. A value below the 5th-percentile column is shown as 5 and one above the 95th as 95, because the table does not resolve the tails.",
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Fitbit’s VO2 max is an estimate, while the table is lab-measured, so treat the percentile as approximate. The 2015 table runs 1.5-4.6\u00a0ml/kg/min higher than its 2022 update, so you may place a little low. The same table’s 75th percentile is the VO2 max reference in Pulse Age.",
        ],
      },
    ],
  },
  {
    slug: "training-balance",
    name: "Training balance",
    summary: "Whether your recent training load is above or below what you are used to.",
    href: "/health/fitness",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Fitness and Fatigue", detail: "Your long-term and short-term load from your recorded workouts’ heart rate (see Fitness, fatigue and form)." },
          { term: "Today’s Recovery", detail: "Tells Pushing from a productive block." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Training load is Fatigue divided by Fitness: about a week of load against about three weeks. 1.00 means this week matches your usual. Pulse also checks whether Fitness is rising or falling: its average over the last 5\u00a0days against the 5\u00a0days before.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "Detraining", detail: "1.00 or below, with Fitness down more than 5%: load dropped below your usual." },
          { term: "Optimal", detail: "1.00 or below with Fitness holding or rising, or up to 1.40 with Recovery of 20% or more." },
          { term: "Pushing", detail: "Above 1.00 while Recovery is under 20%: load is outrunning your recovery." },
          { term: "High risk", detail: "Above 1.40: load jumped well above your usual." },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Training load needs workouts on about 10 of the last 42\u00a0days, a few of them in the last two weeks; until then it is calibrating. Fitness starts from zero, so the ratio reads high in your first weeks. It compares you with yourself, so it says nothing about whether your usual load suits your goals.",
        ],
      },
    ],
  },
  {
    slug: "journal-impact",
    name: "Behaviour insights",
    summary: "How each behaviour you log goes with your next day’s scores.",
    href: "/journal/insights",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Journal check-ins", detail: "Each behaviour you answered yes or no, over the last 90\u00a0days." },
          { term: "Next-day scores", detail: "The next morning’s Recovery and HRV, and that night’s Sleep Performance." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "For each behaviour, Pulse compares the days you answered yes with the days you answered no: the difference in average next-day score. HRV shows as the change in standard deviations from your baseline. To see how sure that difference is, Pulse runs a t-test on the two groups of days and keeps a 70% interval around the difference.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "Positive or negative", detail: "That whole 70% interval sits above or below zero: a clear effect." },
          { term: "No clear effect", detail: "The interval crosses zero." },
          { term: "Needs more data", detail: "Fewer than 5 yes days or 5 no days." },
        ],
      },
      {
        title: "A worked example",
        paragraphs: [
          "Say someone logs alcohol for a month. Over 29 days they answer yes on 8 and no on 21. Pulse pairs each answer with the next morning's Recovery, because the question is what the day after looks like.",
          "On the 21 no days, next-morning Recovery averages higher than after the 8 yes days. The difference of the two averages, yes minus no, comes out at minus 11.6 points: on the day after alcohol, Recovery was about 12 points lower.",
          "That difference alone could be luck, so Pulse tests it. From how much Recovery varies within the yes days and within the no days, a t-test puts a 70% interval around the difference. For this data the whole interval sits well below zero.",
          "So the label is Negative, a clear effect. Had the interval run from, say, minus 4 to plus 6, the label would be No clear effect. Had there been only 4 yes days, Pulse would say Needs more data, because it needs at least 5 yes and 5 no days. The difference comes from running Pulse's behaviour insights function on 29 check-ins and 30 daily Recovery scores. It shows an association, not proof of cause.",
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "This is an association, not proof of cause. It does not adjust for other behaviours or training, so a tag you tend to log on hard days can look harmful. A 70% interval is loose on purpose: about 3 in 10 behaviours with no real effect will still show a clear one by chance. Days without an answer are left out.",
        ],
      },
    ],
  },
  {
    slug: "sleep-consistency",
    name: "Sleep consistency",
    summary: "How closely the times you are asleep repeat from day to day.",
    href: "/sleep",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Sleep sessions", detail: "Main sleeps and naps, minute by minute, for up to the last 7 days." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Pulse lays each day’s asleep minutes on the 1,440 minutes of the clock and checks, minute by minute, how many pairs of days agree: both asleep or both awake. The share that agree is the score, from 0 to 100: 100 means the same sleep times every day.",
          "It is one of the inputs to Pulse Age.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "80-100%", detail: "Optimal" },
          { term: "70-79%", detail: "Sufficient" },
          { term: "0-69%", detail: "Poor" },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "It needs at least 2 days with sleep in the window; otherwise there is no value. It rewards timing, not duration: two nights two hours late lower it even with the same total sleep. Fitbit’s sleep sessions leave out brief wakes, so this reads somewhat higher than a lab measure.",
        ],
      },
    ],
  },
  {
    slug: "training-load",
    name: "Fitness, fatigue and form",
    summary: "Your long-term and short-term training load, and the gap between them.",
    href: "/health/fitness",
    sections: [
      {
        title: "What goes in",
        paragraphs: [
          "Training Load: each day's training impulse (TRIMP), summed over its recorded workouts from their heart rate against your 60-day resting baseline. A day without a workout counts as 0.",
        ],
      },
      {
        title: "How it is weighted",
        rows: [
          { term: "Fitness", detail: "Each day keeps 41/43 of yesterday's value and adds 2/43 of the day's load: about a three-week average." },
          { term: "Fatigue", detail: "Each day keeps 3/4 of yesterday's value and adds 1/4 of the day's load: about a week." },
          { term: "Form", detail: "Fitness minus Fatigue." },
        ],
        paragraphs: ["Both start from zero."],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "Form above 0", detail: "Your recent load is lighter than your longer-term load: you are fresher." },
          { term: "Form below 0", detail: "You are carrying fatigue from recent training." },
        ],
      },
      {
        title: "A worked example",
        paragraphs: [
          "Take 14 days of daily load: 30, 45, 0, 50, 40, 35, 55, then 45, 60, 0, 50, 55, 40, 65. The zeros are rest days.",
          "Fatigue moves a quarter of the way to each day's load, so it ends at 47.0 after the 65 on day 14. Fitness moves 2/43 of the way, so it has only reached 20.4. Form is Fitness minus Fatigue: 20.4 - 47.0 = -26.6.",
          "A negative Form means recent load is heavier than the longer-term average. Fitness only settles after several weeks, so read the first few weeks as a rough guide.",
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Heart rate is its only input, so load that barely raises heart rate is missed. Until you have trained regularly for a few weeks the status shows as calibrating.",
        ],
      },
    ],
  },
  {
    slug: "hr-recovery",
    name: "Heart rate recovery",
    summary: "How far your heart rate drops within 2 minutes as a workout ends.",
    href: null,
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Heart rate", detail: "Every reading from the start of the workout to 2\u00a0minutes after it ends." },
          { term: "Zones", detail: "Your zones on max heart rate: zone 4 starts at 80%." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Heart rate recovery = the largest drop between two readings at most 2\u00a0minutes apart, where the first is taken before the workout ends, in bpm. It is measured only when the workout reached zone 4.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "20\u00a0bpm or more", detail: "Good" },
          { term: "12-19 bpm", detail: "Typical" },
          { term: "Below 12\u00a0bpm", detail: "Low" },
        ],
      },
      {
        title: "A worked example",
        paragraphs: [
          "Take a 36-year-old finishing a steady run. Pulse's default max heart rate for that age is 220 − 36 = 184 bpm, so zone 4 starts at 148 bpm. The run reaches 174 bpm, so the workout counts.",
          "Pulse looks at every pair of readings at most 2 minutes apart whose first reading falls before the end. The highest early reading is 174 bpm in the final sprint; the lowest within 2 minutes of it is 149 bpm.",
          "Heart rate recovery is 174 minus 149, so 25 bpm. That is 20 or more, which Pulse calls Good. If the runner had kept jogging and the lowest reading had been 160, the drop would be 14 bpm, which is Typical. A workout that never reaches zone 4 shows Not enough heart-rate data instead of a guess.",
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "It needs dense heart rate around the end of the activity, which Fitbit does not always record; otherwise it shows Not enough heart-rate data. Moving about in those 2 minutes, or stopping the activity late, lowers the drop. Compare it across similar workouts, not between different sports.",
        ],
      },
    ],
  },
  {
    slug: "hrv-status",
    name: "HRV Status",
    summary: "Your 7-day HRV against your usual range, in Garmin’s manner.",
    href: "/health",
    sections: [
      {
        title: "What goes in",
        paragraphs: ["Fitbit’s nightly HRV (RMSSD, in ms), one value a night."],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Pulse averages the natural log of your HRV over the last 7\u00a0nights (it needs 4 of them) and compares it with the mean and spread of the 60\u00a0nights before. Your usual range is the mean ± 0.75 of a spread; the Low line is 1.5 spreads under the mean. The log scale is the one HRV research uses, so a night twice your usual counts as much above as half your usual counts below.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "Balanced", detail: "Your 7-day average is in your usual range." },
          { term: "Unbalanced", detail: "Above your usual range, or a little below it." },
          { term: "Low", detail: "Well below your usual range: often strain, illness or poor sleep." },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "It needs 21\u00a0nights of HRV first. Garmin reads HRV across the whole night from its own sensor and adds a Poor status when your range is low for your age; Pulse uses Fitbit’s nightly value and leaves Poor out until it has a published age norm. The spread and the 0.75 and 1.5 lines are Pulse’s choices: Garmin doesn’t publish its own. This is Pulse’s implementation of Garmin’s published idea, not Garmin’s number.",
        ],
      },
    ],
  },
  {
    slug: "training-readiness",
    name: "Training Readiness",
    summary: "How ready you are for hard training today, from 1 to 100.",
    href: "/strain",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Last night’s sleep", detail: "Sleep Performance." },
          { term: "Recovery time", detail: "Hours left before your next hard session (below)." },
          { term: "HRV Status", detail: "Balanced, Unbalanced above or below, or Low." },
          { term: "Load ratio", detail: "Garmin’s acute against chronic load." },
          { term: "Sleep history", detail: "Sleep Performance over the last 3\u00a0nights." },
          { term: "Stress history", detail: "Your average awake stress over the last 3\u00a0days." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Each factor is scored 0 to 100: recovery time as 100 × (1 − hours ÷ 72)^1.3; HRV Balanced 100, Unbalanced above 75, below 55, Low 25; load ratio 100 from 0.8 to 1.5, falling to 30 at 2.0, and 90 under 0.8; stress 100 less 50 for each point of average stress above 0.75.",
          "Readiness = 25% sleep + 25% recovery time + 15% HRV + 15% load + 10% sleep history + 10% stress history, a missing factor’s weight shared among the rest. It is never more than the weakest factor + 30, and a day of more than 18\u00a0hours awake before last night’s sleep takes 10 off.",
          "Recovery time: each workout adds 72 × ((Training Effect − 1) ÷ 4)^2.32 hours (about 24 at 3.5, 72 at 5); on top of time left, the larger plus a quarter of the smaller, up to 96, and 15% more with a load ratio of 1.5 or more. It counts down an hour an hour, 1.4 asleep after a night of 85% or better, 0.7 in a stressed hour or after a night under 70%.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "95-100", detail: "Prime" },
          { term: "75-94", detail: "High" },
          { term: "50-74", detail: "Moderate" },
          { term: "25-49", detail: "Low" },
          { term: "1-24", detail: "Poor" },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Garmin publishes the factors, that sleep and recovery time count most, and the bands; it doesn’t publish weights or recovery-time constants, so these are Pulse’s, fitted to Garmin’s published recovery-time table. It is set at wake and drops after training. It needs a scored night and three of its factors. It is a guide for today’s training, not a medical reading.",
        ],
      },
    ],
  },
  {
    slug: "training-effect",
    name: "Training Effect",
    summary: "How much a workout improves your aerobic fitness, from 0 to 5.",
    href: null,
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Heart rate in the workout", detail: "As a share of your heart-rate reserve, turned into a share of your VO2 max." },
          { term: "VO2 max", detail: "Fitbit’s or a measured one from the last 90\u00a0days; else Uth’s estimate, 15.3 × max ÷ resting heart rate." },
          { term: "Your training background", detail: "An activity class from 0 to 10: from your VO2 max, age, BMI and sex (Jackson 1990), or from your weekly workout hours over the last 4\u00a0weeks, whichever is higher." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Pulse estimates the workout’s EPOC, the extra oxygen your body uses afterwards to recover, second by second: it rises with intensity and fades when you ease off, on curves fitted to Firstbeat’s published figures (an hour at 70% of VO2 max is about 137\u00a0ml/kg). The peak is compared with the EPOC that makes each Training Effect level for your activity class (Firstbeat’s published lines), linearly between them.",
          "The main benefit comes from the effect and your time by share of max heart rate: Recovery under 2; VO2 max at 4 or more with over 10\u00a0minutes above 90%; Threshold when most of it was at 80% or more; Tempo when a quarter or more was; else Base.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "0-0.9", detail: "No benefit" },
          { term: "1.0-1.9", detail: "Minor" },
          { term: "2.0-2.9", detail: "Maintaining" },
          { term: "3.0-3.9", detail: "Improving" },
          { term: "4.0-4.9", detail: "Highly improving" },
          { term: "5.0", detail: "Overreaching" },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "Garmin estimates EPOC with beat-to-beat data and unpublished constants; Pulse’s comes from heart rate alone, so read it as an estimate. There is no anaerobic Training Effect, which needs pace or power. A workout without enough heart rate has none. This is Pulse’s implementation of Garmin’s published method, not Garmin’s number.",
        ],
      },
    ],
  },
  {
    slug: "training-status",
    name: "Training Status",
    summary: "What your recent training is doing to your fitness.",
    href: "/strain",
    sections: [
      {
        title: "What goes in",
        rows: [
          { term: "Load ratio", detail: "Garmin’s acute against chronic load, and whether the acute load is falling (under 90% of a week ago)." },
          { term: "VO2 max trend", detail: "Fitbit’s VO2 max over the last 28\u00a0days, recent days weighted more, as a change a month." },
          { term: "HRV Status", detail: "Today’s, and the last 3\u00a0days’." },
        ],
      },
      {
        title: "How it is weighted",
        paragraphs: [
          "Rules, in order, the first that fits: Detraining, acute load under 20% of your 12-week median for 7\u00a0days; Strained, HRV Low, or Unbalanced below for 3\u00a0days, at a ratio of 0.8 or more; Overreaching, a ratio of 1.5 or more with VO2 max falling 1.5 a month or more or HRV Low; Recovery, a ratio under 0.8 and load falling; Peaking, VO2 max rising 1.5 a month or more while load falls; Productive, a ratio from 0.8 to 1.5 with VO2 max rising, or HRV Balanced at 1.0 or more; Unproductive, that ratio with VO2 max falling; otherwise Maintaining.",
        ],
      },
      {
        title: "What the bands mean",
        rows: [
          { term: "Productive, Peaking", detail: "Training is paying off." },
          { term: "Maintaining, Recovery", detail: "Holding fitness, or recovering for more." },
          { term: "Unproductive, Strained, Detraining", detail: "Something is off: recovery, or too little load." },
          { term: "Overreaching", detail: "Load is high enough to cost you. Ease off." },
        ],
      },
      {
        title: "Limits",
        paragraphs: [
          "It needs about 3\u00a0weeks of training data and a VO2 max or an HRV Status. Fitbit’s VO2 max is an estimate that moves slowly, so Pulse reads its trend over 28\u00a0days rather than Garmin’s 14. Garmin’s Paused status (time off for illness or injury) isn’t detected. This is Pulse’s implementation of the rules in Firstbeat’s published patent, not Garmin’s number.",
        ],
      },
    ],
  },
]
