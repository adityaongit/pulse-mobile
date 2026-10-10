// Pulse Age hero (pulse docs/design/orb.md), ported from pulse src/components/metrics/AgeOrb.tsx. The web draws it on a 2D
// canvas from a requestAnimationFrame loop; here the loop is a Reanimated frame callback on the UI thread and the marks
// are Skia nodes: the blob, glow, body and rim are declarative nodes fed by shared values, and the particles are one
// <Atlas> whose transforms, sprite rects and colours Skia's buffers rewrite every frame (the same maths as the web's loop,
// per particle). No React state changes per frame. See docs/learning.md ("The Pulse Age orb").
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import {
  Atlas,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Mask,
  Path,
  RadialGradient,
  Rect,
  Skia,
  TileMode,
  useRSXformBuffer,
  vec,
  type SkColor,
  type SkHostRect,
  type SkImage,
  type SkRSXform,
} from "@shopify/react-native-skia";
import { useIsFocused } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, Keyframe, makeMutable, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue, type SharedValue } from "react-native-reanimated";
import { AGE_LABEL, formatValue } from "@/lib/format";
import { reasonCopy, type ReasonCode } from "@/lib/reasons";
import { alpha, parseColor } from "@/ui/color";
import type { TokenName } from "@/ui/palette";
import { MetricTags } from "@/ui/metrics/primitives";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { ageDelta } from "./format";
import { blobRadius, easeOutCubic, mixRGB, ORB, orbColors, particleCount, rgba, rng, shadeRGB, type RGB, type Token } from "./orb";

export type AgeOrbProps = {
  /** Pulse Age, the number in the middle. */
  age: number | null;
  /** Pulse Age minus chronological age; positive is older. */
  deltaYears: number | null;
  provisional?: boolean;
  /** Box size in px (default 300, compact 108). Below 160 it drops the delta line (Health hub, collapsed header). */
  size?: number;
  reason?: ReasonCode | null;
  /** The sticky header's mini orb: same colours, the age and label inside, one settled frame (no loop, no touch). */
  compact?: boolean;
};

/** Canvas overhang on each side, as a share of `size`, so the glow can bleed past the box. */
const PAD = 0.15;
/** Vertical colour bands the particle sprites are pre-tinted in (mixed orbs fade top to bottom). */
const BANDS = 8;
const STEPS = 128;
const TAU = Math.PI * 2;
/** The sprite sheet: a row of crisp 16 px dots (one per band), under it a row of soft 64 px discs. */
const DOT = 16;
const SOFT = 64;
/** A frame far enough into the entry that everything has landed: the settled frame (the web's `draw(10, 0)`). */
const SETTLED = 10;

/** One 128-step outline: radii (px) at t, seed and wobble, bulging toward (ax, ay) while pressed. Runs on either thread. */
function outline(R: number, t: number, seed: number, small: boolean, wob: number, pull: number, toward: number) {
  "worklet";
  const out: number[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * TAU;
    out.push(R * blobRadius(a, t, seed, small, wob) * (1 + pull * Math.max(0, Math.cos(a - toward)) ** 4));
  }
  return out;
}

/** The frame loop's state, all shared values: nothing here re-renders the component. */
type Live = {
  t: SharedValue<number>;
  gather: SharedValue<number>;
  target: SharedValue<number>;
  swirl: SharedValue<number>;
  ax: SharedValue<number>;
  ay: SharedValue<number>;
  /** Last interaction or entry, in orb time. */
  lastActive: SharedValue<number>;
  table: SharedValue<number[]>;
};
/** What a frame needs of the orb's geometry and its particles (the web's closure variables). */
type Geo = { R: number; seed: number; small: boolean; cx: number; cy: number; dim: number; P: Particles };
type Particles = Record<"th" | "rho" | "rhoIn" | "w" | "ph" | "tw" | "depth" | "rad" | "alpha" | "soft" | "sx" | "sy" | "delay" | "swirl", number[]>;
const FLY = ORB.entry.duration - ORB.entry.maxDelay;

// These run on the UI thread, every frame, and write shared values and Skia buffers in place. They are plain functions
// (not inside a component) so the React Compiler leaves them alone.

/** One frame of the web's `draw(t, dt)`: time, the touch ease, the swirl and the outline table. */
function frameStep(live: Live, geo: Geo, timeSincePrevious: number | null | undefined) {
  "worklet";
  const dt = Math.min(0.05, (timeSincePrevious ?? 16) / 1000);
  // WCAG 2.2.2: ambient motion settles after a while; a touch wakes it (and `lastActive` with it).
  if (live.t.value - live.lastActive.value > ORB.idleSeconds && live.gather.value < 0.01 && live.target.value === 0) return;
  live.t.value += dt;
  live.gather.value += (live.target.value - live.gather.value) * (1 - Math.exp(-dt * ORB.touch.ease));
  live.swirl.value += dt * live.gather.value * ORB.touch.swirl;
  // While pressed the outline also leans out toward the finger (touch frames).
  const pull = Math.hypot(live.ax.value, live.ay.value) > 4 ? live.gather.value * ORB.touch.bulge : 0;
  live.table.value = outline(geo.R, live.t.value, geo.seed, geo.small, 1 + live.gather.value * ORB.touch.wobble, pull, Math.atan2(live.ay.value, live.ax.value));
}

/** Particle `i` this frame: where it is (transform), which sprite (rect) and how bright (colour). */
function placeParticle(i: number, xf: SkRSXform, rect: SkHostRect, color: SkColor, live: Live, geo: Geo) {
  "worklet";
  const { P, cx, cy, R, dim } = geo;
  const T = live.t.value;
  const G = live.gather.value;
  const e = easeOutCubic((T - P.delay[i]) / FLY);
  if (e <= 0) {
    xf.set(0, 0, -100, -100);
    color[3] = 0;
    return;
  }
  const tbl = live.table.value;
  const th = P.th[i] + P.w[i] * T + live.swirl.value * P.swirl[i] - (1 - e) * 0.9;
  const rho = P.rho[i] + 0.012 * Math.sin(P.ph[i] + T * 0.7);
  const depth = rho + (P.rhoIn[i] - rho) * G;
  const ang = ((th % TAU) + TAU) % TAU;
  const edge = tbl[Math.round((ang / TAU) * STEPS)];
  const lean = G * (1 - depth); // Inner particles lean toward the finger; rim ones stay inside the edge.
  const hx = cx + edge * depth * Math.cos(th) + live.ax.value * lean;
  const hy = cy + edge * depth * Math.sin(th) + live.ay.value * lean;
  const x = P.sx[i] + (hx - P.sx[i]) * e;
  const y = P.sy[i] + (hy - P.sy[i]) * e;
  const tw = 1 - P.depth[i] + P.depth[i] * (0.5 + 0.5 * Math.sin(P.ph[i] * 3.1 + T * P.tw[i]));
  color[3] = Math.min(1, P.alpha[i] * tw * (0.4 + 0.6 * P.rho[i] * P.rho[i]) * e * (1 + 0.3 * G) * dim);
  const band = Math.min(BANDS - 1, Math.max(0, Math.floor(((y - cy + R) / (2 * R)) * BANDS)));
  const s = P.rad[i] * (P.soft[i] ? 2 : 2.6);
  const px = P.soft[i] ? SOFT : DOT;
  rect.setXYWH(band * px, P.soft[i] ? DOT : 0, px, px);
  xf.set(s / px, 0, x - s / 2, y - s / 2);
}

/** A press (or a drag of it) at (x, y) in the box: particles pull toward the centre, leaning toward the finger. */
function press(live: Live, size: number, x: number, y: number, down: boolean) {
  "worklet";
  live.ax.value = (x - size / 2) * 0.5;
  live.ay.value = (y - size / 2) * 0.5;
  if (down) {
    live.target.value = 1;
    live.lastActive.value = live.t.value;
  }
}

function release(live: Live) {
  "worklet";
  live.target.value = 0;
  live.lastActive.value = live.t.value;
}

/** The sheet the particles are cut from: radial sprites, pre-tinted per band (the web's `sprite()`). */
function makeSheet(tints: RGB[]): SkImage {
  const surface = Skia.Surface.MakeOffscreen(BANDS * SOFT, DOT + SOFT)!;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  tints.forEach((tint, band) => {
    for (const soft of [false, true]) {
      const px = soft ? SOFT : DOT;
      const ox = band * px;
      const oy = soft ? DOT : 0;
      const stops: [number, number][] = soft
        ? [[0, 0.5], [0.55, 0.42], [0.82, 0.2], [1, 0]]
        : [[0, 1], [0.4, 1], [0.62, 0.3], [1, 0]];
      paint.setShader(
        Skia.Shader.MakeRadialGradient(Skia.Point(ox + px / 2, oy + px / 2), px / 2, stops.map(([, a]) => Skia.Color(rgba(tint, a))), stops.map(([at]) => at), TileMode.Clamp),
      );
      canvas.drawRect(Skia.XYWHRect(ox, oy, px, px), paint);
    }
  });
  surface.flush();
  const image = surface.makeImageSnapshot();
  return image.makeNonTextureImage() ?? image;
}

/** Everything the orb draws behind its numerals. `compact` and reduced motion draw one settled frame and never loop. */
function OrbCanvas({ delta, size, compact }: { delta: number | null; size: number; compact: boolean }) {
  const { c, scheme } = useTheme();
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const settled = reduced || compact;
  const small = size < 160;
  const th = ORB.theme[scheme];

  const g = useMemo(() => {
    const rgb = (token: Token): RGB => {
      const [r, gg, b] = parseColor(c[token as TokenName]);
      return [r, gg, b];
    };
    const { top, bottom } = orbColors(delta, rgb);
    const HIGHLIGHT = rgb("orb-highlight");
    const CORE = rgb("orb-core");
    // Below 1 a tone fades toward the core (black on dark, so the same as darkening); above 1 it brightens.
    const tone = (col: RGB, k: number) => (k <= 1 ? mixRGB(CORE, col, k) : shadeRGB(col, k));
    const bright = (col: RGB) => mixRGB(shadeRGB(col, th.lift), HIGHLIGHT, th.sparkle);
    const dim = delta === null ? 0.55 : 1;
    const W = size * (1 + 2 * PAD);
    const cx = W / 2;
    const cy = W / 2;
    const R = (size / 2) * ORB.shape.radius;
    const seed = 3 + (Math.abs(Math.round((delta ?? 0) * 10)) % 89);

    const body = [tone(top, ORB.fillShade), tone(bottom, ORB.fillShade)].map((x) => rgba(x));
    const glowFill = [tone(top, 0.8), tone(bottom, 0.8)].map((x) => rgba(x));
    const coreStops = [[0, 1], [0.42, 1], [0.6, 0.72], [0.76, 0.38], [0.9, 0.12], [1, 0]] as const;
    // The halo ring runs from 0.8 R to 1.36 R; the gradient here starts at the centre, so its stops are re-based.
    const haloOuter = R * 1.36;
    const haloStops = [[0, 0.36], [0.35, 0.22], [0.6, 0.07], [1, 0]].map(([at, a]) => [(0.8 * R + at * (haloOuter - 0.8 * R)) / haloOuter, a * dim] as const);
    const rim = [0.24, 0.16, 0.1, 0.06, 0.03].map((w, i) => ({ w: R * w, colors: [rgba(tone(top, 1 + i * 0.04), (0.07 + i * 0.03) * dim), rgba(tone(bottom, 1 + i * 0.04), (0.07 + i * 0.03) * dim)] }));
    const edge = [rgba(mixRGB(top, HIGHLIGHT, 0.22), 0.85 * dim), rgba(mixRGB(bottom, HIGHLIGHT, 0.22), 0.85 * dim)];

    const tint = Array.from({ length: BANDS }, (_, b) => bright(mixRGB(top, bottom, b / (BANDS - 1))));
    const sheet = makeSheet(tint);

    // Particles: home angle and depth (denser toward the rim), a scattered start, drift and twinkle.
    const n = Math.round(particleCount(size) * (delta === null ? 0.5 : 1));
    const rand = rng(seed * 7919);
    const k = Math.min(1.2, Math.max(0.75, size / 300));
    const P: Particles = { th: [], rho: [], rhoIn: [], w: [], ph: [], tw: [], depth: [], rad: [], alpha: [], soft: [], sx: [], sy: [], delay: [], swirl: [] };
    const [dust, dots] = ORB.particles.mix;
    for (let i = 0; i < n; i++) {
      const kind = rand();
      const u = rand();
      const bokeh = kind >= dust + dots;
      const rho = bokeh ? 0.92 - 0.45 * u ** 1.4 : 0.965 - 0.62 * u ** 1.7;
      P.th.push(rand() * TAU);
      P.rho.push(rho);
      P.rhoIn.push(rand() < 0.3 ? rho : 0.18 + 0.55 * rand()); // A third stay on the rim, as in the touch frames.
      P.w.push((0.012 + 0.03 * rand()) * (rand() < 0.75 ? 1 : -1));
      P.ph.push(rand() * TAU);
      P.tw.push(0.6 + 1.8 * rand());
      P.soft.push(bokeh ? 1 : 0);
      if (kind < dust) {
        P.rad.push((0.35 + 0.4 * rand()) * k);
        P.alpha.push(0.12 + 0.28 * rand());
        P.depth.push(0.6);
      } else if (!bokeh) {
        P.rad.push((0.9 + 1 * rand()) * k);
        P.alpha.push(0.55 + 0.45 * rand());
        P.depth.push(0.35);
      } else {
        P.rad.push((2.2 + 2.6 * rand()) * k);
        P.alpha.push(0.2 + 0.25 * rand());
        P.depth.push(0.25);
      }
      const a = rand() * TAU;
      const dist = R * 1.4 * Math.sqrt(rand());
      P.sx.push(cx + dist * Math.cos(a));
      P.sy.push(cy + dist * Math.sin(a));
      P.delay.push(rand() * ORB.entry.maxDelay);
      P.swirl.push(0.6 + 0.8 * rand());
    }
    return { W, cx, cy, R, seed, dim, body, glowFill, coreStops, haloOuter, haloStops, rim, edge, sheet, n, P };
    // c is the palette of `scheme`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delta, size, scheme]);
  const { W, cx, cy, R, seed, dim, n, P } = g;

  const t = useSharedValue(settled ? SETTLED : 0);
  const gather = useSharedValue(0);
  const target = useSharedValue(0);
  const swirl = useSharedValue(0);
  const ax = useSharedValue(0);
  const ay = useSharedValue(0);
  const lastActive = useSharedValue(0);
  const table = useSharedValue<number[]>(outline(R, SETTLED, seed, small, 1, 0, 0));
  const live: Live = { t, gather, target, swirl, ax, ay, lastActive, table };
  const geo: Geo = { R, seed, small, cx, cy, dim, P };

  const frame = useFrameCallback((info) => {
    "worklet";
    frameStep(live, geo, info.timeSincePreviousFrame);
  }, false);
  useEffect(() => {
    frame.setActive(focused && !settled);
    // `frame` is stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, settled]);

  // A new orb (another delta or size) starts its entry again.
  useEffect(() => {
    const start = settled ? SETTLED : 0;
    t.set(start);
    lastActive.set(0);
    table.set(outline(R, start, seed, small, 1, 0, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, settled]);

  const path = useDerivedValue(() => {
    // Skia's PathBuilder (SkPath's moveTo/lineTo/close are deprecated); detach() hands over the finished path.
    const p = Skia.PathBuilder.Make();
    const tbl = table.value;
    for (let i = 0; i < STEPS; i++) {
      const a = (i / STEPS) * TAU;
      const x = cx + tbl[i] * Math.cos(a);
      const y = cy + tbl[i] * Math.sin(a);
      if (i) p.lineTo(x, y);
      else p.moveTo(x, y);
    }
    p.close();
    return p.detach();
  });
  // The rim and halo charge up as particles land: from 45 % to full (the body is there from frame 0).
  const eb = useDerivedValue(() => 0.45 + 0.55 * easeOutCubic(t.value / ORB.entry.duration));
  const glowOpacity = useDerivedValue(() => Math.min(1, eb.value * (1 + 0.25 * gather.value)));

  // Per particle, every frame: where it is (transform), which sprite (rect) and how bright (colour). The buffers are
  // Skia's: host objects rewritten in place on the UI thread, no allocation per frame.
  const rects = useMemo(() => makeMutable(Array.from({ length: n }, () => Skia.XYWHRect(0, 0, 0, 0))), [n]);
  const colors = useMemo(() => makeMutable(Array.from({ length: n }, () => Skia.Color("white"))), [n]);
  const transforms = useRSXformBuffer(n, (xf, i) => {
    "worklet";
    placeParticle(i, xf, rects.value[i], colors.value[i], live, geo);
  });

  // A manual gesture never activates, so a vertical drag still scrolls the page (the web's `touch-action: pan-y`); the
  // scroll cancels the press.
  const gesture = Gesture.Manual()
    .onTouchesDown((e) => {
      "worklet";
      const p = e.allTouches[0];
      if (p) press(live, size, p.x, p.y, true);
    })
    .onTouchesMove((e) => {
      "worklet";
      const p = e.allTouches[0];
      if (p && live.target.value) press(live, size, p.x, p.y, false);
    })
    .onTouchesUp(() => {
      "worklet";
      release(live);
    })
    .onTouchesCancelled(() => {
      "worklet";
      release(live);
    });

  const canvas = (
    <Canvas style={{ width: W, height: W }}>
      {/* The outer glow: the body's colours at 0.8, kept only where the halo ring is. */}
      <Group opacity={glowOpacity}>
        <Mask
          mode="alpha"
          mask={
            <Circle cx={cx} cy={cy} r={g.haloOuter}>
              <RadialGradient c={vec(cx, cy)} r={g.haloOuter} colors={g.haloStops.map(([, a]) => alpha(c["orb-core"], a))} positions={g.haloStops.map(([at]) => at)} />
            </Circle>
          }
        >
          <Rect x={0} y={0} width={W} height={W}>
            <LinearGradient start={vec(0, cy - R)} end={vec(0, cy + R)} colors={g.glowFill} />
          </Rect>
        </Mask>
      </Group>
      <Group clip={path}>
        {/* The body: the rim colour fading to the core. */}
        <Group opacity={dim}>
          <Rect x={0} y={0} width={W} height={W}>
            <LinearGradient start={vec(0, cy - R)} end={vec(0, cy + R)} colors={g.body} />
          </Rect>
          <Rect x={0} y={0} width={W} height={W}>
            <RadialGradient c={vec(cx, cy)} r={R * 1.04} colors={g.coreStops.map(([, a]) => alpha(c["orb-core"], a))} positions={g.coreStops.map(([at]) => at)} />
          </Rect>
        </Group>
        {/* Inner rim light: stacked strokes, widest faintest, so the band brightens toward the edge with no step. */}
        <Group opacity={eb}>
          {g.rim.map((r) => (
            <Path key={r.w} path={path} style="stroke" strokeWidth={r.w}>
              <LinearGradient start={vec(0, cy - R)} end={vec(0, cy + R)} colors={r.colors} />
            </Path>
          ))}
        </Group>
      </Group>
      <Group opacity={eb}>
        <Path path={path} style="stroke" strokeWidth={1.25}>
          <LinearGradient start={vec(0, cy - R)} end={vec(0, cy + R)} colors={g.edge} />
        </Path>
      </Group>
      {/* Dark: particles add light ("lighter"); light: they paint over. */}
      <Group blendMode={th.additive ? "plus" : "srcOver"}>
        <Atlas image={g.sheet} sprites={rects} transforms={transforms} colors={colors} colorBlendMode="modulate" />
      </Group>
    </Canvas>
  );

  return (
    <>
      <View pointerEvents="none" style={{ position: "absolute", left: -PAD * size, top: -PAD * size, width: W, height: W }}>
        {canvas}
      </View>
      {/* The press target is the box, as on the web; the canvas overhang is only light. */}
      {!settled && (
        <GestureDetector gesture={gesture}>
          <View collapsable={false} style={{ position: "absolute", left: 0, top: 0, width: size, height: size }} />
        </GestureDetector>
      )}
    </>
  );
}

/** The text's entry: opacity and a 4 px rise over 700 ms on the web's ease-out-expo, staggered (the web's `starting:` utilities; its 4 px blur has no React Native counterpart). */
const enter = (delay: number) => new Keyframe({ 0: { opacity: 0, transform: [{ translateY: 4 }] }, 100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.bezier(0.16, 1, 0.3, 1) } }).delay(delay).duration(700);

/**
 * Pulse Age hero (docs/design/orb.md): a noise-edged blob of glowing particles, coloured by how much older or younger
 * Pulse Age is. Particles gather in on mount, drift at idle, and pull inward and swirl while pressed.
 */
export function AgeOrb({ age, deltaYears, provisional = false, size: sizeProp, reason, compact = false }: AgeOrbProps) {
  const size = sizeProp ?? (compact ? 108 : 300);
  const { c } = useTheme();
  const reduced = useReducedMotion();

  const has = age !== null && deltaYears !== null;
  const delta = has ? deltaYears : null;
  const small = size < 160;
  const d = delta !== null ? ageDelta(delta) : null;
  const same = d !== null && delta !== null && formatValue("decimal1", Math.abs(delta)) === "0.0";
  const r = reasonCopy(reason);

  const label = has
    ? `${AGE_LABEL} ${formatValue("decimal1", age)}, ${same ? "same as your age" : `${d!.text} than your age`}${provisional ? ", provisional" : ""}`
    : `${AGE_LABEL} unavailable. ${r.long}`;

  // The web's `motion-safe:` entry: with reduced motion the text just appears.
  const entering = (delay: number) => (compact || reduced ? undefined : enter(delay));
  const numeral = small ? size * 0.25 : 18 + size * 0.07;
  const caption = small ? Math.max(9, size * 0.09) : 7 + size * 0.023;
  const deltaSize = 8 + size * 0.024;
  const deltaColor = delta !== null && delta <= ORB.greenText ? c["optimal-text"] : same ? c["orb-text-muted"] : c[ORB.deltaText as TokenName];

  return (
    <View accessible={!compact} accessibilityRole={compact ? undefined : "image"} accessibilityLabel={compact ? undefined : label} accessibilityElementsHidden={compact} importantForAccessibility={compact ? "no-hide-descendants" : "yes"} style={{ width: size, height: size }}>
      <OrbCanvas delta={delta} size={size} compact={compact} />
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="size-full items-center justify-center" style={{ paddingHorizontal: size * 0.14 }}>
        <Animated.View entering={entering(200)}>
          <Text className="text-center font-numeric font-bold tabular-nums" style={{ fontSize: numeral, lineHeight: numeral, letterSpacing: -0.01 * numeral, color: has ? c["orb-text"] : c["orb-text-muted"] }}>
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
        {!small && has && provisional && (
          <Animated.View entering={entering(500)} style={{ marginTop: 12 }}>
            <MetricTags provisional />
          </Animated.View>
        )}
      </View>
    </View>
  );
}
