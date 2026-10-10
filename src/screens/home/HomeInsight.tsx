// Home's coach card [latest-home-top-1], [latest-home-top-3]: an opaque card with a title and body (no link) and the
// reference app's check-over-count pill at the right. With several cards a second card peeks out underneath and the pill
// cycles through them (tap to cycle is inferred, spec §12 I13). Ported from pulse (app)/_lib/HomeInsight.tsx. The web
// stacks every card in one grid cell so the box keeps the tallest card's height; here the active card is in the flow, the
// others sit on top of it, and the box takes the tallest measured height.
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Check } from "lucide-react-native";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";

export type HomeInsightItem = { key: string; title: string; body: string };

/** One card's text: it fades (150 ms) when it becomes the active one. */
function Slide({ active, onHeight, children, label }: { active: boolean; onHeight: (h: number) => void; children: ReactNode; label?: string }) {
  const opacity = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, { duration: 150 });
  }, [active, opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      pointerEvents={active ? "auto" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      accessibilityLabel={label}
      style={[active ? undefined : { position: "absolute", top: 0, left: 0, right: 0 }, fade]}
    >
      {children}
    </Animated.View>
  );
}

export function HomeInsight({ items }: { items: HomeInsightItem[] }) {
  const [i, setI] = useState(0);
  const [heights, setHeights] = useState<number[]>([]);
  const shadow = useCardStyle();
  const n = items.length;
  if (!n) return null;
  const several = n > 1;
  const at = Math.min(i, n - 1);
  const tallest = Math.max(0, ...heights);
  return (
    <View accessibilityLabel="Insights" className={several ? "pb-2" : undefined}>
      {several && <View accessibilityElementsHidden className="absolute inset-x-5 bottom-0 h-8 rounded-b-2xl bg-card/60" />}
      {/* The reference app's card: text inset 20 px, the counter pill 8 px from the top and right corner (spec §11 F6). */}
      <View className={`${CARD_CLASS} p-5 pr-12`} style={shadow}>
        <CardFill />
        <View style={{ minHeight: tallest }}>
          {items.map((it, k) => (
            <Slide
              key={it.key}
              active={k === at}
              onHeight={(h) => setHeights((hs) => (hs[k] === h ? hs : Object.assign([...hs], { [k]: h })))}
              label={several ? `${k + 1} of ${n}` : undefined}
            >
              <View className="gap-0.5">
                <Text className="text-base font-medium leading-[22px]">{it.title}</Text>
                <Text className="text-[15px] leading-5 text-foreground/85">{it.body}</Text>
              </View>
            </Slide>
          ))}
        </View>
        {several ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Next insight (${at + 1} of ${n})`}
            onPress={() => {
              haptic.tap();
              setI((k) => (k + 1) % n);
            }}
            hitSlop={{ left: 10, right: 10, top: 2, bottom: 2 }}
            className="absolute right-2 top-2 h-12 w-6 items-center justify-center gap-1 rounded-lg bg-foreground/[0.08] active:scale-[0.96]"
          >
            <Icon icon={Check} size={16} tone="foreground" strokeWidth={2.25} />
            <Text className="font-numeric text-[13px] font-semibold leading-4 tabular-nums text-foreground-secondary">{n - at}</Text>
          </Pressable>
        ) : (
          <View accessibilityElementsHidden className="absolute right-2 top-2 h-12 w-6 items-center justify-center gap-1 rounded-lg bg-foreground/[0.08]">
            <Icon icon={Check} size={16} tone="foreground" strokeWidth={2.25} />
            <Text className="font-numeric text-[13px] font-semibold leading-4 tabular-nums text-foreground-secondary">1</Text>
          </View>
        )}
      </View>
    </View>
  );
}
