// The follow-up slider (components/ui/slider.tsx, journal-12): a 4 px track, a white range and thumb (20 px, a 44 px
// touch area), one thumb. A gesture-handler pan (horizontal only, so a vertical swipe still scrolls the sheet) and a tap
// set the value; the thumb sits where `value` puts it. The platform's own sliders are not used: they would draw
// Material and iOS controls instead of the web's.
import { useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useShadow } from "@/ui/shadow";

const THUMB = 20;

export type SliderProps = {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  /** Spoken name and, once moved, its value in words. */
  label: string;
  valueText?: string;
};

export function Slider({ min, max, step, value, onChange, label, valueText }: SliderProps) {
  const shadow = useShadow();
  const [width, setWidth] = useState(0);
  const travel = Math.max(1, width - THUMB);
  const snap = (x: number) => Math.min(max, Math.max(min, min + Math.round((Math.min(1, Math.max(0, (x - THUMB / 2) / travel)) * (max - min)) / step) * step));
  const emit = (x: number) => onChange(snap(x));
  // The compiler memoises the gesture on what `emit` reads (min, max, step, travel, onChange).
  const gesture = Gesture.Pan()
    .minDistance(0)
    .activeOffsetX([-4, 4])
    .failOffsetY([-12, 12])
    .onBegin((e) => runOnJS(emit)(e.x))
    .onUpdate((e) => runOnJS(emit)(e.x));

  const at = max === min ? 0 : (value - min) / (max - min);
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: valueText }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => onChange(Math.min(max, Math.max(min, value + (e.nativeEvent.actionName === "increment" ? step : -step))))}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        className="h-11 w-full justify-center"
      >
        <View className="h-1 overflow-hidden rounded-full bg-foreground/15">
          <View className="h-full bg-foreground" style={{ width: THUMB / 2 + at * travel }} />
        </View>
        <View
          pointerEvents="none"
          className="absolute rounded-full bg-foreground"
          style={{ width: THUMB, height: THUMB, left: at * travel, boxShadow: shadow("thumb") }}
        />
      </View>
    </GestureDetector>
  );
}
