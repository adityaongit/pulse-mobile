// Small pieces the Recovery, Strain and Activity screens share (src/screens/{recovery,strain,activity}).
import { Children, Fragment, type ReactNode } from "react"
import { View } from "react-native"
import { CircleAlert } from "lucide-react-native"
import { Card } from "@/ui/Card"
import { InsightCardSkeleton } from "@/ui/metrics/InsightCard"
import { KeyStatRowSkeleton } from "@/ui/metrics/KeyStatRow"
import { ScoreDialSkeleton } from "@/ui/metrics/ScoreDial"
import { Text } from "@/ui/Text"
import { DetailShell } from "@/ui/shells/DetailShell"
import { EmptyState } from "@/ui/shells/EmptyState"
import { LEGEND } from "@/screens/_lib/view"

/** The web's `divide-y divide-border`: a hairline between neighbouring children. */
export function Divided({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <View className="h-px bg-border" />}
          {child}
        </Fragment>
      ))}
    </>
  )
}

/** pulse's (app)/error.tsx: every screen's error view, with a retry that runs the query again. */
export function ScreenError({ retry }: { retry: () => void }) {
  return <DetailShell title="Pulse" primary={<View accessibilityRole="alert" className="pt-16"><EmptyState icon={CircleAlert} body="Couldn’t load this screen." action={{ label: "Try again", onClick: retry }} /></View>} />
}

/**
 * Weekly Trends (the closing stack of Recovery and Strain, spec §11 R32). Its chart (`TrendViewChart`) and its data
 * (`getWeeklyTrends`, trendView.ts) belong to the Trends stream and are not on this branch, so nothing is drawn here yet.
 * When they land, replace these two with the Trends stream's <WeeklyTrends cards d today /> and its skeleton; the
 * screens already pass the day, today and the web's card keys.
 */
export const WEEKLY_RECOVERY = ["recovery", "hrv", "rhr", "resp", "sleep"] as const
export const WEEKLY_STRAIN = ["strain", "zones13", "zones45", "steps", "calories", "strength"] as const
export function WeeklyTrendsSlot(_: { keys: readonly string[]; d: string; today: string }): ReactNode {
  return null
}
export function WeeklyTrendsSlotSkeleton(_: { titles: string[] }): ReactNode {
  return null
}

/** The summary card's padding: the web's `px-4 py-1` (the kit's Card pads `py-4`, and a class cannot override a class, so the style does). */
export const SUMMARY_CARD_STYLE = { paddingVertical: 4 } as const

/** Recovery and Strain's loading shape (pulse's skeletons.tsx `DialDetail`): the dial, the notched summary card, the insight card, then the page's own cards. */
export function DialDetailSkeleton({
  title,
  dial,
  labels,
  legend,
  primary,
  secondary,
  footer,
}: {
  title: string
  dial: "recovery" | "strain"
  labels: string[]
  legend: string
  primary?: ReactNode
  secondary?: ReactNode[]
  footer?: ReactNode
}) {
  return (
    <DetailShell
      loading
      footer={footer}
      title={title}
      dateSwitcher={{ mode: "day", placement: "header", steppers: false }}
      notch
      hero={<ScoreDialSkeleton size="lg" variant={dial} />}
      summary={
        <Card accessibilityElementsHidden className="px-4" style={SUMMARY_CARD_STYLE}>
          <Divided>
            {labels.map((l) => (
              <KeyStatRowSkeleton key={l} variant="row" label={l} />
            ))}
          </Divided>
          <Text className={LEGEND}>{legend}</Text>
        </Card>
      }
      insight={<InsightCardSkeleton action />}
      primary={primary}
      secondary={secondary}
    />
  )
}
