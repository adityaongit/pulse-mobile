import type { ComponentProps } from "react";
import { Platform } from "react-native";
import { router, type Href, type Stack } from "expo-router";
import type { Palette } from "../palette";

// Task sheets (check-in, the log sheets, info cards) are ROUTES presented by the platform: Expo Router's native stack
// shows them as `presentation: "formSheet"`, a UISheetPresentationController on iOS and a native bottom sheet on
// Android. The OS gives the drag, the detents, the dim, swipe-down to dismiss and the Android back gesture; Back also
// closes them, as on the web (`?checkin=1`). To add one:
//
//   1. app/(sheets)/<name>.tsx  renders <SheetScreen title=... size=...>...</SheetScreen>  (the `(sheets)` group is
//      only a folder: the route is /<name>).
//   2. app/_layout.tsx          <Stack.Screen name="(sheets)/<name>" options={sheetOptions("default", c)} />
//   3. anywhere                 openSheet("/<name>")  (closeSheet() closes the one on top).
//
// Pass the same size to the options and to <SheetScreen>: the options decide the detents, the component decides whether
// its body scrolls.

/** default: as tall as its content (`fitToContents`). tall: opens half-way, drags to full. screen: the whole phone (a modal, for the Journal-style full tasks). */
export type SheetSize = "default" | "tall" | "screen";

type Options = Exclude<NonNullable<ComponentProps<typeof Stack.Screen>["options"]>, (...args: never[]) => unknown>;

/** The `options` of a sheet's <Stack.Screen>. `c` is the palette in force: the sheet's own fill behind the native frame. */
export function sheetOptions(size: SheetSize, c: Palette): Options {
  const contentStyle = { backgroundColor: c.sheet };
  if (size === "screen") return { headerShown: false, presentation: "modal", contentStyle };
  return {
    headerShown: false,
    presentation: "formSheet",
    // Android takes at most three detents and no `flex: 1` content with "fitToContents".
    sheetAllowedDetents: size === "tall" ? [0.5, 1] : "fitToContents",
    sheetGrabberVisible: true, // iOS only; <SheetScreen> draws its own handle on Android
    sheetCornerRadius: Platform.OS === "android" ? 24 : undefined, // iOS keeps the system radius (it is concentric with the device)
    contentStyle,
  };
}

/** Opens a sheet over the current screen. `href` is the sheet's route ("/checkin"), with its params if any. */
export function openSheet(href: string) {
  router.push(href as Href);
}

/** Closes the sheet on top (the X). With nothing to go back to (a deep link) it lands on Home. */
export function closeSheet() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
