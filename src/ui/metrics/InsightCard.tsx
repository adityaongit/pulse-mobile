import { Pressable, View } from "react-native";

import { ArrowRight } from "lucide-react-native";
import { cn } from "../cn";
import { Gradient } from "../Gradient";
import { Icon } from "../Icon";
import { SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { push } from "../navigate";

export type InsightCardProps = {
  title?: string;
  /** Templated by U10: second person, present tense, one idea. */
  body: string;
  /** In-page anchors ("#drivers", handled by `onAnchor`) or routes. */
  action?: { label: string; href: string };
  /** What an in-page anchor does: scroll the screen to that section. */
  onAnchor?: (hash: string) => void;
};

// A 16 px card with a 1 px gradient hairline, so the inner radius is 15 px (spec §2.4).
const FRAME = "overflow-hidden rounded-2xl p-px";
const INNER = "grow gap-2 rounded-[15px] bg-inset p-4";

/** The reference app's coach card with the 1 px gradient hairline (spec §5.15). Not rendered when empty. */
export function InsightCard({ title, body, action, onAnchor }: InsightCardProps) {
  const { c } = useTheme();
  return (
    <View className={FRAME}>
      <Gradient from={c["insight-from"]} to={c["insight-to"]} />
      <View className={INNER}>
        {!!title && <Text className="text-base font-semibold leading-[22px]">{title}</Text>}
        <Text className="text-[15px] leading-[22px]">{body}</Text>
        {action && (
          <Pressable
            accessibilityRole="link"
            // An in-page anchor does not leave the screen (spec §8, journey 1).
            onPress={() => (action.href.startsWith("#") ? onAnchor?.(action.href.slice(1)) : push(action.href))}
            hitSlop={{ top: 14, bottom: 14, left: 4, right: 4 }}
            className="mt-auto flex-row items-center gap-1.5 self-start"
          >
            <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-coach-text">{action.label}</Text>
            <Icon icon={ArrowRight} size={14} tone="coach-text" strokeWidth={2} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** `title` / `action`: room for the card's title line and its link line ("See what shaped it"). */
export function InsightCardSkeleton({ title = false, action = false }: { title?: boolean; action?: boolean }) {
  const { c } = useTheme();
  return (
    <View accessibilityElementsHidden className={FRAME}>
      <Gradient from={c["insight-from"]} to={c["insight-to"]} />
      <View className={cn(INNER)}>
        {title && <SkeletonText className="w-40" lh={22} fs={16} />}
        <View>
          <SkeletonText className="w-full" lh={22} fs={15} />
          <SkeletonText className="w-2/3" lh={22} fs={15} />
        </View>
        {action && <SkeletonText className="mt-auto w-36" />}
      </View>
    </View>
  );
}
InsightCard.Skeleton = InsightCardSkeleton;
