import { router, type Href } from "expo-router";

// ponytail: a time window stands in for "the push transition is still running" (iOS and Android native-stack pushes
// take about 350 ms). Move to the stack's transitionEnd event if a slow phone ever needs longer.
const IN_FLIGHT_MS = 500;
let last = -Infinity;

/**
 * Every push in the app (cards, rows, links, sheets) goes through here. A second push while the first one's transition
 * runs is dropped: a double tap opens a screen once, and a tap on another card mid-animation does nothing, as UIKit
 * ignores taps during a push. Back, replace and dismiss are not pushes and are never held.
 */
export function push(href: string) {
  const now = Date.now();
  if (now - last < IN_FLIGHT_MS) return;
  last = now;
  if (typeof __DEV__ !== "undefined" && __DEV__) console.info(`[screen] push at-ms=${Math.round(performance.now())}`);
  router.push(href as Href);
}

/** Closes the page on top (Back). With nothing to go back to (a deep link) it lands on Home. */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** A tab root, with or without a query. Keep aligned with the tab bar's destinations. */
export const isTabRoot = (path: string) => ["/", "/health", "/workout", "/journal", "/more"].includes(path.split("?")[0]);

/**
 * Opens a link from outside a tap (a notification, a launcher shortcut, another app). A tab root first closes what is
 * stacked over the tabs: pushing or navigating to a tab under a detail screen left that screen on top.
 */
export function openLink(path: string) {
  if (isTabRoot(path)) {
    if (router.canDismiss()) router.dismissAll();
    router.navigate(path as Href);
  } else router.push(path as Href);
}
