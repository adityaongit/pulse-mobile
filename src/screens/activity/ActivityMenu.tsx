// The activity's "..." (activity-01): the day's Strain and the heart-rate settings its zones come from. Pulse can't edit
// a workout another app wrote; one it recorded and saved to Health Connect itself can be deleted here. Ported from pulse src/app/(app)/activity/[id]/ActivityMenu.tsx: the web's dropdown panel
// (rounded-2xl bg-popover p-1.5, ring, min-w-64, 8 px under the trigger, aligned to its end): the kit's MenuPanel.
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { router, type Href } from "expo-router"
import { CalendarDays, Ellipsis, HeartPulse, Trash2, type LucideIcon } from "lucide-react-native"
import { workoutRecorder } from "@/live/workoutRecorder"
import { useRecordedOf } from "@/screens/workout/recordedOf"
import { ConfirmDialog } from "@/screens/settings/controls"
import { Icon } from "@/ui/Icon"
import { Text } from "@/ui/Text"
import { MenuPanel, useMenu } from "@/ui/Menu"
import { push } from "@/ui/navigate"
import { Press } from "@/ui/Press"

export function ActivityMenu({ strainHref, settingsHref, activityId }: { strainHref: string; settingsHref: string; activityId: string }) {
  const { t } = useTranslation(["strain", "workouts"])
  const { ref, anchor, open, close } = useMenu()
  const of = useRecordedOf(activityId)
  const recorded = { id: of.session?.id ?? null, busy: of.busy }
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const go = (href: string) => {
    close()
    push(href)
  }
  const item = (icon: LucideIcon, label: string, href: string) => (
    <Press activeBg="bg-fill-pressed" accessibilityRole="link" onPress={() => go(href)} className="h-12 flex-row items-center gap-3 rounded-xl px-3">
      <Icon icon={icon} size={20} tone="foreground-secondary" strokeWidth={1.75} />
      <Text className="text-[13px] font-bold uppercase leading-4 tracking-[0.1em]">{label}</Text>
    </Press>
  )
  return (
    <>
      <Press activeBg="bg-fill-hover" ref={ref} collapsable={false} accessibilityRole="button" accessibilityLabel={t("menu.more")} onPress={open} className="size-11 items-center justify-center rounded-full">
        <Icon icon={Ellipsis} size={24} tone="foreground" strokeWidth={2} />
      </Press>
      <MenuPanel anchor={anchor} onClose={close} align="end" className="min-w-64">
        {item(CalendarDays, t("menu.strainForDay"), strainHref)}
        {item(HeartPulse, t("menu.hrSettings"), settingsHref)}
        {!!recorded.id && (
          <Press activeBg="bg-fill-pressed" accessibilityRole="button" onPress={() => { close(); setAsking(true) }} className="h-12 flex-row items-center gap-3 rounded-xl px-3">
            <Icon icon={Trash2} size={20} tone="destructive" strokeWidth={1.75} />
            <Text className="text-[13px] font-bold uppercase leading-4 tracking-[0.1em] text-destructive">{t("workouts:detail.delete")}</Text>
          </Press>
        )}
      </MenuPanel>
      <ConfirmDialog
        open={asking}
        title={t("workouts:detail.deleteTitle")}
        description={t("workouts:detail.deleteBody")}
        confirmLabel={t("workouts:detail.delete")}
        pendingLabel={t("workouts:detail.deleting")}
        pending={recorded.busy}
        error={failed && t(`workouts:recorder.errors.${failed}`, { defaultValue: t("workouts:recorder.errors.commandFailed") })}
        onCancel={() => {
          setAsking(false)
          setFailed(null)
        }}
        onConfirm={() => {
          const id = recorded.id
          if (!id) return
          // Home once it is gone; when the delete fails the dialog stays open with the reason.
          void workoutRecorder.discard(id).then((ok) => {
            if (ok) {
              setAsking(false)
              router.replace("/(tabs)" as Href)
            } else setFailed(workoutRecorder.getSnapshot().error ?? "commandFailed")
          })
        }}
      />
    </>
  )
}
