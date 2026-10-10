import { Pressable, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Glass } from "../Glass";
import { haptic } from "../haptics";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { FAB_GAP, FAB_SIZE } from "./layout";
import { openSheet } from "./sheets";

/** The reference app's ringed monogram: "P" in a 30 px circle with the indigo-to-blue rim. */
function Monogram() {
  const { c } = useTheme();
  return (
    <View accessibilityElementsHidden className="size-[30px] items-center justify-center">
      <Svg width={30} height={30} style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c["action-rim-from"]} />
            <Stop offset="1" stopColor={c["action-rim-to"]} />
          </LinearGradient>
        </Defs>
        <Circle cx={15} cy={15} r={14.25} fill={c["action-face"]} stroke="url(#rim)" strokeWidth={1.5} />
      </Svg>
      <Text className="font-numeric text-[15px] font-bold leading-[15px] text-foreground">P</Text>
    </View>
  );
}

/**
 * The "Check in" action (spec §4.2.1): indigo-rimmed glass with the "P" monogram. It opens the check-in sheet, the route
 * app/(sheets)/checkin.tsx, over the screen you are on. Where the coach is on, this button opens the coach instead (the
 * web's coach access); that wiring arrives with the coach stream, through `onPress`.
 */
export function CheckInAction({ label = "Check in", onPress }: { label?: string; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptic.tap();
        (onPress ?? (() => openSheet("/checkin")))();
      }}
      className="active:scale-[0.96]"
    >
      <Glass radius={22} action style={{ width: FAB_SIZE, height: FAB_SIZE, alignItems: "center", justifyContent: "center" }}>
        <Monogram />
      </Glass>
    </Pressable>
  );
}

/** Not on Settings, the coach or the dev kit (except its detail demo, which shows how a detail screen looks). */
export function showsCheckIn(pathname: string) {
  return !(pathname.startsWith("/settings") || pathname.startsWith("/coach") || (pathname.startsWith("/dev") && !pathname.startsWith("/dev/kit/detail")));
}

/**
 * The action floating over a screen, bottom right, above the platform's tab bar on a tab screen or alone on a detail
 * screen (spec §4.2). It sits inside <ScreenScroll>, whose SafeAreaProvider knows where that is.
 */
export function FloatingCheckIn() {
  const bottom = useSafeAreaInsets().bottom + FAB_GAP;
  return (
    <View pointerEvents="box-none" className="absolute right-3" style={{ bottom }}>
      <CheckInAction />
    </View>
  );
}
