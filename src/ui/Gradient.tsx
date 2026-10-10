import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const DIRECTION = {
  x: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  y: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
  xy: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
} as const;

/**
 * A linear gradient filling its parent (the web's bg-linear-to-r / -to-b): the native gradient layer of the platform
 * (expo-linear-gradient), for the insight card's hairline, the stage swatch, card and glass fills. `angle`: "x" runs
 * left to right, "y" top to bottom, "xy" corner to corner (135 degrees). Give the parent `overflow-hidden` and a radius.
 */
export function Gradient({ from, to, angle = "x" }: { from: string; to: string; angle?: "x" | "y" | "xy" }) {
  return <LinearGradient colors={[from, to]} {...DIRECTION[angle]} pointerEvents="none" style={StyleSheet.absoluteFill} />;
}
