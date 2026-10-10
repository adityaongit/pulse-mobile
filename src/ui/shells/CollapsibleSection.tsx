import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { ChevronDown } from "lucide-react-native";
import { cn } from "../cn";
import { haptic } from "../haptics";
import { Icon } from "../Icon";
import { Text } from "../Text";

export type CollapsibleSectionProps = {
  /** Stable id: the section's key (the web keeps its open state in a cookie under it). */
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** Shown beside the title, open or closed (a "See all" link). */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  /** Called on every toggle, for a screen that remembers the choice (the web uses a cookie; the app's settings store does it). */
  onToggle?: (id: string, open: boolean) => void;
};

/**
 * A page section whose body folds away (spec §11 LG1): SectionShell's section header, with the title a 44 px toggle and
 * a chevron. Remembering the choice between launches is the caller's job through `onToggle`.
 */
export function CollapsibleSection({ id, title, defaultOpen = true, action, className, children, onToggle }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(open ? "0deg" : "-90deg", { duration: 150 }) }] }), [open]);
  return (
    <View className={cn("min-w-0", className)}>
      <View className={cn("min-h-[34px] flex-row items-center justify-between gap-3", open && "mb-3")}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            haptic.toggle(!open);
            setOpen(!open);
            onToggle?.(id, !open);
          }}
          className="-mx-2 -my-1.5 min-h-11 flex-row items-center gap-2 rounded-lg px-2"
        >
          <Text accessibilityRole="header" className="text-[22px] font-semibold leading-7 tracking-[-0.01em]">
            {title}
          </Text>
          <Animated.View style={chevron}>
            <Icon icon={ChevronDown} size={20} tone="muted-foreground" strokeWidth={2} />
          </Animated.View>
        </Pressable>
        {action && <View className="shrink-0 flex-row items-center gap-3">{action}</View>}
      </View>
      {open && children}
    </View>
  );
}
