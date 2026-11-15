// Swipe actions for the gym's cards: a horizontal pull reveals buttons behind the card. The library's pan only takes a
// sideways drag, so the page still scrolls when the finger moves vertically.
import type { ReactNode } from "react";
import { View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import type { LucideIcon } from "lucide-react-native";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { cn } from "@/ui/cn";

export type SwipeAction = { label: string; icon: LucideIcon; onPress: () => void; tone?: "accent" | "danger" | "neutral" };

const TONE = {
  accent: "bg-optimal text-background",
  danger: "bg-recovery-red text-background",
  neutral: "bg-secondary text-foreground-secondary",
} as const;

function Actions({ actions, methods }: { actions: SwipeAction[]; methods: SwipeableMethods }) {
  return (
    <View className="h-full flex-row overflow-hidden rounded-2xl">
      {actions.map((action) => (
        <Press
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => {
            methods.close();
            action.onPress();
          }}
          className={cn("h-full w-[78px] items-center justify-center gap-1", TONE[action.tone ?? "neutral"])}
        >
          <Icon icon={action.icon} size={19} tone={action.tone === "neutral" || !action.tone ? "foreground-secondary" : "background"} />
          <Text className={cn("text-[10px] font-bold uppercase leading-3 tracking-[0.04em]", action.tone === "neutral" ? "text-foreground-secondary" : "text-background")}>{action.label}</Text>
        </Press>
      ))}
    </View>
  );
}

/** A card that can be swiped right for `left` and left for `right`. Both lists are optional. */
export function SwipeActions({ children, left, right }: { children: ReactNode; left?: SwipeAction[]; right?: SwipeAction[] }) {
  return (
    <ReanimatedSwipeable
      friction={2}
      leftThreshold={42}
      rightThreshold={42}
      // A sideways drift of 10 px was enough to open a row mid-scroll: ask for a deliberate pull.
      dragOffsetFromLeftEdge={24}
      dragOffsetFromRightEdge={24}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={left ? (_p, _t, methods) => <Actions actions={left} methods={methods} /> : undefined}
      renderRightActions={right ? (_p, _t, methods) => <Actions actions={right} methods={methods} /> : undefined}
    >
      {children}
    </ReanimatedSwipeable>
  );
}
