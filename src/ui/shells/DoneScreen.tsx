import { useEffect, useRef } from "react";
import { View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { Check } from "lucide-react-native";
import { haptic } from "../haptics";
import { Text } from "../Text";
import { useTheme } from "../theme";

/** How long the confirmation stays before the task closes. */
export const DONE_MS = 1600;

/**
 * The reference app's confirmation after a full-screen task saves ("SAVED / Have a great day!", "SUCCESS"): a green
 * ring with a check, a caps title and one line, and a success haptic. It closes itself after `DONE_MS`.
 */
export function DoneScreen({ title, body, onDone }: { title: string; body: string; onDone: () => void }) {
  const { c } = useTheme();
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    haptic.success();
    const t = setTimeout(() => done.current(), DONE_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <View accessibilityRole="alert" className="flex-1 items-center justify-center gap-6 px-6 pb-16">
      <Animated.View entering={ZoomIn.duration(300)}>
        <View className="size-30 items-center justify-center rounded-full border-[5px] border-optimal">
          <Check size={48} color={c["optimal-text"]} strokeWidth={2.5} />
        </View>
      </Animated.View>
      <Animated.View entering={FadeIn.delay(100).duration(300)}>
        <View className="items-center gap-2">
          <Text className="text-xl font-bold uppercase leading-7 tracking-[0.1em]">{title}</Text>
          <Text className="text-center text-[15px] leading-[22px] text-muted-foreground">{body}</Text>
        </View>
      </Animated.View>
    </View>
  );
}
