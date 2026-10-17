import { haptic } from "../haptics";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Canvas, Circle, DashPathEffect } from "@shopify/react-native-skia";
import { Path } from "@/ui/charts/path";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { cn } from "../cn";
import { alpha } from "../color";
import { Panel } from "../Panel";
import { Text } from "../Text";
import { useTheme } from "../theme";

// What every chart shares (web: components/charts/ChartFrame.tsx). The web draws with Recharts (SVG in the DOM). Here the
// marks are Skia nodes in one <Canvas>, and every piece of text (axis ticks, value labels, pills, the tooltip) is a
// React Native <Text> laid over it at a computed position: text then uses the app's fonts, theme and accessibility
// without a second font pipeline inside Skia.

export type Size = { width: number; height: number };

/**
 * A chart's box: a fixed `height`, the width of its parent, an accessible name (the web's sr-only figcaption).
 * `children` is called with the measured size, once it is known.
 */
export function ChartFigure({ summary, height, className, onWidth, children }: { summary: string; height: number; className?: string; /** Told the measured width, for a chart that needs its geometry outside the render function (a header that follows the scrubbed point). */ onWidth?: (width: number) => void; children: (size: Size) => ReactNode }) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = Math.round(e.nativeEvent.layout.width);
      setWidth(w);
      onWidth?.(w);
    },
    [onWidth],
  );
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} onLayout={onLayout} className={cn("w-full", className)} style={{ height }}>
      {width > 0 && children({ width, height })}
    </View>
  );
}

/** The Skia canvas under a chart's text. */
export function PlotCanvas({ width, height, children }: Size & { children: ReactNode }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
      <Canvas style={{ width, height }}>{children}</Canvas>
    </View>
  );
}

/** Dashed, faint horizontal lines (WHOOP and Bevel both dash theirs): the web's GRID, 3 on / 4 off. */
export function GridLines({ ys, x0, x1 }: { ys: number[]; x0: number; x1: number }) {
  const { c } = useTheme();
  if (!ys.length) return null;
  return (
    <Path path={ys.map((y) => `M${x0},${y}L${x1},${y}`).join("")} style="stroke" strokeWidth={1} color={c["chart-grid"]}>
      <DashPathEffect intervals={[3, 4]} />
    </Path>
  );
}

/** A dashed straight line, for reference lines, cursors and the "now" marker. */
export function DashedLine({ x1, y1, x2, y2, color, dash = [3, 3], width = 1 }: { x1: number; y1: number; x2: number; y2: number; color: string; dash?: [number, number]; width?: number }) {
  return (
    <Path path={`M${x1},${y1}L${x2},${y2}`} style="stroke" strokeWidth={width} color={color}>
      <DashPathEffect intervals={dash} />
    </Path>
  );
}

/** Active dot: the series colour with a soft halo, as both reference apps mark the scrubbed point. */
export function GlowDot({ x, y, fill }: { x: number; y: number; fill: string }) {
  const { c } = useTheme();
  return (
    <>
      <Circle cx={x} cy={y} r={9} color={alpha(fill, 0.22)} />
      <Circle cx={x} cy={y} r={6.5} color={c.card} />
      <Circle cx={x} cy={y} r={4.5} color={fill} />
    </>
  );
}

/** A dot with a card-coloured ring (the web's `fill` + `stroke="var(--card)" strokeWidth={2}`). */
export function RingDot({ x, y, r, fill, ring }: { x: number; y: number; r: number; fill: string; ring?: string }) {
  const { c } = useTheme();
  return (
    <>
      <Circle cx={x} cy={y} r={r + 1} color={ring ?? c.card} />
      <Circle cx={x} cy={y} r={r} color={fill} />
    </>
  );
}

/** A hollow dot: card-coloured centre, coloured stroke (Strain and Recovery's points). */
export function HollowDot({ x, y, r, stroke, strokeWidth = 2, opacity = 1 }: { x: number; y: number; r: number; stroke: string; strokeWidth?: number; opacity?: number }) {
  const { c } = useTheme();
  return (
    <>
      <Circle cx={x} cy={y} r={r + strokeWidth / 2} color={stroke} opacity={opacity} />
      <Circle cx={x} cy={y} r={r - strokeWidth / 2} color={c.card} />
    </>
  );
}

// --- Text laid over the canvas ---

const LH = 16;
const TEXT_W = 72;

/**
 * Chart text at a point. `anchor` is the SVG text-anchor (start: the text begins at x; end: it ends at x; middle:
 * centred on x); `y` is the text's vertical centre unless `baseline` says the top. Classes style the label (default: an
 * axis tick, 12 px Barlow medium, muted). `color` is spread in only when given: NativeWind merges the inline style over
 * the class styles with Object.assign, so `color: undefined` would erase the class colour and leave React Native's black.
 */
export function ChartLabel({ x, y, children, anchor = "middle", className, w = TEXT_W, color, top, halo, lines = 1 }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end"; className?: string; w?: number; color?: string; top?: boolean; lines?: number; /** A card-coloured outline under the text, so a line crossing it never strikes through the digits (the web's LABEL_HALO). */ halo?: string }) {
  const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  return (
    <Text
      pointerEvents="none"
      numberOfLines={lines}
      className={cn("font-numeric text-xs font-medium leading-4 tabular-nums text-muted-foreground", className)}
      style={{ position: "absolute", left, top: top ? y : y - LH / 2, width: w, textAlign: anchor === "middle" ? "center" : anchor === "end" ? "right" : "left", ...(color ? { color } : null), ...(halo ? { textShadowColor: halo, textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } } : null) }}
    >
      {children}
    </Text>
  );
}

/** Recharts' tick size: 6 px between the plot and the tick margin, whether or not the tick line is drawn. */
const TICK_SIZE = 6;
/** The right edge of a Y tick's text: tick size plus the axis's tickMargin (the web's AXIS: 8) left of the plot. */
export const yTickX = (x0: number, margin = 8) => x0 - TICK_SIZE - margin;
/**
 * The centre of an X tick's label (a 16 px line): Recharts sets the text's baseline 0.71 em below tick size plus
 * tickMargin; in a 16 px line a 12 px Barlow baseline sits 4.8 px below the centre.
 */
export const xTickY = (y1: number, margin = 8) => y1 + TICK_SIZE + margin + 0.71 * 12 - 4.8;

/** A filled pill at (x, y), vertically centred: the label of a reference line or a marked point. */
export function Pill({ x, y, text, fill, color, anchor = "start" }: { x: number; y: number; text: string; fill?: string; color?: string; anchor?: "start" | "middle" }) {
  const { c } = useTheme();
  const w = Math.ceil(text.length * 6.6) + 10;
  const left = anchor === "middle" ? x - w / 2 : x;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left, top: y - 9, width: w, height: 18, borderRadius: 9, backgroundColor: fill ?? c.secondary, alignItems: "center", justifyContent: "center" }}>
      <Text numberOfLines={1} className="text-[11px] font-bold leading-[14px]" style={{ color: color ?? c["foreground-secondary"] }}>
        {text}
      </Text>
    </View>
  );
}

/** Characters to px at 11 px bold, for pills and gutters. */
const textWidth = (t: string) => Math.ceil(t.length * 6.6);

/**
 * Right margin that holds reference-line pills ("Avg", "7,000", "Your age") outside the plot, so bars and lines never
 * run under them. Pair with `Pill` at x = plot right + 4.
 */
export const labelGutter = (labels: (string | false | null | undefined)[], base = 4) => {
  const widest = Math.max(0, ...labels.map((l) => (l ? textWidth(l) : 0)));
  return widest ? Math.max(base, widest + 16) : base;
};

/** Tick text for a numeric axis: whole numbers drop their ".0" (48, not 48.0); others keep the metric's format. */
export const wholeTick = (fmt: (v: number) => string) => (v: number) => (Number.isInteger(v) ? Math.round(v).toLocaleString("en-US") : fmt(v));

// --- Scrubbing: the web's hover tooltip, as a touch ---

/**
 * Touch scrubbing over a plot. Drag horizontally to move a cursor along the data (a vertical drag still scrolls the
 * page); lifting the finger clears it, as a hover ends. A tap places it, a tap on it again clears it. `onScrub` gets the
 * x in plot pixels, or null when cleared.
 */
export function ScrubLayer({ width, height, onScrub, children }: Size & { onScrub: (x: number | null) => void; children?: ReactNode }) {
  const [pinned, setPinned] = useState<number | null>(null);
  useEffect(() => onScrub(pinned), [pinned, onScrub]);
  const gesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Pan()
          .activeOffsetX([-8, 8])
          .failOffsetY([-14, 14])
          .onUpdate((e) => {
            runOnJS(setPinned)(e.x);
          })
          // Only a drag that ran clears it: a tap also begins (and fails) this pan, and must keep the point it placed.
          .onFinalize((_e, success) => {
            if (success) runOnJS(setPinned)(null);
          }),
        Gesture.Tap()
          .maxDuration(300)
          .onEnd((e, ok) => {
            // Tapping the pinned point again clears it.
            if (ok) runOnJS(setPinned)((prev: number | null) => (prev !== null && Math.abs(prev - e.x) < 14 ? null : e.x));
          }),
      ),
    [],
  );
  return (
    <GestureDetector gesture={gesture}>
      <View style={{ position: "absolute", left: 0, top: 0, width, height }}>{children}</View>
    </GestureDetector>
  );
}

let lastTick = 0;

/**
 * A selection tick each time the scrubbed point moves to another data point, as a picker wheel ticks per item. Render it
 * beside the cursor with the active index (-1: none). Ticks are at least 35 ms apart, so a dense series (a day of minutes)
 * reads as a fine texture rather than a buzz.
 */
export function ScrubTick({ index }: { index: number }) {
  useEffect(() => {
    if (index < 0) return;
    const now = Date.now();
    if (now - lastTick < 35) return;
    lastTick = now;
    haptic.select();
  }, [index]);
  return null;
}

/** The scrubbed point's readout: a popover card (rounded-xl, ring) near the cursor, kept inside the chart. */
export function TooltipCard({ x, width, title, children }: { x: number; width: number; title?: string; children: ReactNode }) {
  const [w, setW] = useState(0);
  const left = Math.min(Math.max(x - w / 2, 0), Math.max(0, width - w));
  return (
    <Panel pointerEvents="none" onLayout={(e) => setW(e.nativeEvent.layout.width)} className="absolute top-0 gap-1 rounded-xl px-2.5 py-2" style={{ left, opacity: w ? 1 : 0 }}>
      {title && <Text className="text-xs font-medium leading-4 text-muted-foreground">{title}</Text>}
      {children}
    </Panel>
  );
}

/** One tooltip line: a colour tick and text. */
export function TooltipLine({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <View className="flex-row items-center gap-2">
      {color && <View className="h-3 w-1 rounded-xs" style={{ backgroundColor: color }} />}
      <Text className="font-numeric text-xs font-medium leading-4 tabular-nums text-foreground">{children}</Text>
    </View>
  );
}
