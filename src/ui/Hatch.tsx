import { cn } from "./cn";
import { StyleSheet, View, type ViewProps } from "react-native";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";
import { useTheme } from "./theme";

/**
 * The hatched track (--pattern-hatch): 45 degree stripes, 1.5 px on a 5 px period, under zone rows, impact rows and
 * stage rows. Children draw over it. Give it a height and a radius in `className`.
 */
export function Hatch({ children, className, ...props }: ViewProps) {
  const { scheme } = useTheme();
  // The web writes the stripe colour in the token: white 9 % on dark, ink 8 % on light.
  const stripe = scheme === "dark" ? "rgba(255, 255, 255, 0.09)" : "rgba(16, 21, 24, 0.08)";
  return (
    <View className={cn("overflow-hidden", className)} {...props}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <Pattern id="hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Rect width={1.5} height={5} fill={stripe} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#hatch)" />
      </Svg>
      {children}
    </View>
  );
}
