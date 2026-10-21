// Pulse Age hero (pulse docs/design/orb.md), ported from pulse src/components/metrics/AgeOrb.tsx by way of halo's
// src/screens/health/AgeOrb.tsx. The web redraws a 2D canvas every frame; here each part of the orb is a static SVG
// drawn once per size, delta and theme, and only the views around them move (transform and opacity, Reanimated styles
// on the UI thread), so a frame costs a few composited layers and no geometry. See docs/learning.md ("The Pulse Age orb").
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AppState, StyleSheet, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { useIsFocused } from "expo-router";
import { useTranslation } from "react-i18next";
import Animated, { cancelAnimation, Easing, Keyframe, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";
import { AGE_LABEL, formatValue } from "@/lib/format";
import { reasonCopy, type ReasonCode } from "@/lib/reasons";
import { parseColor } from "@/ui/color";
import { VALUES, type TokenName } from "@/ui/palette";
import { useNarrow } from "@/ui/shells/layout";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { EASE } from "@/ui/motion";
import { haptic } from "@/ui/haptics";
import { ageDelta } from "./format";
import { blobRadius, mixRGB, ORB, orbColors, particleCount, particleLayer, rgba, rng, shadeRGB, swirlVelocity, type RGB, type Token } from "./orb";

export type AgeOrbProps = {
  /** Pulse Age, the number in the middle. */
  age: number | null;
  /** Pulse Age minus chronological age; positive is older. */
  deltaYears: number | null;
  provisional?: boolean;
  /** Box size in px (default 300, compact 108), capped to the page column. Below 160 it drops the delta line (Health hub, collapsed header). */
  size?: number;
  reason?: ReasonCode | null;
  /** The sticky header's mini orb: same colours, the age and label inside, one settled frame (no loop, no touch). */
  compact?: boolean;
};

const BANDS = 8;
const STEPS = 128;
const TAU = Math.PI * 2;
/** The settled frame (the web's `draw(10, 0)`): the layers are drawn at this time. */
const SETTLED_T = 10;
/** The SVG particle budget, and the share of dust motes it keeps. */
const MAX_PARTICLES = 640;
const DUST_EVERY = 3;
/** A finger that moves this far is scrolling, not holding the orb. */
/** The web's lean (gather × (1 − depth), inner particles at depth 0.18 to 0.73) and outline bulge, against the aim. */
const LEAN = 0.5;
const BULGE = 0.12;
const M = ORB.motion;
const S = M.swirl;
/** The release's coast: a decay at `deceleration` per ms as a timing of the same distance and start speed. */
const COAST_MS = 2300;
const COAST_K = (1 - S.deceleration) * COAST_MS;
const COAST_NORM = 1 - Math.exp(-COAST_K);
const coast = (t: number) => {
  "worklet";
  return (1 - Math.exp(-COAST_K * t)) / COAST_NORM;
};

// --- The ambient waves, from one linear clock in seconds (UI-thread worklets) ---

/** One smooth cycle lo → hi → lo per period: (1 − cos 2πx) / 2. */
const wave = (t: number, period: number, lo: number, hi: number) => {
  "worklet";
  const x = t / period;
  return lo + (hi - lo) * (0.5 - 0.5 * Math.cos(TAU * (x - Math.floor(x))));
};
/** `k` whole turns per loop, as a rotation. */
const turns = (t: number, k: number) => {
  "worklet";
  return `${(360 * k * t) / M.loop}deg`;
};

const subscribeAppState = (fn: () => void) => {
  const sub = AppState.addEventListener("change", fn);
  return () => sub.remove();
};
const appActive = () => AppState.currentState !== "background" && AppState.currentState !== "inactive";

/**
 * The orb's moving parts: the glow and body breathe, the core shimmers, the rim's particles twinkle and sway, the inner
 * particles (those that can turn without crossing the lobed outline) drift in two layers turning opposite ways and
 * spiral in on mount. Press and hold spins the inner field up and gathers it in; release coasts it down. The loop stops
 * when the screen loses focus, the app leaves the foreground or after 30 s untouched; `compact` and reduced motion show
 * the settled frame alone.
 */
function OrbLayers({ delta, size, compact }: { delta: number | null; size: number; compact: boolean }) {
  const { c, scheme } = useTheme();
  const reduced = useReducedMotion();
  const settled = compact || reduced;
  const small = size < 160;

  const enter = useSharedValue(settled ? 1 : 0);
  const clock = useSharedValue(0);
  const spin = useSharedValue(0);
  const gather = useSharedValue(0);
  // Where the finger is, from the centre, at half scale (the web's `aim`): the field leans toward it.
  const ax = useSharedValue(0);
  const ay = useSharedValue(0);
  const a = useOrbStyles(enter, clock, spin, gather, ax, ay);

  useEffect(() => {
    if (settled) return;
    enter.set(withTiming(1, { duration: M.enter.duration, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(enter);
  }, [enter, settled]);

  const focused = useIsFocused();
  const active = useSyncExternalStore(subscribeAppState, appActive);
  const live = focused && active && !settled;

  // One linear clock drives every ambient loop. It keeps its reading across pauses, and each run is a whole number of
  // every wave's cycles and every drift's turns, so a restart is seamless. Driven imperatively: a touch never re-renders.
  const ambient = useRef<{ running: boolean; idle: ReturnType<typeof setTimeout> | null }>({ running: false, idle: null });
  const settle = () => {
    const s = ambient.current;
    if (s.idle) clearTimeout(s.idle);
    if (s.running) cancelAnimation(clock);
    s.running = false;
    s.idle = null;
  };
  const wake = () => {
    const s = ambient.current;
    if (s.idle) clearTimeout(s.idle);
    // WCAG 2.2.2: ambient motion settles after a while; a touch or coming back into view wakes it.
    s.idle = setTimeout(settle, ORB.idleSeconds * 1000);
    if (s.running) return;
    s.running = true;
    scheduleOnUI(() => {
      "worklet";
      const from = clock.get();
      clock.set(withRepeat(withTiming(from + M.loop, { duration: M.loop * 1000, easing: Easing.linear }), -1, false));
    });
  };
  useEffect(() => {
    if (!live) return;
    wake();
    return settle;
    // wake and settle only touch the ref and the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  useEffect(
    () => () => {
      cancelAnimation(spin);
      cancelAnimation(gather);
    },
    [spin, gather],
  );

  // --- Press and hold: raw touches, not a responder, so the page still scrolls and a card around the orb still taps. ---
  const press = useRef<{ t0: number } | null>(null);
  /** The orb box's page position, from the press (the children never take touches, so the box is the target). */
  const origin = useRef<{ x: number; y: number } | null>(null);
  const release = () => {
    const p = press.current;
    if (!p) return;
    press.current = null;
    gather.set(withTiming(0, { duration: 700, easing: EASE.standard }));
    // Coast down from the speed it had reached: about a tenth of a turn after a long hold.
    const distance = swirlVelocity(Date.now() - p.t0) / (1 - S.deceleration);
    scheduleOnUI(() => {
      "worklet";
      cancelAnimation(spin);
      spin.set(withTiming(spin.get() + distance, { duration: COAST_MS, easing: coast }));
    });
    if (live) wake();
  };
  const pressStart = () => {
    if (press.current) return;
    press.current = { t0: Date.now() };
    haptic.tap();
    gather.set(withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    // Relative turns from where the field stopped: a ramp up, then a turn per period, each repeat on a whole turn.
    scheduleOnUI(() => {
      "worklet";
      cancelAnimation(spin);
      const from = spin.get();
      spin.set(
        withSequence(
          withTiming(from + S.rampTurns, { duration: S.ramp, easing: Easing.in(Easing.quad) }),
          withRepeat(withTiming(from + S.rampTurns + 1, { duration: S.period, easing: Easing.linear }), -1, false),
        ),
      );
    });
    if (live) wake();
  };
  // The web's pointer handlers: a press gathers and swirls the field and leans it toward the finger, which it follows
  // sideways. A vertical drag is the page's scroll (`touch-pan-y`): the scroll view takes the touch and cancels it here.
  const onTouchStart = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length > 1) return;
    const { locationX, locationY, pageX, pageY } = e.nativeEvent;
    origin.current = { x: pageX - locationX, y: pageY - locationY };
    ax.set((locationX - size / 2) * 0.5);
    ay.set((locationY - size / 2) * 0.5);
    pressStart();
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    const o = origin.current;
    if (!press.current || !o) return;
    ax.set((e.nativeEvent.pageX - o.x - size / 2) * 0.5);
    ay.set((e.nativeEvent.pageY - o.y - size / 2) * 0.5);
  };


  // The web's per-theme --orb-lift and --orb-sparkle (global.css).
  const art = useMemo(
    () => {
      const rgb = (token: Token): RGB => {
        const [r, g, b] = parseColor(c[token as TokenName]);
        return [r, g, b];
      };
      return drawOrb(size, delta, small, rgb, VALUES[scheme]["orb-lift"], VALUES[scheme]["orb-sparkle"]);
    },
    // c is the palette of `scheme`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size, delta, small, scheme],
  );
  const place = (half: number): ViewStyle => ({ position: "absolute", left: size / 2 - half, top: size / 2 - half, width: 2 * half, height: 2 * half });

  return (
    <View
      style={StyleSheet.absoluteFill}
      onTouchStart={settled ? undefined : onTouchStart}
      onTouchMove={settled ? undefined : onTouchMove}
      onTouchEnd={settled ? undefined : release}
      onTouchCancel={settled ? undefined : release}
    >
      <Animated.View pointerEvents="none" style={[place(art.glow.half), a.glow]}>
        {art.glow.node}
      </Animated.View>
      {/* Everything inside the outline breathes with it. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, a.breath]}>
        <Animated.View style={[place(art.body.half), a.body]}>{art.body.node}</Animated.View>
        <Animated.View style={[place(art.shimmer.half), a.shimmer]}>{art.shimmer.node}</Animated.View>
        {art.twinkle && <Animated.View style={[place(art.twinkle.half), a.twinkle]}>{art.twinkle.node}</Animated.View>}
        {art.inner && (
          <Animated.View style={[place(art.inner.half), a.inner]}>
            <Animated.View style={[StyleSheet.absoluteFill, a.driftA]}>{art.inner.a}</Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, a.driftB]}>{art.inner.b}</Animated.View>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

/** Every layer's style from the four drivers: worklets evaluated on the UI thread, one per animated view. */
function useOrbStyles(enter: SharedValue<number>, clock: SharedValue<number>, spin: SharedValue<number>, gather: SharedValue<number>, ax: SharedValue<number>, ay: SharedValue<number>) {
  const glow = useAnimatedStyle(() => ({
    opacity: (M.enter.body + (1 - M.enter.body) * enter.value) * wave(clock.value, M.breath, M.glowDim, 1),
    transform: [{ scale: wave(clock.value, M.breath, 1, 1 + M.glowScale) + gather.value * S.glowGrow }],
  }));
  // While pressed the outline leans out toward the finger (the web's bulge, ORB.touch.bulge of the radius).
  const breath = useAnimatedStyle(() => ({
    transform: [
      { translateX: ax.value * gather.value * BULGE },
      { translateY: ay.value * gather.value * BULGE },
      { scale: wave(clock.value, M.breath, 1, 1 + M.breathScale) + gather.value * S.bodyGrow },
    ],
  }));
  const body = useAnimatedStyle(() => ({ opacity: M.enter.body + (1 - M.enter.body) * enter.value }));
  const shimmer = useAnimatedStyle(() => ({ opacity: enter.value * wave(clock.value, M.shimmer, 0.3, 1), transform: [{ rotate: turns(clock.value, M.turnsShimmer) }] }));
  // Starts full and dims mid-cycle, so the settled frame shows the rim at full strength.
  const twinkle = useAnimatedStyle(() => ({
    opacity: enter.value * wave(clock.value, M.twinkle, 1, 0.35),
    transform: [{ rotate: `${wave(clock.value, M.sway, -M.swayDeg, M.swayDeg)}deg` }, { scale: 1 + (S.rimGather - 1) * gather.value }],
  }));
  const inner = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      // The inner field leans toward the finger (the web's per-particle `lean`, about half the aim on average).
      { translateX: ax.value * gather.value * LEAN },
      { translateY: ay.value * gather.value * LEAN },
      { rotate: `${360 * spin.value}deg` },
      { rotate: `${M.enter.turnDeg * (1 - enter.value)}deg` },
      { scale: (M.enter.scale + (1 - M.enter.scale) * enter.value) * (1 + (S.gather - 1) * gather.value) },
    ],
  }));
  const driftA = useAnimatedStyle(() => ({ transform: [{ rotate: turns(clock.value, M.turnsA) }] }));
  const driftB = useAnimatedStyle(() => ({ opacity: wave(clock.value, M.twinkleInner, 1, 0.45), transform: [{ rotate: turns(clock.value, M.turnsB) }] }));
  return { glow, breath, body, shimmer, twinkle, inner, driftA, driftB };
}

type Layer = { half: number; node: ReactNode };

/**
 * A square SVG `2 × half` wide with its origin at the centre, so every layer shares the orb's coordinates. A soft layer
 * (glow, shimmer) is drawn at `res` of its size and scaled up: a quarter of the bitmap at 0.5, no visible difference in
 * a gradient.
 */
function square(half: number, children: ReactNode, res = 1) {
  const svg = (
    <Svg width={2 * half * res} height={2 * half * res} viewBox={`${-half} ${-half} ${2 * half} ${2 * half}`}>
      {children}
    </Svg>
  );
  if (res === 1) return svg;
  return (
    <View style={{ width: 2 * half, height: 2 * half, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 2 * half * res, height: 2 * half * res, transform: [{ scale: 1 / res }] }}>{svg}</View>
    </View>
  );
}

/**
 * The orb's layers at the settled frame, centred on (0, 0): glow, body (fill, core, rim light, edge and the rim
 * particles that stay put), core shimmer, the rim particles that twinkle and sway, and the inner particles that drift
 * (two layers, one per direction). The particles are the web's random sequence draw for draw, so the same orb places
 * the same particles; each joins the motion layer its position allows (`particleLayer`).
 */
function drawOrb(size: number, delta: number | null, small: boolean, rgb: (t: Token) => RGB, lift: number, sparkle: number) {
  const { top, bottom } = orbColors(delta, rgb);
  const CORE = rgb("orb-core");
  const HIGHLIGHT = rgb("orb-highlight");
  // Below 1 a tone fades toward the core (black on dark, so the same as darkening); above 1 it brightens.
  const tone = (col: RGB, k: number) => (k <= 1 ? mixRGB(CORE, col, k) : shadeRGB(col, k));
  const bright = (col: RGB) => mixRGB(shadeRGB(col, lift), HIGHLIGHT, sparkle);
  const dim = delta === null ? 0.55 : 1;
  const R = (size / 2) * ORB.shape.radius;
  const seed = 3 + (Math.abs(Math.round((delta ?? 0) * 10)) % 89);
  const t = SETTLED_T;

  const rTab = Array.from({ length: STEPS + 1 }, (_, i) => R * blobRadius((i / STEPS) * TAU, t, seed, small, 1));
  let blob = "";
  for (let i = 0; i < STEPS; i++) {
    const ang = (i / STEPS) * TAU;
    blob += `${i ? "L" : "M"}${(rTab[i] * Math.cos(ang)).toFixed(2)} ${(rTab[i] * Math.sin(ang)).toFixed(2)}`;
  }
  blob += "Z";
  const maxEdge = Math.max(...rTab);
  const minEdge = Math.min(...rTab);
  const swaySpan = (M.swayDeg * Math.PI) / 180;

  const total = Math.round(particleCount(size) * (delta === null ? 0.5 : 1));
  const rand = rng(seed * 7919);
  const k = Math.min(1.2, Math.max(0.75, size / 300));
  const tint = Array.from({ length: BANDS }, (_, b) => rgba(bright(mixRGB(top, bottom, b / (BANDS - 1)))));
  const [dust, dots] = ORB.particles.mix;
  const fixed: ReactNode[] = [];
  const twinkle: ReactNode[] = [];
  const innerA: ReactNode[] = [];
  const innerB: ReactNode[] = [];
  let twinkleHalf = 0;
  let innerHalf = 0;
  let dustSeen = 0;
  let kept = 0;
  for (let i = 0; i < total && kept < MAX_PARTICLES; i++) {
    const kind = rand();
    const u = rand();
    const bokeh = kind >= dust + dots;
    const isDust = kind < dust;
    const th0 = rand() * TAU;
    const rho0 = bokeh ? 0.92 - 0.45 * u ** 1.4 : 0.965 - 0.62 * u ** 1.7;
    if (rand() >= 0.3) rand(); // rhoIn: where a particle gathers while pressed (web only)
    const w = (0.012 + 0.03 * rand()) * (rand() < 0.75 ? 1 : -1);
    const ph = rand() * TAU;
    const twRate = 0.6 + 1.8 * rand();
    let rad: number, alphaP: number, depth: number;
    if (isDust) [rad, alphaP, depth] = [(0.35 + 0.4 * rand()) * k, 0.12 + 0.28 * rand(), 0.6];
    else if (!bokeh) [rad, alphaP, depth] = [(0.9 + 1 * rand()) * k, 0.55 + 0.45 * rand(), 0.35];
    else [rad, alphaP, depth] = [(2.2 + 2.6 * rand()) * k, 0.2 + 0.25 * rand(), 0.25];
    rand(); // scattered start angle
    rand(); // scattered start distance
    rand(); // entry delay
    rand(); // swirl
    if (isDust && dustSeen++ % DUST_EVERY !== 0) continue;
    kept++;
    const th = th0 + w * t;
    const rho = rho0 + 0.012 * Math.sin(ph + t * 0.7);
    const edge = rTab[Math.round(((((th % TAU) + TAU) % TAU) / TAU) * STEPS)];
    const x = edge * rho * Math.cos(th);
    const y = edge * rho * Math.sin(th);
    const s = rad * (bokeh ? 2 : 2.6);
    // A solid dot the size of the web sprite's bright centre.
    const pr = bokeh ? s * 0.38 : isDust ? Math.max(0.5, s * 0.3) : Math.max(0.6, s * 0.25);
    const band = Math.min(BANDS - 1, Math.max(0, Math.floor(((y + R) / (2 * R)) * BANDS)));
    const layer = particleLayer(rTab, STEPS, minEdge, th, edge * rho, pr, swaySpan);
    // The rim particles that sway and the counter-turning inner ones are drawn at full strength: their layer's
    // opacity does the twinkling. The rest keep the settled frame's twinkle.
    const twinkles = layer === "sway" || (layer === "free" && w < 0);
    const tw = twinkles ? 1 : 1 - depth + depth * (0.5 + 0.5 * Math.sin(ph * 3.1 + t * twRate));
    const op = Math.min(1, alphaP * tw * (0.4 + 0.6 * rho0 * rho0) * dim * (isDust ? 1.6 : 1));
    const dot = <Circle key={i} cx={x} cy={y} r={pr} fill={tint[band]} opacity={bokeh ? op * 0.45 : op} />;
    const reach = Math.hypot(x, y) + pr + 1;
    if (layer === "free") {
      (w > 0 ? innerA : innerB).push(dot);
      innerHalf = Math.max(innerHalf, reach);
    } else if (layer === "sway") {
      twinkle.push(dot);
      twinkleHalf = Math.max(twinkleHalf, reach);
    } else fixed.push(dot);
  }

  const rims = [0.24, 0.16, 0.1, 0.06, 0.03].map((wr, i) => ({ w: R * wr, k: 1 + i * 0.04, a: (0.07 + i * 0.03) * dim }));
  // The outer glow: the body's colours at 0.8, kept only where the halo ring is (0.8 R to 1.36 R).
  const g0 = 0.8 / 1.36;
  const gSpan = 1 - g0;
  const glowHalf = Math.ceil(R * 1.36) + 1;
  const bodyHalf = Math.ceil(maxEdge + 4);

  const glow = square(
    glowHalf,
    <>
      <Defs>
        <LinearGradient id="fill" x1={0} y1={-R} x2={0} y2={R} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={rgba(tone(top, 0.8))} />
          <Stop offset={1} stopColor={rgba(tone(bottom, 0.8))} />
        </LinearGradient>
        <RadialGradient id="ring" cx={0} cy={0} r={R * 1.36} gradientUnits="userSpaceOnUse">
          {[[0, 0.36], [g0, 0.36], [g0 + 0.35 * gSpan, 0.22], [g0 + 0.6 * gSpan, 0.07], [1, 0]].map(([at, al]) => (
            <Stop key={at} offset={at} stopColor="#ffffff" stopOpacity={al * dim} />
          ))}
        </RadialGradient>
        <Mask id="halo">
          <Circle cx={0} cy={0} r={R * 1.36} fill="url(#ring)" />
        </Mask>
      </Defs>
      <Rect x={-glowHalf} y={-glowHalf} width={2 * glowHalf} height={2 * glowHalf} fill="url(#fill)" mask="url(#halo)" />
    </>,
    0.5,
  );

  const body = square(
    bodyHalf,
    <>
      <Defs>
        <LinearGradient id="fill" x1={0} y1={-R} x2={0} y2={R} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={rgba(tone(top, ORB.fillShade))} />
          <Stop offset={1} stopColor={rgba(tone(bottom, ORB.fillShade))} />
        </LinearGradient>
        <RadialGradient id="core" cx={0} cy={0} r={R * 1.04} gradientUnits="userSpaceOnUse">
          {[[0, 1], [0.42, 1], [0.6, 0.72], [0.76, 0.38], [0.9, 0.12], [1, 0]].map(([at, al]) => (
            <Stop key={at} offset={at} stopColor={rgba(CORE)} stopOpacity={al} />
          ))}
        </RadialGradient>
        {rims.map((rm, i) => (
          <LinearGradient key={i} id={`rim${i}`} x1={0} y1={-R} x2={0} y2={R} gradientUnits="userSpaceOnUse">
            <Stop offset={0} stopColor={rgba(tone(top, rm.k))} stopOpacity={rm.a} />
            <Stop offset={1} stopColor={rgba(tone(bottom, rm.k))} stopOpacity={rm.a} />
          </LinearGradient>
        ))}
        <LinearGradient id="edge" x1={0} y1={-R} x2={0} y2={R} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={rgba(mixRGB(top, HIGHLIGHT, 0.22))} stopOpacity={0.85 * dim} />
          <Stop offset={1} stopColor={rgba(mixRGB(bottom, HIGHLIGHT, 0.22))} stopOpacity={0.85 * dim} />
        </LinearGradient>
        <ClipPath id="clip">
          <Path d={blob} />
        </ClipPath>
      </Defs>
      <G clipPath="url(#clip)">
        <G opacity={dim}>
          <Rect x={-bodyHalf} y={-bodyHalf} width={2 * bodyHalf} height={2 * bodyHalf} fill="url(#fill)" />
          <Rect x={-bodyHalf} y={-bodyHalf} width={2 * bodyHalf} height={2 * bodyHalf} fill="url(#core)" />
        </G>
        {/* Inner rim light: stacked strokes, widest faintest, so the band brightens toward the edge with no step. */}
        {rims.map((rm, i) => (
          <Path key={i} d={blob} fill="none" stroke={`url(#rim${i})`} strokeWidth={rm.w} />
        ))}
      </G>
      <Path d={blob} fill="none" stroke="url(#edge)" strokeWidth={1.25} />
      <G>{fixed}</G>
    </>,
  );

  // Core shimmer: two faint soft lights well inside the outline's smallest radius, so they can turn freely. At most
  // 10 % strong, so the numerals keep their contrast.
  const lights = [
    { x: 0.22 * R, y: -0.16 * R, r: 0.46 * R, col: bright(mixRGB(top, bottom, 0.35)), a: 0.1 },
    { x: -0.2 * R, y: 0.2 * R, r: 0.4 * R, col: bright(mixRGB(top, bottom, 0.65)), a: 0.07 },
  ];
  const shimmerHalf = Math.ceil(Math.max(...lights.map((l) => Math.hypot(l.x, l.y) + l.r))) + 1;
  const shimmer = square(
    shimmerHalf,
    <>
      <Defs>
        {lights.map((l, i) => (
          <RadialGradient key={i} id={`sh${i}`} cx={l.x} cy={l.y} r={l.r} gradientUnits="userSpaceOnUse">
            <Stop offset={0} stopColor={rgba(l.col)} stopOpacity={l.a * dim} />
            <Stop offset={0.5} stopColor={rgba(l.col)} stopOpacity={l.a * 0.45 * dim} />
            <Stop offset={1} stopColor={rgba(l.col)} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      {lights.map((l, i) => (
        <Circle key={i} cx={l.x} cy={l.y} r={l.r} fill={`url(#sh${i})`} />
      ))}
    </>,
    0.5,
  );

  const innerSize = Math.ceil(innerHalf);
  const twinkleSize = Math.ceil(twinkleHalf);
  return {
    glow: { half: glowHalf, node: glow } as Layer,
    body: { half: bodyHalf, node: body } as Layer,
    shimmer: { half: shimmerHalf, node: shimmer } as Layer,
    twinkle: twinkle.length ? ({ half: twinkleSize, node: square(twinkleSize, twinkle) } as Layer) : null,
    inner: innerA.length + innerB.length ? { half: innerSize, a: square(innerSize, innerA), b: square(innerSize, innerB) } : null,
  };
}

/** The text's entry: opacity and a 4 px rise over 700 ms on the web's ease-out-expo, staggered (the web's `starting:` utilities; its 4 px blur has no React Native counterpart). */
const enter = (delay: number) => new Keyframe({ 0: { opacity: 0, transform: [{ translateY: 4 }] }, 100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE.outExpo } }).delay(delay).duration(700);

/**
 * Pulse Age hero (docs/design/orb.md): a noise-edged blob of glowing particles, coloured by how much older or younger
 * Pulse Age is. The inner particles spiral in on mount and drift at idle, and spin and gather while pressed.
 */
export function AgeOrb({ age, deltaYears, provisional = false, size: sizeProp, reason, compact = false }: AgeOrbProps) {
  // Never wider than the page column: the 300 px orb would cross the 16 px gutters on a 320 px phone.
  const size = Math.min(sizeProp ?? (compact ? 108 : 300), useNarrow().width - 32);
  const { t } = useTranslation("health");
  const { c } = useTheme();
  const reduced = useReducedMotion();

  const has = age !== null && deltaYears !== null;
  const delta = has ? deltaYears : null;
  const small = size < 160;
  const d = delta !== null ? ageDelta(delta) : null;
  const same = d !== null && delta !== null && formatValue("decimal1", Math.abs(delta)) === "0.0";
  const r = reasonCopy(reason);

  const ageText = has ? formatValue("decimal1", age) : "";
  const label = has
    ? same
      ? t(provisional ? "orb.ariaSameProvisional" : "orb.ariaSame", { age: ageText })
      : t(provisional ? "orb.ariaDeltaProvisional" : "orb.ariaDelta", { age: ageText, delta: d!.text })
    : t("orb.ariaUnavailable", { reason: r.long });

  // The web's `motion-safe:` entry: with reduced motion the text just appears.
  const entering = (delay: number) => (compact || reduced ? undefined : enter(delay));
  // The web writes `leading-none` before `text-[calc(..)]`; tailwind-merge drops the leading, so the numeral takes the page's 1.5 line height.
  const numeral = small ? size * 0.25 : 18 + size * 0.07;
  const caption = small ? Math.max(9, size * 0.09) : 7 + size * 0.023;
  const deltaSize = 8 + size * 0.024;
  const deltaColor = delta !== null && delta <= ORB.greenText ? c["optimal-text"] : same ? c["orb-text-muted"] : c[ORB.deltaText as TokenName];

  return (
    <View accessible={!compact} accessibilityRole={compact ? undefined : "image"} accessibilityLabel={compact ? undefined : label} accessibilityElementsHidden={compact} importantForAccessibility={compact ? "no-hide-descendants" : "yes"} style={{ width: size, height: size }}>
      <OrbLayers delta={delta} size={size} compact={compact} />
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="size-full items-center justify-center" style={{ paddingHorizontal: size * 0.14 }}>
        <Animated.View entering={entering(200)}>
          <Text className="text-center font-numeric font-bold tabular-nums" style={{ fontSize: numeral, lineHeight: numeral * 1.5, letterSpacing: -0.01 * numeral, color: has ? c["orb-text"] : c["orb-text-muted"] }}>
            {formatValue("decimal1", has ? age : null)}
          </Text>
        </Animated.View>
        <Animated.View entering={entering(300)} style={{ marginTop: small ? 2 : 6 }}>
          <Text className="text-center font-bold uppercase" style={{ fontSize: caption, lineHeight: small ? caption : caption * 1.25, letterSpacing: 0.1 * caption, color: c["orb-text-muted"] }}>
            {AGE_LABEL}
          </Text>
        </Animated.View>
        {!small && d && (
          <Animated.View entering={entering(400)} style={{ marginTop: 10 }}>
            <Text className="text-center font-semibold tabular-nums" style={{ fontSize: deltaSize, lineHeight: deltaSize * 1.25, color: deltaColor }}>
              {d.text}
            </Text>
          </Animated.View>
        )}
        {!small && !has && (
          <Animated.View entering={entering(400)} style={{ marginTop: 12 }}>
            <ReasonPlaceholder reason={reason} size="sm" className="justify-center" />
          </Animated.View>
        )}
      </View>
    </View>
  );
}
