// The activity's "..." (activity-01): the day's Strain and the heart-rate settings its zones come from. Pulse can't edit
// an imported workout. Ported from pulse src/app/(app)/activity/[id]/ActivityMenu.tsx: the web's dropdown panel
// (rounded-2xl bg-popover p-1.5, ring, min-w-64, 8 px under the trigger, aligned to its end): the kit's MenuPanel.
import { useTranslation } from "react-i18next"
import { CalendarDays, Ellipsis, HeartPulse, type LucideIcon } from "lucide-react-native"
import { Icon } from "@/ui/Icon"
import { Text } from "@/ui/Text"
import { MenuPanel, useMenu } from "@/ui/Menu"
import { push } from "@/ui/navigate"
import { Press } from "@/ui/Press"

export function ActivityMenu({ strainHref, settingsHref }: { strainHref: string; settingsHref: string }) {
  const { t } = useTranslation("strain")
  const { ref, anchor, open, close } = useMenu()
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
      </MenuPanel>
    </>
  )
}
