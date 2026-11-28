// HRV Status: Halo's own implementation of Garmin's published HRV Status (Garmin health-science pages, "HRV Status",
// accessed 2026-10; Forerunner 970 manual, 2026): your 7-day average of overnight HRV against your own baseline range,
// read Balanced, Unbalanced or Low. Garmin's baseline maths is unpublished; this follows the report's spec
// (docs/research/whoop-garmin.md N-1, 2026-10-09) on ln(RMSSD), the scale HRV monitoring uses (Plews et al. 2013).

export const hrvStatusConfig = {
  /** The recent average: the last 7 nights, from at least 4 with a value (published 7-day average; the 4 is a guess). */
  weekNights: 7,
  minWeekNights: 4,
  /**
   * The baseline: the 60 nights before the last 7, from at least 14. Garmin shows a status after about 3 weeks of nights
   * (published), and so does the card's copy: 14 baseline nights and the 7-night week make the 21.
   */
  baselineNights: 60,
  minBaselineNights: 14,
  /** Balanced within μ ± 0.75σ; Low under μ − 1.5σ (guess, report G-7 / N-1). */
  balancedSd: 0.75,
  lowSd: 1.5,
  /** σ (ln units) is never taken under this, so a very steady history still has a band (calibrated: about ±4 % in ms). */
  minSd: 0.05,
};

export type HrvStatusKind = "balanced" | "unbalanced" | "low";

export type HrvStatus =
  | {
      status: HrvStatusKind;
      /** For Unbalanced: above or below the band. */
      direction: "high" | "low" | null;
      /** Last night's HRV, ms, or null. */
      lastNight: number | null;
      /** The 7-day average, ms (geometric: e^ of the mean ln). */
      weekAverage: number;
      /** The balanced band and the Low line, ms. */
      band: { low: number; high: number };
      lowLine: number;
      baselineNights: number;
    }
  | { status: null; reason: "building"; baselineNights: number; lastNight: number | null }
  | { status: null; reason: "no_recent"; baselineNights: number; lastNight: number | null };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sampleSd = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : 0;
};

/**
 * HRV Status from nightly HRV (ms), one entry per calendar night, oldest first, the last being today's night (null where
 * a night has none).
 */
export function hrvStatus(nights: readonly (number | null)[]): HrvStatus {
  const c = hrvStatusConfig;
  const ln = (v: number | null) => (v != null && v > 0 ? Math.log(v) : null);
  const lastNight = nights.at(-1) ?? null;
  const week = nights.slice(-c.weekNights).map(ln).filter((v): v is number => v != null);
  const base = nights
    .slice(-(c.weekNights + c.baselineNights), -c.weekNights)
    .map(ln)
    .filter((v): v is number => v != null);
  if (base.length < c.minBaselineNights) return { status: null, reason: "building", baselineNights: base.length, lastNight };
  if (week.length < c.minWeekNights) return { status: null, reason: "no_recent", baselineNights: base.length, lastNight };
  const mu = mean(base);
  const sd = Math.max(sampleSd(base), c.minSd);
  const m7 = mean(week);
  const band = { low: Math.exp(mu - c.balancedSd * sd), high: Math.exp(mu + c.balancedSd * sd) };
  const lowLine = Math.exp(mu - c.lowSd * sd);
  const weekAverage = Math.exp(m7);
  const status: HrvStatusKind = m7 < mu - c.lowSd * sd ? "low" : m7 >= mu - c.balancedSd * sd && m7 <= mu + c.balancedSd * sd ? "balanced" : "unbalanced";
  const direction = status === "unbalanced" ? (m7 > mu ? "high" : "low") : null;
  return { status, direction, lastNight, weekAverage, band, lowLine, baselineNights: base.length };
}
