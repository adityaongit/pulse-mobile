// Paced breathing for Breathe (`/breathe`): the protocols, the haptic cue schedule and the phase clock that the screen's
// label, its haptics and the breathing circle all read from one start time. Ported from noop's analytics/
// BreathPacer.kt, BreathProtocol.kt and BreathProtocolCatalog.kt (© 2026 NoopApp, PolyForm Noncommercial 1.0.0): the
// cue language (one light pulse on an inhale, two on an exhale, holds silent), the pace clamps and rounding, and the
// catalog's box and 4-7-8 timings and copy. Phone additions: the physiological sigh (two inhales, one long exhale;
// Balban et al., Cell Reports Medicine 2023), sessions rounded to whole breaths, and the circle's level curve.
// Pure: no React Native, so vitest runs it.
import { i18n } from "@/i18n/config";

export type BreathPhase = "inhale" | "hold" | "exhale";

export type BreathStage = {
  phase: BreathPhase;
  ms: number;
  /** What the screen says during it; PHASE_LABEL by default. */
  label?: string;
  /** The circle's size at the end of the stage: 0 empty … 1 full. A stage eases from the previous stage's level. */
  level: number;
};

export type BreathProtocolId = "resonance" | "box" | "478" | "sigh";

export type BreathProtocol = {
  id: BreathProtocolId;
  title: string;
  /** One line under the title in the picker. */
  subtitle: string;
  edu: string;
  caution?: string;
  stages: BreathStage[];
};

/** One haptic cue: `loops` pulses `offsetMs` after the start, marking the start of stage `stage`. */
export type BreathCue = { offsetMs: number; phase: BreathPhase; loops: number; stage: number; label?: string };

/** Getters, so the words resolve in the language in use when they are read. */
export const PHASE_LABEL: Record<BreathPhase, string> = {
  get inhale() { return i18n.t("ui:breath.phaseInhale") },
  get hold() { return i18n.t("ui:breath.phaseHold") },
  get exhale() { return i18n.t("ui:breath.phaseExhale") },
};

// ── The pacer (BreathPacer.kt) ──────────────────────────────────────────────

/** Pulses for an inhale onset (one light) and an exhale onset (two, heavier); holds are silent. */
export const INHALE_LOOPS = 1;
export const EXHALE_LOOPS = 2;
/** The calming long-exhale split noop's pacer defaults to: 40 % of the breath in, 60 % out. */
export const DEFAULT_INHALE_FRACTION = 0.4;
/** Slowest and fastest paces scheduled, breaths a minute; anything outside is clamped. */
export const MIN_BPM = 3;
export const MAX_BPM = 12;

export const loopsFor = (phase: BreathPhase): number => (phase === "inhale" ? INHALE_LOOPS : phase === "exhale" ? EXHALE_LOOPS : 0);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * One breath at `bpm` breaths a minute as an inhale and an exhale stage, split by `inhaleFraction`. Whole
 * milliseconds, rounded as noop's pacer does, so offsets never drift: cycle = round(60000 / bpm), inhale =
 * round(cycle × fraction), exhale the rest. `bpm` clamps to 3–12 and the fraction to 0.1–0.9.
 */
export function pacedStages(bpm: number, inhaleFraction = DEFAULT_INHALE_FRACTION): BreathStage[] {
  const cycleMs = Math.round(60_000 / clamp(bpm, MIN_BPM, MAX_BPM));
  const inhaleMs = Math.round(cycleMs * clamp(inhaleFraction, 0.1, 0.9));
  return [
    { phase: "inhale", ms: inhaleMs, level: 1 },
    { phase: "exhale", ms: cycleMs - inhaleMs, level: 0 },
  ];
}

// ── The catalog (BreathProtocolCatalog.kt, four of its paces plus the sigh) ──

export const PROTOCOLS: readonly BreathProtocol[] = [
  {
    id: "resonance",
    get title() { return i18n.t("ui:breath.resonanceTitle") },
    get subtitle() { return i18n.t("ui:breath.resonanceSubtitle") },
    get edu() { return i18n.t("ui:breath.resonanceEdu") },
    stages: pacedStages(5.5, 0.5),
  },
  {
    id: "box",
    get title() { return i18n.t("ui:breath.boxTitle") },
    get subtitle() { return i18n.t("ui:breath.boxSubtitle") },
    get edu() { return i18n.t("ui:breath.boxEdu") },
    stages: [
      { phase: "inhale", ms: 4_000, level: 1 },
      { phase: "hold", ms: 4_000, level: 1 },
      { phase: "exhale", ms: 4_000, level: 0 },
      { phase: "hold", ms: 4_000, level: 0 },
    ],
  },
  {
    id: "478",
    get title() { return i18n.t("ui:breath.p478Title") },
    get subtitle() { return i18n.t("ui:breath.p478Subtitle") },
    get edu() { return i18n.t("ui:breath.p478Edu") },
    get caution() { return i18n.t("ui:breath.p478Caution") },
    stages: [
      { phase: "inhale", ms: 4_000, level: 1 },
      { phase: "hold", ms: 7_000, level: 1 },
      { phase: "exhale", ms: 8_000, level: 0 },
    ],
  },
  {
    id: "sigh",
    get title() { return i18n.t("ui:breath.sighTitle") },
    get subtitle() { return i18n.t("ui:breath.sighSubtitle") },
    get edu() { return i18n.t("ui:breath.sighEdu") },
    stages: [
      { phase: "inhale", ms: 3_000, level: 0.78 },
      { phase: "inhale", ms: 1_000, get label() { return i18n.t("ui:breath.topUp") }, level: 1 },
      { phase: "exhale", ms: 6_000, get label() { return i18n.t("ui:breath.exhaleSlowly") }, level: 0 },
    ],
  },
];

export const protocolById = (id: string): BreathProtocol | undefined => PROTOCOLS.find((p) => p.id === id);

/** The session lengths offered, minutes. */
export const DURATIONS = [1, 3, 5] as const;
export type BreathMinutes = (typeof DURATIONS)[number];

export const cycleMs = (stages: readonly BreathStage[]): number => stages.reduce((a, s) => a + Math.max(0, s.ms), 0);

/** Breaths a minute for a protocol's cycle (5.5 for resonance, 3.75 for box). */
export const breathsPerMinute = (stages: readonly BreathStage[]): number => {
  const c = cycleMs(stages);
  return c > 0 ? 60_000 / c : 0;
};

/**
 * A session of about `minutes`, rounded to whole breaths so it ends on an exhale (or its hold) rather than mid-breath:
 * 1 min of box is 4 breaths (64 s), 1 min of 4-7-8 is 3 (57 s). At least one breath.
 */
export function planSession(stages: readonly BreathStage[], minutes: number): { cycles: number; durationMs: number } {
  const c = cycleMs(stages);
  if (c <= 0) return { cycles: 0, durationMs: 0 };
  const cycles = Math.max(1, Math.round((minutes * 60_000) / c));
  return { cycles, durationMs: cycles * c };
}

/**
 * The haptic cues for a session of `sessionMs` (BreathProtocolPlayer.schedule): one per stage start, in time order,
 * until the session ends; stages of no length are skipped. A hold's cue has no pulses (the screen still changes).
 */
export function scheduleCues(stages: readonly BreathStage[], sessionMs: number): BreathCue[] {
  if (!(sessionMs >= 1)) return [];
  const live = stages.map((s, i) => ({ s, i })).filter((x) => x.s.ms > 0);
  const c = cycleMs(stages);
  if (!live.length || c <= 0) return [];
  const out: BreathCue[] = [];
  const maxCycles = Math.max(1, Math.floor(sessionMs / c) + 2);
  for (let base = 0, n = 0; base < sessionMs && n < maxCycles; base += c, n++) {
    let offset = base;
    for (const { s, i } of live) {
      if (offset >= sessionMs) break;
      out.push({ offsetMs: offset, phase: s.phase, loops: loopsFor(s.phase), stage: i, ...(s.label ? { label: s.label } : {}) });
      offset += s.ms;
    }
  }
  return out;
}

// ── The phase clock ─────────────────────────────────────────────────────────

export type PhaseAt = {
  /** Index into the stages. */
  stage: number;
  /** Whole breaths finished before this one. */
  cycle: number;
  /** Session ms the stage started and ends at. */
  start: number;
  end: number;
};

/** Where `t` ms into the session falls: the stage and its bounds. Negative `t` counts as 0. */
export function phaseAt(stages: readonly BreathStage[], t: number): PhaseAt {
  const c = cycleMs(stages);
  if (c <= 0 || !stages.length) return { stage: 0, cycle: 0, start: 0, end: 0 };
  const at = Math.max(0, t);
  const cycle = Math.floor(at / c);
  let start = cycle * c;
  for (let i = 0; i < stages.length; i++) {
    const end = start + Math.max(0, stages[i].ms);
    if (at < end) return { stage: i, cycle, start, end };
    start = end;
  }
  // Floating-point edge at the very end of a cycle: the next breath's first stage.
  return { stage: 0, cycle: cycle + 1, start, end: start + Math.max(0, stages[0].ms) };
}

/** Whole seconds left in the stage at `t` (4, 3, 2, 1), for the count inside the circle. */
export const secondsLeft = (p: PhaseAt, t: number): number => Math.max(1, Math.ceil((p.end - t) / 1000));

/** The label a stage shows. */
export const stageLabel = (s: BreathStage): string => s.label ?? PHASE_LABEL[s.phase];

/**
 * The breathing circle's size (0…1) `t` ms into the session, run on the UI thread every frame. Stage i eases from
 * the level the stage before it ends on (the last stage's, for the first) to its own, on a sine in-out curve, the way
 * a breath fills and empties; `stepped` (reduce motion) holds each stage's level from its start. `ms` and `levels`
 * are the stages' lengths and end levels, as plain arrays a worklet can capture.
 */
export function levelAt(ms: readonly number[], levels: readonly number[], t: number, stepped: boolean): number {
  "worklet";
  const n = ms.length;
  if (n === 0) return 0;
  let cycle = 0;
  for (let i = 0; i < n; i++) cycle += ms[i] > 0 ? ms[i] : 0;
  if (cycle <= 0) return levels[n - 1];
  let at = t < 0 ? 0 : t % cycle;
  for (let i = 0; i < n; i++) {
    const d = ms[i] > 0 ? ms[i] : 0;
    if (at < d) {
      const from = levels[(i + n - 1) % n];
      const to = levels[i];
      if (stepped) return to;
      const p = at / d;
      return from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * p));
    }
    at -= d;
  }
  return levels[n - 1];
}
