// Info-card copy for the screens (spec §7.2, §7.3, §7.5, §7.15). Final copy: do not reword. The three score cards
// end with SOURCE_NOTE. Ported from pulse src/app/(app)/_lib/info.tsx: the words are the web's; <P>
// is a paragraph <Text> styled as the info card's body, the swatch rows are Views.
import type { ReactNode } from "react"
import { View } from "react-native"
import { Text } from "@/ui/Text"
import type { InfoContent } from "@/ui/shells/InfoButton"

/** A paragraph of an info card's body (the web card's 15/22 text). */
function P({ children }: { children: ReactNode }) {
  return <Text className="text-[15px] leading-[22px] text-foreground-body">{children}</Text>
}

function Rows({ rows }: { rows: [swatch: string | null, text: string][] }) {
  return (
    <View className="gap-2">
      {rows.map(([swatch, text]) => (
        <View key={text} className="flex-row items-start gap-2.5">
          {!!swatch && <View accessibilityElementsHidden className={`mt-1.5 size-2.5 shrink-0 rounded-sm ${swatch}`} />}
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
        Recovery shows how ready your body is to take on strain, from 1 to 100%. Pulse scores it each morning from last night’s heart rate
        variability (40%), resting heart rate (30%) and Sleep Performance (30%), the first two against your last 60{"\u00a0"}days. Breathing faster than usual,
        or running warm, lowers it.
      </P>
      <Rows
        rows={[
          ["bg-recovery-green", "Green, 67-100%: your body is primed for strain."],
          ["bg-recovery-yellow", "Yellow, 34-66%: you are maintaining; moderate strain fits."],
          ["bg-recovery-red", "Red, 1-33%: your body needs rest."],
        ]}
      />
      <P>
        Recovery shows from your second night and stays provisional until your data spans 60{"\u00a0"}days. A night without HRV, heart rate or
        processed sleep gets no score rather than a guess.
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
        Strain is the load of your day as a percent: 0 to 100 on most days, above 100 on a very big day. It builds from the time you spend
        in higher heart-rate zones and the steps you take while awake, and each point is harder to earn than the last.
      </P>
      <Rows
        rows={[
          [null, "Light: up to 40%"],
          [null, "Moderate: 41 - 60%"],
          [null, "Strenuous: 61 - 79%"],
          [null, "All Out: 80% and above"],
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
      Your Strain Target is a range for today, set from your Recovery and your Strain over the last 14{"\u00a0"}days. Inside it, training builds
      fitness without digging a recovery hole.
    </P>
  ),
}

export const SLEEP_INFO: InfoContent = {
  title: "How Sleep works",
  body: (
    <>
      <P>
        Sleep Performance scores last night against your need from six parts: time asleep, deep and REM sleep, how far your heart rate dipped,
        efficiency and how rarely you woke. Your need is a 7.5-hour goal, plus a little more after a harder day than usual, plus a quarter of
        your sleep debt.
      </P>
      <P>
        Sleep debt comes from the last 7{"\u00a0"}days’ sleep, naps included, against 7.5{"\u00a0"}hours each, recent nights counting most.
        Sleep consistency is how closely the times you are asleep agree across those days.
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
        Energy Bank estimates how much energy you have in reserve, from 1 to 100. Sleep charges it, calm awake time charges it a little, and
        stress, including the stress of a workout, drains it. The level carries over from one day to the next, and shows from your eighth day.
        It is an estimate, not a measurement.
      </P>
      <Rows
        rows={[
          ["bg-recovery-green", "67-100: plenty in reserve."],
          ["bg-recovery-yellow", "34-66: pace yourself."],
          ["bg-recovery-red", "1-33: running low."],
        ]}
      />
    </>
  ),
}

export const STRAIN_RECOVERY_INFO: InfoContent = {
  title: "Strain & recovery",
  body: (
    <>
      <P>Your last 7{"\u00a0"}days side by side: Day Strain in blue on the left scale, from 0 to 100%, and Recovery on the right scale, from 0 to 100%.</P>
      <P>High strain on one day often shows up as lower Recovery the next morning. Days without a score are left as gaps.</P>
    </>
  ),
}

/** "Add activity" (Home's card button and the "+" menu): Pulse imports workouts, so this explains where they come from (§11 R2). */
export const ADD_ACTIVITY_INFO: InfoContent = {
  title: "Add an activity",
  body: (
    <>
      <P>Pulse reads your workouts from Fitbit through Health Connect, so it cannot add one here.</P>
      <P>Start or log the workout in the Fitbit app. It appears in your activities after the next sync, with its Strain.</P>
    </>
  ),
}
