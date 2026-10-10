// The Trend View's metric switch (web: components/metrics/TrendMetricMenu.tsx, a dropdown menu): a full-width card naming
// the metric in caps with its icon and a chevron; it opens a panel under it listing the screen's other metrics. A choice
// keeps the range and day. The panel is a transparent <Modal> placed at the card's measured position.
import { useRef, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Check, ChevronDown, type LucideIcon } from "lucide-react-native";
import { alpha } from "@/ui/color";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { CardButton } from "./parts";

export type TrendMetricOption = { key: string; label: string; icon?: LucideIcon };

const ITEM = "text-[13px] font-bold uppercase leading-4 tracking-[0.1em]";

export function TrendMetricMenu({ current, options, onSelect }: { current: string; options: TrendMetricOption[]; onSelect: (key: string) => void }) {
  const { c, scheme } = useTheme();
  const on = options.find((o) => o.key === current) ?? options[0];
  const trigger = useRef<View>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const open = () => (haptic.tap(), trigger.current?.measureInWindow((x, y, w, h) => setBox({ x, y, w, h })));
  const close = () => setBox(null);
  return (
    <>
      <View ref={trigger} collapsable={false}>
        <CardButton accessibilityLabel={`${on.label}. Change metric`} onPress={open} className="min-h-14 w-full flex-row items-center gap-3 rounded-xl px-4">
          <View accessibilityElementsHidden className="size-6 items-center justify-center">{on.icon && <Icon icon={on.icon} size={20} tone="muted-foreground" strokeWidth={1.75} />}</View>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] font-bold uppercase leading-5 tracking-[0.08em]">{on.label}</Text>
          <View style={box ? { transform: [{ rotate: "180deg" }] } : undefined}>
            <Icon icon={ChevronDown} size={20} tone="foreground" strokeWidth={2.25} />
          </View>
        </CardButton>
      </View>
      <Modal visible={!!box} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <Pressable accessibilityLabel="Close menu" onPress={close} style={{ flex: 1 }}>
          {box && (
            <View
              className="absolute rounded-2xl p-1.5"
              style={{ left: box.x, top: box.y + box.h + 8, width: box.w, backgroundColor: c.popover, boxShadow: `0 0 0 1px ${alpha(c.foreground, 0.1)}, 0 8px 24px ${scheme === "dark" ? "rgba(0, 0, 0, 0.45)" : "rgba(16, 21, 24, 0.14)"}` }}
            >
              {options.map((o) => (
                <Pressable key={o.key} accessibilityRole="menuitem" accessibilityState={{ selected: o.key === on.key }} onPress={() => (close(), o.key !== on.key && (haptic.select(), onSelect(o.key)))} className="h-12 flex-row items-center gap-3 rounded-xl px-3 active:bg-foreground/10">
                  <View accessibilityElementsHidden className="size-6 items-center justify-center">{o.icon && <Icon icon={o.icon} size={20} tone="muted-foreground" strokeWidth={1.75} />}</View>
                  <Text numberOfLines={1} className={cn(ITEM, "min-w-0 flex-1")}>{o.label}</Text>
                  {o.key === on.key && <Icon icon={Check} size={16} tone="foreground" strokeWidth={2.25} />}
                </Pressable>
              ))}
            </View>
          )}
        </Pressable>
      </Modal>
    </>
  );
}
