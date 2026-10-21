// Info-card copy for the screens (spec §7.2, §7.3, §7.5, §7.15). Final copy: do not reword. The three score cards
// end with SOURCE_NOTE. Ported from pulse src/app/(app)/_lib/info.tsx: the words are the web's; <P>
// is a paragraph <Text> styled as the info card's body, the swatch rows are Views.
import type { ReactNode } from "react"
import { View } from "react-native"
import { i18n } from "@/i18n/config"
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

const t = (k: string) => i18n.t(`ui:infoCards.${k}` as never) as string

/** Under each score's explainer: these are Pulse's own scores, not the reference app's (brand guidelines audit). */
const SourceNote = () => <Text className="text-[13px] leading-[18px] text-muted-foreground">{t("sourceNote")}</Text>

// Each card is an object of getters, so the text resolves when the card opens, in the language then in use.
export const RECOVERY_INFO: InfoContent = {
  get title() { return t("recoveryTitle") },
  get body() {
    return (
      <>
        <P>{t("recoveryIntro")}</P>
        <Rows rows={[["bg-recovery-green", t("recoveryGreen")], ["bg-recovery-yellow", t("recoveryYellow")], ["bg-recovery-red", t("recoveryRed")]]} />
        <P>{t("recoveryNote")}</P>
        <SourceNote />
      </>
    )
  },
}

export const STRAIN_INFO: InfoContent = {
  get title() { return t("strainTitle") },
  get body() {
    return (
      <>
        <P>{t("strainIntro")}</P>
        <Rows rows={[[null, t("strainLight")], [null, t("strainModerate")], [null, t("strainStrenuous")], [null, t("strainAllOut")]]} />
        <P>{t("strainNote")}</P>
        <SourceNote />
      </>
    )
  },
}

export const STRAIN_TARGET_INFO: InfoContent = {
  get title() { return t("strainTargetTitle") },
  get body() { return <P>{t("strainTargetBody")}</P> },
}

export const SLEEP_INFO: InfoContent = {
  get title() { return t("sleepTitle") },
  get body() {
    return (
      <>
        <P>{t("sleepIntro")}</P>
        <P>{t("sleepDebt")}</P>
        <SourceNote />
      </>
    )
  },
}

export const TONIGHT_INFO: InfoContent = {
  get title() { return t("tonightTitle") },
  get body() { return <P>{t("tonightBody")}</P> },
}

export const ENERGY_INFO: InfoContent = {
  get title() { return t("energyTitle") },
  get body() {
    return (
      <>
        <P>{t("energyIntro")}</P>
        <Rows rows={[["bg-recovery-green", t("energyHigh")], ["bg-recovery-yellow", t("energyMid")], ["bg-recovery-red", t("energyLow")]]} />
      </>
    )
  },
}

export const STRAIN_RECOVERY_INFO: InfoContent = {
  get title() { return t("strainRecoveryTitle") },
  get body() {
    return (
      <>
        <P>{t("strainRecovery1")}</P>
        <P>{t("strainRecovery2")}</P>
      </>
    )
  },
}

/** "Add activity" (Home's card button and the "+" menu): Pulse imports workouts, so this explains where they come from (§11 R2). */
export const ADD_ACTIVITY_INFO: InfoContent = {
  get title() { return t("addActivityTitle") },
  get body() {
    return (
      <>
        <P>{t("addActivity1")}</P>
        <P>{t("addActivity2")}</P>
      </>
    )
  },
}
