// Applies the person's units and clock (src/lib/units.ts) from their profile, or the phone's own before they choose in
// Settings › App. The app state calls it whenever the profile changes; the background task when it reads the profile.
import { getCalendars, getLocales } from "expo-localization";
import type { Profile } from "@/data/types";
import { type DisplayPrefs, setDisplayPrefs } from "@/lib/units";

/**
 * The phone's region and clock: imperial where the region measures in US units (the United States, Liberia, Myanmar),
 * a 12-hour clock where the phone uses one. Elsewhere metric and 24 hours, the app's long-standing default; the UK's
 * mix of miles and stones has no single choice, so it stays metric until the person picks.
 */
export function deviceDisplayPrefs(): DisplayPrefs {
  return {
    units: getLocales()[0]?.measurementSystem === "us" ? "imperial" : "metric",
    hours: getCalendars()[0]?.uses24hourClock === false ? 12 : 24,
  };
}

export const applyDisplay = (profile: Profile | null) => setDisplayPrefs(profile?.display ?? deviceDisplayPrefs());
