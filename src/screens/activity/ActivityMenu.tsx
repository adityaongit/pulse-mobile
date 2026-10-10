// The activity's "..." (activity-01): the day's Strain and the heart-rate settings its zones come from. Pulse can't edit
// an imported workout. Ported from pulse src/app/(app)/activity/[id]/ActivityMenu.tsx: the web's dropdown panel
// (rounded-2xl bg-popover p-1.5, ring, min-w-64, 8 px under the trigger, aligned to its end) in a transparent Modal.
import { useRef, useState } from "react"
import { Modal, Pressable, useWindowDimensions, View } from "react-native"
import { router, type Href } from "expo-router"
import { CalendarDays, Ellipsis, HeartPulse, type LucideIcon } from "lucide-react-native"
import { Icon } from "@/ui/Icon"
import { Text } from "@/ui/Text"
import { useTheme } from "@/ui/theme"

type Anchor = { top: number; right: number }

export function ActivityMenu({ strainHref, settingsHref }: { strainHref: string; settingsHref: string }) {
  const { c, scheme } = useTheme()
  const { width } = useWindowDimensions()
  const trigger = useRef<View>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const open = () => trigger.current?.measureInWindow((x, y, w, h) => setAnchor({ top: y + h + 8, right: width - (x + w) }))
  const close = () => setAnchor(null)
  const go = (href: string) => {
    close()
    router.push(href as Href)
  }
  const item = (icon: LucideIcon, label: string, href: string) => (
    <Pressable accessibilityRole="link" onPress={() => go(href)} className="h-12 flex-row items-center gap-3 rounded-xl px-3 active:bg-foreground/10">
      <Icon icon={icon} size={20} tone="foreground-secondary" strokeWidth={1.75} />
      <Text className="text-[13px] font-bold uppercase leading-4 tracking-[0.1em]">{label}</Text>
    </Pressable>
  )
  return (
    <>
      <Pressable ref={trigger} collapsable={false} accessibilityRole="button" accessibilityLabel="More for this activity" onPress={open} className="size-11 items-center justify-center rounded-full active:bg-foreground/8">
        <Icon icon={Ellipsis} size={24} tone="foreground" strokeWidth={2} />
      </Pressable>
      <Modal visible={anchor !== null} transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
        {/* No dim, as the web's dropdown has none: a tap anywhere outside closes it. */}
        <Pressable accessibilityLabel="Close menu" onPress={close} className="flex-1">
          {anchor && (
            <View
              // The panel swallows taps, so only outside it closes the menu.
              onStartShouldSetResponder={() => true}
              className="absolute min-w-64 rounded-2xl bg-popover p-1.5"
              style={{
                top: anchor.top,
                right: anchor.right,
                backgroundColor: c.popover,
                boxShadow: `inset 0 0 0 1px ${scheme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(16, 21, 24, 0.1)"}, ${scheme === "dark" ? "0 8px 24px rgba(0, 0, 0, 0.45)" : "0 8px 24px rgba(16, 21, 24, 0.14)"}`,
              }}
            >
              {item(CalendarDays, "Strain for this day", strainHref)}
              {item(HeartPulse, "Heart-rate settings", settingsHref)}
            </View>
          )}
        </Pressable>
      </Modal>
    </>
  )
}
