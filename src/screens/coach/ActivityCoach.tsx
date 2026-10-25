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
import { deviceActivityGlance } from "@/coach/session"
import { generateId } from "ai"
import { push } from "@/ui/navigate"
import { Press } from "@/ui/Press";
import { RADIUS } from "@/ui/radius";

import type { CoachActivity } from "@/coach/activity";
import type { CoachSetup } from "@/coach/storage";
import { coachReady } from "@/coach/providers";
import { useDataVersion } from "../useScreen";

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

export function ActivityCoach({ activity, question, setup }: { activity: CoachActivity; question: string; setup: CoachSetup | undefined }) {
  const version = useDataVersion();
  const { i18n } = useTranslation("coach");
  if (!coachReady(setup)) return null;
  return <Glance key={JSON.stringify([activity, version, i18n.language, setup])} activity={activity} question={question} auto={setup?.autoAnalysis ?? true} />;
}

function Glance({ activity, question, auto }: { activity: CoachActivity; question: string; auto: boolean }) {
  const { t } = useTranslation("coach");
  const ask = t("activity.ask");
  const { kind, id } = activity;
  const [s, setS] = useState<State>({ text: null, failed: false });
  useEffect(() => {
    if (!auto) return;
    let live = true;
    deviceActivityGlance({ kind, id }).then(
      (text) => live && setS({ text, failed: false }),
      () => live && setS({ text: null, failed: true }),
    );
    return () => { live = false; };
  }, [kind, id, auto]);
  const inset = useSafeAreaInsets().bottom
  return (
    <View pointerEvents="box-none" className="absolute left-4 right-4" style={{ bottom: Math.max(inset + 12, 24) }}>
      <Press
        activeScale={0.98}
        accessibilityRole="link"
        accessibilityLabel={s.text ? t("activity.spokenText", { text: s.text }) : auto && !s.failed ? t("activity.spokenAnalyzing") : ask}
        onPress={() => {
          const params = new URLSearchParams({ q: question, send: "1", [activity.kind]: activity.id, n: generateId() })
          if (s.text) params.set("preview", s.text)
          push(`/coach?${params}`)
        }}
      >
        <Glass radius={RADIUS["4xl"]} className="min-h-14 flex-row items-center gap-3 py-2 pl-2 pr-3">
          <CoachGlyph />
          <Text accessibilityElementsHidden className={cn("min-w-0 flex-1 text-[15px] font-medium leading-5", s.text || !auto || s.failed ? "text-foreground" : "animate-pulse text-foreground-secondary")} numberOfLines={s.text ? 2 : undefined}>
            {s.text ?? (auto && !s.failed ? t("activity.analyzing") : ask)}
          </Text>
          <Icon icon={ChevronUp} size={20} tone="foreground-secondary" strokeWidth={2} />
        </Glass>
      </Press>
    </View>
  )
}
