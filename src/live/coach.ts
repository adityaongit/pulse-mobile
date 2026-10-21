// Strain Coach for Live Workout: the moment-to-moment half. Watches the live heart rate against a target band gated by
// today's Recovery and says when to push or ease off, at most one cue at a time and silence when on track. Ported
// constant for constant (one exception, marked) from noop's analytics/LiveSessionEngine.kt (© 2026 NoopApp, PolyForm
// Noncommercial 1.0.0), with noop's charge as Pulse's Recovery (0–100) and time in (fractional) seconds. Its rules:
//
//   1. A wrong buzz is worse than a missed one: dwell, cool-down and hysteresis bias hard toward silence.
//   2. Never fabricate: impossible samples are rejected before they can cue, and a stale stream pauses coaching.
//
// Then `guidance()` puts that together with Day Strain against today's Strain Target (the WHOOP-like half: push
// toward the range, ease off once in it or past it) as the line the screen shows. Pure, for vitest.
import { i18n } from "@/i18n/config";

// ── Tuning (noop's values) ───────────────────────────────────────────────────
export const CEILING_PCT_LOW_CHARGE = 0.6;
export const CEILING_PCT_HIGH_CHARGE = 0.82;
export const BAND_WIDTH_PCT_HRR = 0.15;
export const MIN_FLOOR_PCT_HRR = 0.4;
export const DEFAULT_CHARGE_FRACTION = 0.5;

export const SMOOTHING_WINDOW_S = 12;
export const STALE_AFTER_S = 8;
export const WARMUP_S = 60;
export const CLIMB_GRACE_S = 45;

export const DWELL_S = 25;
export const COOLDOWN_S = 50;
export const HYSTERESIS_BPM = 2;
export const MAX_ACCRUAL_DT_S = 5;

export const STEP_CHANGE_BPM = 8;
export const STEP_CHANGE_WINDOW_S = 15;
export const CLIMB_ATTRIBUTION_S = 20;

export const CEILING_DRIFT_AFTER_S = 90;
export const CEILING_DRIFT_STEP_BPM = 2;
export const CEILING_DRIFT_MAX_BPM = 8;

export const MIN_PLAUSIBLE_BPM = 25;
/**
 * noop rejects anything 5 bpm over HRmax. Pulse's max is often Tanaka's estimate, which a hard interval can pass, and
 * a rejected beat reads as a dropped stream, so here the cut-off is 20 bpm over it.
 */
export const ABOVE_HRMAX_REJECT_BPM = 20;
export const MAX_JUMP_BPM = 45;

export type CoachConfig = { restingHr: number; maxHr: number; /** Today's Recovery, 0–100; null is the midpoint. */ recovery: number | null };
export type Band = { floorBpm: number; ceilingBpm: number; floorPctHRR: number; ceilingPctHRR: number };
export type CoachStatus = "warmup" | "active" | "stale";
export type Position = "below" | "inBand" | "above";
export type Cue = "push" | "easeOff";

export type CoachOutput = {
  status: CoachStatus;
  position: Position;
  /** Median bpm of the last 12 s; null while stale. */
  smoothedBpm: number | null;
  band: Band;
  inBandSeconds: number;
  sampleArrived: boolean;
  cue: Cue | null;
};

/** The Recovery-gated target band: Recovery scales the ceiling from 60 % to 82 % of reserve; the floor sits 15 % below (40 % at least). */
export function band(c: CoachConfig): Band {
  const cn = c.recovery == null ? DEFAULT_CHARGE_FRACTION : Math.min(1, Math.max(0, c.recovery / 100));
  const ceilingPct = CEILING_PCT_LOW_CHARGE + (CEILING_PCT_HIGH_CHARGE - CEILING_PCT_LOW_CHARGE) * cn;
  const floorPct = Math.max(ceilingPct - BAND_WIDTH_PCT_HRR, MIN_FLOOR_PCT_HRR);
  const reserve = Math.max(c.maxHr - c.restingHr, 1);
  return { floorBpm: c.restingHr + floorPct * reserve, ceilingBpm: c.restingHr + ceilingPct * reserve, floorPctHRR: floorPct, ceilingPctHRR: ceilingPct };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** One per session; `update(now, bpm)` with every sample, and `update(now, null)` as a clock tick. Seconds. */
export class LiveCoach {
  private readonly base: Band;
  private buffer: { ts: number; bpm: number }[] = [];
  private history: { ts: number; s: number }[] = [];
  private lastUpdateTs: number;
  private lastValidTs: number | null = null;
  private lastAcceptedBpm: number | null = null;
  private position: Position = "inBand";
  private inBandSeconds = 0;
  private belowSince: number | null = null;
  private aboveSince: number | null = null;
  private aboveSlowSince: number | null = null;
  private lastClimb: number | null = null;
  private lastPush: number | null = null;
  private lastEase: number | null = null;
  private drift = 0;

  constructor(
    private readonly config: CoachConfig,
    private readonly startTs: number,
  ) {
    this.base = band(config);
    this.lastUpdateTs = startTs;
  }

  update(now: number, bpm: number | null): CoachOutput {
    const dt = Math.max(now - this.lastUpdateTs, 0);

    // 1. Validate and accept the sample.
    let sampleArrived = false;
    if (bpm !== null && this.plausible(bpm, now)) {
      this.buffer.push({ ts: now, bpm });
      this.lastValidTs = now;
      this.lastAcceptedBpm = bpm;
      sampleArrived = true;
    }

    // 2. The smoothing window's median.
    this.buffer = this.buffer.filter((r) => r.ts >= now - SMOOTHING_WINDOW_S);
    const smoothed = this.buffer.length ? median(this.buffer.map((r) => r.bpm)) : null;

    // 3. Stale: coaching pauses, nothing accrues, dwell freezes.
    const sinceValid = this.lastValidTs !== null ? now - this.lastValidTs : now - this.startTs;
    const b = this.currentBand();
    if (sinceValid > STALE_AFTER_S || smoothed === null) {
      this.lastUpdateTs = now;
      return { status: "stale", position: this.position, smoothedBpm: null, band: b, inBandSeconds: this.inBandSeconds, sampleArrived, cue: null };
    }
    const s = smoothed;

    // 4. A sharp climb on the smoothed trend.
    this.history.push({ ts: now, s });
    this.history = this.history.filter((h) => h.ts >= now - STEP_CHANGE_WINDOW_S - 2);
    const past = this.history.find((h) => now - h.ts >= STEP_CHANGE_WINDOW_S);
    if (past && s - past.s >= STEP_CHANGE_BPM) this.lastClimb = now;

    // 5. Against the band, with hysteresis.
    const next = this.classify(s, b);

    // 6. Dwell trackers.
    if (next === "below") {
      if (this.position !== "below") this.belowSince = now;
      this.aboveSince = null;
      this.aboveSlowSince = null;
    } else if (next === "above") {
      if (this.position !== "above") {
        this.aboveSince = now;
        const fromClimb = this.lastClimb !== null && now - this.lastClimb <= CLIMB_ATTRIBUTION_S;
        this.aboveSlowSince = fromClimb ? null : now;
      }
      this.belowSince = null;
    } else {
      this.belowSince = null;
      this.aboveSince = null;
      this.aboveSlowSince = null;
    }

    // 7. In-band time (dt clamped so a stall can't inflate it).
    if (next === "inBand") this.inBandSeconds += Math.min(dt, MAX_ACCRUAL_DT_S);

    // 8. Status.
    const status: CoachStatus = now - this.startTs < WARMUP_S ? "warmup" : "active";

    // 9. One cue at most, silence by default.
    let cue: Cue | null = null;
    if (status === "active") {
      const below = this.belowSince;
      const above = this.aboveSince;
      if (
        next === "below" &&
        below !== null &&
        now - below >= DWELL_S &&
        (this.lastPush === null || now - this.lastPush >= COOLDOWN_S) &&
        (this.lastClimb === null || now - this.lastClimb >= CLIMB_GRACE_S)
      ) {
        cue = "push";
        this.lastPush = now;
        this.belowSince = now;
      } else if (
        next === "above" &&
        above !== null &&
        now - above >= DWELL_S &&
        (this.lastEase === null || now - this.lastEase >= COOLDOWN_S) &&
        // Only a step-change breach earns an ease-off; a slow drift above moves the ceiling instead.
        this.aboveSlowSince === null
      ) {
        cue = "easeOff";
        this.lastEase = now;
        this.aboveSince = now;
      }
    }

    // 10. Ceiling drift: adapt (bounded) to a genuinely strong, slowly drifting day.
    const slow = this.aboveSlowSince;
    if (next === "above" && slow !== null && now - slow >= CEILING_DRIFT_AFTER_S && this.drift < CEILING_DRIFT_MAX_BPM) {
      this.drift = Math.min(this.drift + CEILING_DRIFT_STEP_BPM, CEILING_DRIFT_MAX_BPM);
      this.aboveSlowSince = now;
    }

    this.position = next;
    this.lastUpdateTs = now;
    return { status, position: next, smoothedBpm: s, band: b, inBandSeconds: this.inBandSeconds, sampleArrived, cue };
  }

  private currentBand(): Band {
    if (this.drift === 0) return this.base;
    const reserve = Math.max(this.config.maxHr - this.config.restingHr, 1);
    const ceilingBpm = this.base.ceilingBpm + this.drift;
    return { ...this.base, ceilingBpm, ceilingPctHRR: (ceilingBpm - this.config.restingHr) / reserve };
  }

  private plausible(bpm: number, now: number): boolean {
    if (bpm < MIN_PLAUSIBLE_BPM) return false;
    if (bpm > this.config.maxHr + ABOVE_HRMAX_REJECT_BPM) return false;
    const last = this.lastAcceptedBpm;
    const lastTs = this.lastValidTs;
    return !(last !== null && lastTs !== null && now - lastTs <= SMOOTHING_WINDOW_S && Math.abs(bpm - last) > MAX_JUMP_BPM);
  }

  private classify(s: number, b: Band): Position {
    const m = HYSTERESIS_BPM;
    if (s > b.ceilingBpm + m) return "above";
    if (s < b.floorBpm - m) return "below";
    if (s >= b.floorBpm + m && s <= b.ceilingBpm - m) return "inBand";
    return this.position; // inside the margin: hold, don't flicker
  }
}

// ── The line on screen ───────────────────────────────────────────────────────

export type GuidanceTone = "push" | "steady" | "ease" | "wait";
export type Guidance = { tone: GuidanceTone; title: string; body: string };

/** Strain as a whole percent: "42%". */
const pct = (x: number) => `${Math.round(x)}%`;
const t = (key: string, o?: Record<string, unknown>) => i18n.t(`ui:guidance.${key}` as never, o as never) as unknown as string;

/**
 * What to do now. Day Strain against today's target decides first (past the range: ease off; in it: hold or ease off;
 * below it: push), then the heart rate against the Recovery-gated band says how. Without a target the band alone
 * speaks. `minutesToLow` is the time to the bottom of the range at the current effort, when known.
 */
export function guidance(o: {
  strain: number;
  target: readonly [number, number] | null;
  coach: Pick<CoachOutput, "status" | "position" | "band">;
  minutesToLow: number | null;
}): Guidance {
  const { strain, target, coach, minutesToLow } = o;
  const floor = Math.round(coach.band.floorBpm);
  const ceiling = Math.round(coach.band.ceilingBpm);
  const range = target ? `${Math.round(target[0])} - ${pct(target[1])}` : null;

  if (target && strain >= target[1]) return { tone: "ease", title: t("easeTitle"), body: t("reachedBody", { range }) };
  if (coach.status === "stale") return { tone: "wait", title: t("waitingTitle"), body: t("waitingBody") };
  if (coach.status === "warmup") return { tone: "wait", title: t("warmingTitle"), body: t("warmingBody", { floor, ceiling }) };

  if (target && strain >= target[0]) {
    if (coach.position === "above") return { tone: "ease", title: t("inRangeEaseTitle"), body: t("inRangeEaseBody", { range, ceiling }) };
    return { tone: "steady", title: t("inRangeTitle"), body: t("inRangeBody", { strain: pct(strain), range }) };
  }

  // "About a minute" under 1.5, else "about N minutes": the plural key takes the count.
  const eta = target && minutesToLow !== null && minutesToLow > 0 ? t("eta", { count: minutesToLow < 1.5 ? 1 : Math.round(minutesToLow), pct: pct(target[0]) }) : null;
  if (coach.position === "below")
    return { tone: "push", title: t("pushTitle"), body: target ? t("pushBodyGap", { floor, gap: pct(target[0] - strain) }) : t("pushBody", { floor }) };
  if (coach.position === "above") return { tone: "ease", title: t("easeTitle"), body: eta ? t("aboveBodyEta", { ceiling, eta }) : t("aboveBody", { ceiling }) };
  return { tone: "steady", title: t("onTrackTitle"), body: eta ? t("holdBodyEta", { floor, ceiling, eta }) : t("holdBody", { floor, ceiling }) };
}
