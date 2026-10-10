// Pure parts of the Pulse Age orb (pulse docs/design/orb.md): colour mapping, shape noise, seeded RNG. Ported from pulse
// src/lib/orb.ts. Differences: tokens are the palette's names (`orb-green`, no `--`), and the functions the orb's frame
// loop calls carry the "worklet" directive because the loop runs on the UI thread (Reanimated). The CSS-only helpers
// (`cssMix`, `hexRGB`: the server-render fallback blob) are not ported: there is no server render.

export type RGB = readonly [number, number, number];

/** A palette token name (src/ui/palette.ts holds every orb colour). */
export type Token = `orb-${string}`;
/** A colour stop: `at` is Pulse Age minus chronological age, in years. Rim colour tokens at the top and bottom of the orb. */
type Stop = { at: number; top: Token; bottom: Token };

/**
 * Every tunable in one place. Hues are palette tokens (`orb-*`), the brightest rim pixels sampled with PIL from
 * pulse docs/design/reference/latest-age-orb-*.jpg (orb.md says which file gave which).
 */
export const ORB = {
  stops: [
    // Hue families from WHOOP Age screenshots of the 2025-26 app, spread so each step reads as its own colour:
    // green → blue-green → cyan → blue (level) → blue over warm → amber → rust → red.
    { at: -7, top: "orb-green", bottom: "orb-green" }, // 7.0, 8.2 and 8.9 younger
    { at: -4, top: "orb-teal", bottom: "orb-teal" }, // blue-green
    { at: -1.5, top: "orb-cyan", bottom: "orb-cyan" }, // cyan-1: 1.0 younger
    { at: 0, top: "orb-blue", bottom: "orb-blue" }, // level: blue
    { at: 0.8, top: "orb-blue", bottom: "orb-olive" }, // mixed-1: 0.8 older, blue over olive
    { at: 2.1, top: "orb-blue-2", bottom: "orb-orange" }, // mixed-2: 2.1 older, blue over orange
    { at: 3, top: "orb-amber", bottom: "orb-amber" }, // 2.6 to 5.6 older: amber-brown
    { at: 7, top: "orb-rust", bottom: "orb-rust" }, // brown-red
    // ponytail: no screenshot past 10 older; red at 12 extends the warm run, retune with a reference.
    { at: 12, top: "orb-red", bottom: "orb-red" },
  ] satisfies Stop[],
  /** No result: a dim grey orb. */
  empty: "orb-empty" as Token,
  /** Delta line inside the orb: pale cyan (amber-1, cyan-1, mixed-1), mint (`text-optimal-text`) once the orb is green. */
  deltaText: "orb-delta-text" as Token,
  greenText: -2,
  /** Rim fill = edge colour × this; particles and the edge line are brighter tints. */
  fillShade: 0.68,
  shape: {
    /** Radius of the blob relative to half the box, leaving room for the bulges. */
    radius: 0.9,
    lowFreq: 0.85,
    lowAmp: 0.075,
    highFreq: 2.1,
    highAmp: 0.028,
    /** Small orbs (Health hub, < 160 px) are visibly more lobed in the references. */
    smallHighAmp: 0.05,
    /** How fast the noise field drifts, units per second. Slow. */
    drift: 0.05,
  },
  particles: {
    /** Particles at 320 px; scaled by area and clamped. */
    at320: 3000,
    min: 280,
    max: 3000,
    /** Share of tiny dust, crisp dots, soft bokeh discs. */
    mix: [0.68, 0.27, 0.05] as const,
  },
  entry: { duration: 1.2, maxDelay: 0.35 },
  /** Idle drift stops after this long without interaction (WCAG 2.2.2); touch or re-entering view resumes it. */
  idleSeconds: 30,
  /** Touch: particles gather toward the centre and swirl (latest-age-orb-touch-frames.jpg). */
  touch: { ease: 5, swirl: 1.1, wobble: 0.6, bulge: 0.06 },
  /** The web's per-theme CSS variables `--orb-lift`, `--orb-sparkle` and `--orb-blend` (globals.css): the palette holds colours only. */
  theme: {
    dark: { lift: 1.3, sparkle: 0.12, additive: true },
    light: { lift: 1, sparkle: 0, additive: false },
  },
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => {
  "worklet";
  return a + (b - a) * t;
};

export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const shadeRGB = (c: RGB, k: number): RGB => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
/** Skia takes the comma form. */
export const rgba = (c: RGB, a = 1) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;

/** The two stops around a Pulse Age delta and how far between them; `null` (no result) is the empty orb. */
export function orbStops(delta: number | null): { top: [Token, Token]; bottom: [Token, Token]; t: number } {
  if (delta === null || !Number.isFinite(delta)) return { top: [ORB.empty, ORB.empty], bottom: [ORB.empty, ORB.empty], t: 0 };
  const s = ORB.stops;
  const d = clamp(delta, s[0].at, s[s.length - 1].at);
  const i = Math.max(0, s.findIndex((x) => x.at >= d) - 1);
  const a = s[i];
  const b = s[Math.min(i + 1, s.length - 1)];
  const t = b.at === a.at ? 0 : (d - a.at) / (b.at - a.at);
  return { top: [a.top, b.top], bottom: [a.bottom, b.bottom], t };
}

/** Rim colours for a Pulse Age delta (years older is positive), with `rgb` resolving a token. */
export function orbColors(delta: number | null, rgb: (token: Token) => RGB): { top: RGB; bottom: RGB } {
  const { top, bottom, t } = orbStops(delta);
  return { top: mixRGB(rgb(top[0]), rgb(top[1]), t), bottom: mixRGB(rgb(bottom[0]), rgb(bottom[1]), t) };
}

/** Integer hash to [0, 1). */
function hash2(x: number, y: number) {
  "worklet";
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 2D value noise in [-1, 1], smooth and deterministic. */
export function noise2(x: number, y: number) {
  "worklet";
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const top = lerp(hash2(xi, yi), hash2(xi + 1, yi), u);
  const bot = lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u);
  return lerp(top, bot, v) * 2 - 1;
}

/**
 * Blob radius multiplier at angle `theta` and time `t` (seconds). Sampling the noise on a circle keeps the edge
 * closed; drifting the sample centre over time morphs it. `wobble` scales the bumps (1 at rest, more on touch).
 */
export function blobRadius(theta: number, t: number, seed: number, small = false, wobble = 1) {
  "worklet";
  const s = ORB.shape;
  const c = Math.cos(theta);
  const n = Math.sin(theta);
  const o = t * s.drift;
  const low = noise2(seed + c * s.lowFreq + o, seed * 0.37 + n * s.lowFreq + o * 0.6);
  const high = noise2(seed * 1.9 + c * s.highFreq - o * 1.3, 11 + n * s.highFreq + o);
  return 1 + wobble * (s.lowAmp * low + (small ? s.smallHighAmp : s.highAmp) * high);
}

/** How many particles an orb of `size` px gets. */
export const particleCount = (size: number) => Math.round(clamp(ORB.particles.at320 * (size / 320) ** 2, ORB.particles.min, ORB.particles.max));

/** Seeded RNG (mulberry32) so the same orb draws the same particles on every render. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const easeOutCubic = (t: number) => {
  "worklet";
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - x) ** 3;
};
