import { i18n } from "@/i18n/config";
import { View } from "react-native";
import { useGlobalSearchParams } from "expo-router";
import { useHasCoachKey } from "@/coach/session";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { dayLabel } from "@/lib/format";
import { parseDay } from "@/lib/url";
import { Glass } from "../Glass";
import { haptic } from "../haptics";
import { Mark } from "../brand";
import { useTheme } from "../theme";
import { FAB_SIZE, TAB_ROOTS, useTabBarBottom } from "./layout";
import { useShellCalendar } from "./ShellStatus";
import { push } from "../navigate";
import { Press } from "../Press";
import { GLASS_RADIUS } from "../radius";

/** The reference app's ringed monogram, with Pulse's mark in a 30 px circle with the indigo-to-blue rim. */
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
      <Mark size={16} />
    </View>
  );
}

/**
 * The "Check in" action (spec §4.2.1): indigo-rimmed glass with Pulse's mark. It opens the check-in sheet, the route
 * app/checkin.tsx, over the screen you are on, for the day that screen shows: `/checkin?d=` carries the screen's
 * `d` as the web keeps `?d=` beside `?checkin=1`. (The tab bar sits in the tabs layout, so the day is the focused route's:
 * the global params, not the layout's own.) With a coach key saved, it opens the coach instead (the web's coach access).
 */
export function CheckInAction({ onPress }: { onPress?: () => void }) {
  const { today } = useShellCalendar();
  const { d: raw } = useGlobalSearchParams<{ d?: string }>();
  const { d } = parseDay(raw, today);
  const coach = useHasCoachKey();
  const label = coach ? "Coach" : i18n.t("ui:checkIn.forDay", { day: dayLabel(d, today) });
  return (
    <Press
      activeScale={0.96}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptic.tap();
        (onPress ?? (() => (coach ? push("/coach") : push(`/checkin?d=${d}`))))();
      }}
    >
      <Glass radius={GLASS_RADIUS} action style={{ width: FAB_SIZE, height: FAB_SIZE, alignItems: "center", justifyContent: "center" }}>
        <Monogram />
      </Glass>
    </Press>
  );
}

/**
 * Floats alone on detail screens (spec §4.2). Not on the tab roots (the tab bar carries it there), Settings, the coach
 * or the dev kit (except its detail demo, which shows how a detail screen looks).
 */
export function showsCheckIn(pathname: string) {
  return !(TAB_ROOTS.includes(pathname) || pathname.startsWith("/settings") || pathname.startsWith("/coach") || (pathname.startsWith("/dev") && !pathname.startsWith("/dev/kit/detail")));
}

/** The action floating alone at the foot of a detail screen, where the tab bar would sit. Rendered by <ScreenScroll>. */
export function FloatingCheckIn() {
  const bottom = useTabBarBottom();
  return (
    <View pointerEvents="box-none" className="absolute right-3" style={{ bottom }}>
      <CheckInAction />
    </View>
  );
}
