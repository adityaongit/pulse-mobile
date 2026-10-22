// Calories in against calories out: the zone a day's intake falls in against that day's goal, and the day's balance.
// Pure TypeScript, so the tests run in node.

export type BalanceZone = "under" | "in" | "over";

/** Intake below ZONE_LOW of the goal is Under; above ZONE_HIGH it is Over; between (ends included) is In zone. */
export const ZONE_LOW = 0.9;
export const ZONE_HIGH = 1.1;

/** The zone of `kcalIn` against `goal`. */
export function zoneOf(kcalIn: number, goal: number): BalanceZone {
  const share = kcalIn / goal;
  return share < ZONE_LOW ? "under" : share > ZONE_HIGH ? "over" : "in";
}

/** Intake minus burn, rounded: negative is a deficit, positive a surplus. Null when either side is unknown. */
export function balanceOf(kcalIn: number | null, kcalOut: number | null): number | null {
  return kcalIn === null || kcalOut === null ? null : Math.round(kcalIn - kcalOut);
}
