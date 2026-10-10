import type { ComponentProps } from "react";
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

/**
 * default: as tall as its content (`fitToContents`, as the web's drawer grows to at most 92 % of the screen).
 * tall: 92 % of the screen, the web's `h-[92svh]`. screen: the whole phone (a modal, for the Journal-style full tasks).
 */
export type SheetSize = "default" | "tall" | "screen";

type Options = Exclude<NonNullable<ComponentProps<typeof Stack.Screen>["options"]>, (...args: never[]) => unknown>;

/** The web drawer's top radius (`rounded-t-[28px]`). */
const RADIUS = 28;

/**
 * The `options` of a sheet's <Stack.Screen>. `c` is the palette in force: the sheet's own fill behind the native frame.
 * The platform gives the behaviour (drag, dismiss, dim, back gesture); the look is the web's on both platforms: its
 * radius, its handle (drawn by <SheetScreen>, so the iOS system grabber is off) and its heights.
 */
export function sheetOptions(size: SheetSize, c: Palette): Options {
  const contentStyle = { backgroundColor: c.sheet };
  if (size === "screen") return { headerShown: false, presentation: "modal", contentStyle };
  return {
    headerShown: false,
    presentation: "formSheet",
    sheetAllowedDetents: size === "tall" ? [0.92] : "fitToContents",
    sheetGrabberVisible: false,
    sheetCornerRadius: RADIUS,
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
