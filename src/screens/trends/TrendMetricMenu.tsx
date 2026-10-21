// The Trend View's metric switch (web: components/metrics/TrendMetricMenu.tsx, a dropdown menu): a full-width card naming
// the metric in caps with its icon and a chevron; it opens a panel under it listing the screen's other metrics. A choice
// keeps the range and day. The panel is the kit's MenuPanel, placed from the card's measured position.
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, type LucideIcon } from "lucide-react-native";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { MenuPanel, useMenu } from "@/ui/Menu";
import { CardButton, Turn } from "./parts";
import { Press } from "@/ui/Press";

export type TrendMetricOption = { key: string; label: string; icon?: LucideIcon };

const ITEM = "text-[13px] font-bold uppercase leading-4 tracking-[0.1em]";

export function TrendMetricMenu({ current, options, onSelect }: { current: string; options: TrendMetricOption[]; onSelect: (key: string) => void }) {
  const { t } = useTranslation("trends");
  const on = options.find((o) => o.key === current) ?? options[0];
  const { ref, anchor, open, close } = useMenu();
  return (
    <>
      <View ref={ref} collapsable={false}>
        <CardButton accessibilityLabel={t("changeMetric", { label: on.label })} onPress={() => (haptic.tap(), open())} activeScale={0.99} className="min-h-14 w-full flex-row items-center gap-3 rounded-xl px-4">
          <View accessibilityElementsHidden className="size-6 items-center justify-center">{on.icon && <Icon icon={on.icon} size={20} tone="muted-foreground" strokeWidth={1.75} />}</View>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] font-bold uppercase leading-5 tracking-[0.08em]">{on.label}</Text>
          <Turn on={!!anchor}>
            <Icon icon={ChevronDown} size={20} tone="foreground" strokeWidth={2.25} />
          </Turn>
        </CardButton>
      </View>
      <MenuPanel anchor={anchor} onClose={close} align="stretch">
        {options.map((o) => (
          <Press activeBg="bg-fill-pressed" key={o.key} accessibilityRole="menuitem" accessibilityState={{ selected: o.key === on.key }} onPress={() => (close(), o.key !== on.key && (haptic.select(), onSelect(o.key)))} className="h-12 flex-row items-center gap-3 rounded-xl px-3">
            <View accessibilityElementsHidden className="size-6 items-center justify-center">{o.icon && <Icon icon={o.icon} size={20} tone="muted-foreground" strokeWidth={1.75} />}</View>
            <Text numberOfLines={1} className={cn(ITEM, "min-w-0 flex-1")}>{o.label}</Text>
            {o.key === on.key && <Icon icon={Check} size={16} tone="foreground" strokeWidth={2.25} />}
          </Press>
        ))}
      </MenuPanel>
    </>
  );
}
