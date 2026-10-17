/**
 * The corner radii of tailwind.config.js (the web's rounded-* scale, in px), by the same names, for what a class cannot
 * reach: a style object, a Glass `radius`, a native sheet's corners. radius.test.ts keeps the two equal.
 */
export const RADIUS = { xs: 2, sm: 4, md: 8, lg: 10, xl: 12, "2xl": 16, "3xl": 24, "4xl": 28 } as const;

/**
 * Bars, tracks and dashes (progress, ranges, breakdowns, the status dashes): WHOOP draws them square with barely softened
 * corners, never with pill ends, so every one takes the 2 px `rounded-xs`.
 */
export const BAR_CORNERS = "rounded-xs";

/** The floating glass chrome (tab bar, check-in action): the web's rounded-[22px]. */
export const GLASS_RADIUS = 22;
