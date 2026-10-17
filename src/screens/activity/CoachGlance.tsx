// activity-01's coach pill: "Analyzing…" while the coach reads the workout, then its one-line take; tapping opens the
// coach and asks about this workout at once, so the full analysis follows without typing the question again. Pinned over the page's foot, clear of the round action. One request per
// workout per app session (kept in memory, as the web keeps it in sessionStorage); a failure hides the pill. With
// Coach settings › Analyze each workout off, no request is made and the pill only offers the question. Ported from pulse
// src/app/(app)/activity/[id]/CoachGlance.tsx.
import { useEffect, useState } from "react"
import { View } from "react-native"
import { ChevronUp } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Mark } from "@/ui/brand"
import { cn } from "@/ui/cn"
import { Glass } from "@/ui/Glass"
import { Gradient } from "@/ui/Gradient"
import { Icon } from "@/ui/Icon"
import { Text } from "@/ui/Text"
import { useTheme } from "@/ui/theme"
import { deviceWorkoutGlance } from "@/coach/session"
import { push } from "@/ui/navigate"
import { Press } from "@/ui/Press";
import { RADIUS } from "@/ui/radius";

const session = new Map<string, string>()

/** Pulse's mark in an indigo ring, as the coach's own empty state draws it. */
function CoachGlyph() {
  const { c } = useTheme()
  return (
    <View accessibilityElementsHidden className="size-7 shrink-0 overflow-hidden rounded-full p-px">
      <Gradient from={c["insight-from"]} to={c["insight-to"]} angle="xy" />
      <View className="flex-1 items-center justify-center rounded-full bg-background">
        <Mark size={14} />
      </View>
    </View>
  )
}

type State = { text: string | null; failed: boolean }

const ASK = "Ask the coach about this workout"

/** `auto` off (Coach settings › Workout analysis): no request as the workout opens; the pill only offers the question. */
export function CoachGlance({ id, question, auto }: { id: string; question: string; auto: boolean }) {
  const [s, setS] = useState<State>({ text: session.get(id) ?? null, failed: false })
  useEffect(() => {
    if (!auto || session.has(id)) return // off, or already in the initial state
    let live = true
    deviceWorkoutGlance(id).then(
      (text) => {
        session.set(id, text)
        if (live) setS({ text, failed: false })
      },
      () => live && setS({ text: null, failed: true }),
    )
    return () => {
      live = false
    }
  }, [id, auto])
  const inset = useSafeAreaInsets().bottom
  if (s.failed) return null
  return (
    // The web's `sticky bottom-[max(safe-area + 12, 24)] mr-[68px]`: over the foot of the screen, left of the round action.
    <View pointerEvents="box-none" className="absolute left-4" style={{ right: 16 + 68, bottom: Math.max(inset + 12, 24) }}>
      <Press
        activeScale={0.98}
        accessibilityRole="link"
        accessibilityLabel={s.text ? `Coach: ${s.text} Ask the coach about this workout.` : auto ? "Coach is analyzing this workout. Ask the coach about it." : ASK}
        onPress={() => push(`/coach?q=${encodeURIComponent(question)}&send=1`)}
      >
        <Glass radius={RADIUS["4xl"]} className="min-h-14 flex-row items-center gap-3 py-2 pl-2 pr-3">
          <CoachGlyph />
          <Text accessibilityElementsHidden className={cn("min-w-0 flex-1 text-[15px] font-medium leading-5", s.text || !auto ? "text-foreground" : "animate-pulse text-foreground-secondary")} numberOfLines={s.text ? 2 : undefined}>
            {s.text ?? (auto ? "Analyzing…" : ASK)}
          </Text>
          <Icon icon={ChevronUp} size={20} tone="foreground-secondary" strokeWidth={2} />
        </Glass>
      </Press>
    </View>
  )
}
