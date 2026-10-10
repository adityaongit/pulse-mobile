// Info-card copy for the screens (spec §7.2, §7.3, §7.5, §7.15). Final copy: do not reword. The three score cards
// end with SOURCE_NOTE (user, 2026-10-04). Ported from pulse src/app/(app)/_lib/info.tsx: the words are the web's; <P>
// is a paragraph <Text> styled as the info card's body, the swatch rows are Views.
import type { ReactNode } from "react"
import { View } from "react-native"
import { Text } from "@/ui/Text"
import type { InfoContent } from "@/ui/shells/InfoButton"

/** A paragraph of an info card's body (the web card's 15/22 text). */
function P({ children }: { children: ReactNode }) {
  return <Text className="text-[15px] leading-[22px] text-foreground/85">{children}</Text>
}

function Rows({ rows }: { rows: [swatch: string | null, text: string][] }) {
  return (
    <View className="gap-2">
      {rows.map(([swatch, text]) => (
        <View key={text} className="flex-row items-start gap-2.5">
          {swatch && <View accessibilityElementsHidden className={`mt-1.5 size-2.5 shrink-0 rounded-sm ${swatch}`} />}
          <View className="flex-1"><P>{text}</P></View>
        </View>
      ))}
    </View>
  )
}

/** Under each score's explainer: these are Pulse's own scores, not the reference app's (brand guidelines audit). */
const SOURCE_NOTE = <Text className="text-[13px] leading-[18px] text-muted-foreground">Pulse scores, computed from your Fitbit data.</Text>

export const RECOVERY_INFO: InfoContent = {
  title: "How Recovery works",
  body: (
    <>
      <P>
        Recovery shows how ready your body is to take on strain, from 0 to 100%. Pulse scores it each morning from last night’s heart rate
        variability, resting heart rate, respiratory rate, sleep performance and skin temperature, each compared with your own baseline.
      </P>
      <Rows
        rows={[
          ["bg-recovery-green", "Green, 67-100%: your body is primed for strain."],
          ["bg-recovery-yellow", "Yellow, 34-66%: you are maintaining; moderate strain fits."],
          ["bg-recovery-red", "Red, 0-33%: your body needs rest."],
        ]}
      />
      <P>
        Recovery needs 7{"\u00a0"}nights of HRV before the first score and stays provisional until 14. A day without HRV or processed sleep gets no score
        rather than a guess.
      </P>
      {SOURCE_NOTE}
    </>
  ),
}

export const STRAIN_INFO: InfoContent = {
  title: "How Strain works",
  body: (
    <>
      <P>
        Strain measures the cardiovascular load of your day on a 0 to 21 scale, from the time you spend at higher heart rates. The scale is
        non-linear: each point is harder to earn than the last.
      </P>
      <Rows
        rows={[
          [null, "Light: up to 10.0"],
          [null, "Moderate: 10.1 - 14.0"],
          [null, "Strenuous: 14.1 - 18.0"],
          [null, "All Out: 18.1 - 21"],
        ]}
      />
      <P>
        Your Strain Target is a range for today, set from your Recovery and your recent training load. Today’s Strain is a running total
        until midnight.
      </P>
      {SOURCE_NOTE}
    </>
  ),
}

export const STRAIN_TARGET_INFO: InfoContent = {
  title: "Strain Target",
  body: (
    <P>
      Your Strain Target is a range for today, set from your Recovery and your training load over the last 28{"\u00a0"}days. Inside it, training builds
      fitness without digging a recovery hole.
    </P>
  ),
}

export const SLEEP_INFO: InfoContent = {
  title: "How Sleep works",
  body: (
    <>
      <P>
        Sleep Performance compares the sleep you got with the sleep you needed, adjusted for consistency, efficiency and restorative sleep. Your
        need is your personal baseline: the upper quartile of your last 28{"\u00a0"}nights, between 8 and 9.5{"\u00a0"}hours. Strain, sleep debt and naps change
        tonight’s need in the sleep planner, not this score.
      </P>
      <P>
        Sleep consistency is the Sleep Regularity Index: how closely your sleep and wake times match from one day to the next, over the last 7
        days.
      </P>
      {SOURCE_NOTE}
    </>
  ),
}

export const TONIGHT_INFO: InfoContent = {
  title: "Tonight’s sleep",
  body: (
    <P>
      Bedtimes are worked back from your typical wake time and how efficiently you sleep. Peak gets you 100% of tonight’s need, Perform 85%,
      Get by 70%.
    </P>
  ),
}

export const ENERGY_INFO: InfoContent = {
  title: "Energy Bank",
  body: (
    <>
      <P>
        Energy Bank estimates how much energy you have left today, from 0 to 100. It starts each morning from your Recovery and Sleep, drains
        with exertion and stressful stretches, and recharges during calm, still periods and naps. It is an estimate, not a measurement.
      </P>
      <Rows
        rows={[
          ["bg-recovery-green", "67-100: plenty in reserve."],
          ["bg-recovery-yellow", "34-66: pace yourself."],
          ["bg-recovery-red", "0-33: running low."],
        ]}
      />
    </>
  ),
}

export const STRAIN_RECOVERY_INFO: InfoContent = {
  title: "Strain & recovery",
  body: (
    <>
      <P>Your last 7{"\u00a0"}days side by side: Day Strain in blue on the left scale, from 0 to 21, and Recovery on the right scale, from 0 to 100%.</P>
      <P>High strain on one day often shows up as lower Recovery the next morning. Days without a score are left as gaps.</P>
    </>
  ),
}

/** "Add activity" (Home's card button and the "+" menu): Pulse imports workouts, so this explains where they come from (§11 R2). */
export const ADD_ACTIVITY_INFO: InfoContent = {
  title: "Add an activity",
  body: (
    <>
      <P>Pulse reads your workouts from Fitbit through Google Health, so it cannot add one here.</P>
      <P>Start or log the workout in the Fitbit app. It appears in your activities after the next sync, with its Strain.</P>
    </>
  ),
}
