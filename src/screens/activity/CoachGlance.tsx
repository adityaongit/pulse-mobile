import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
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
import { deviceWorkoutGlance, deviceSleepGlance } from "@/coach/session"
import { generateId } from "ai"
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

export function CoachGlance({ id, question, auto, sleepDay }: { id: string; question: string; auto: boolean; sleepDay?: string }) {
  const { t } = useTranslation("strain")
  const { t: coachT } = useTranslation("coach")
  const ask = sleepDay ? coachT("sleep.ask") : t("glance.ask")
  const [s, setS] = useState<State>({ text: sleepDay ? null : session.get(id) ?? null, failed: false })
  useEffect(() => {
    if (!auto || (!sleepDay && session.has(id))) return
    let live = true;
    (sleepDay ? deviceSleepGlance(sleepDay) : deviceWorkoutGlance(id)).then(
      (text) => {
        if (!sleepDay) session.set(id, text)
        if (live) setS({ text, failed: false })
      },
      () => live && setS({ text: null, failed: true }),
    )
    return () => {
      live = false
    }
  }, [id, auto, sleepDay])
  const inset = useSafeAreaInsets().bottom
  return (
    // The web's `sticky bottom-[max(safe-area + 12, 24)]`: over the foot of the screen, full width (WHOOP's coach pill).
    <View pointerEvents="box-none" className="absolute left-4 right-4" style={{ bottom: Math.max(inset + 12, 24) }}>
      <Press
        activeScale={0.98}
        accessibilityRole="link"
        accessibilityLabel={s.text ? (sleepDay ? coachT("sleep.spokenText", { text: s.text }) : t("glance.spokenText", { text: s.text })) : auto && !s.failed ? (sleepDay ? coachT("sleep.spokenAnalyzing") : t("glance.spokenAnalyzing")) : ask}
        onPress={() => {
          const params = new URLSearchParams({ q: question, send: "1", ...(sleepDay ? { sleep: sleepDay } : { workout: id }), n: generateId() })
          if (s.text) params.set("preview", s.text)
          push(`/coach?${params}`)
        }}
      >
        <Glass radius={RADIUS["4xl"]} className="min-h-14 flex-row items-center gap-3 py-2 pl-2 pr-3">
          <CoachGlyph />
          <Text accessibilityElementsHidden className={cn("min-w-0 flex-1 text-[15px] font-medium leading-5", s.text || !auto || s.failed ? "text-foreground" : "animate-pulse text-foreground-secondary")} numberOfLines={s.text ? 2 : undefined}>
            {s.text ?? (auto && !s.failed ? t("glance.analyzing") : ask)}
          </Text>
          <Icon icon={ChevronUp} size={20} tone="foreground-secondary" strokeWidth={2} />
        </Glass>
      </Press>
    </View>
  )
}
