import { LinearGradient, vec } from "@shopify/react-native-skia";
import { Path } from "@/ui/charts/path";
import { bandColor, bandStops, type Band } from "@/lib/charts";
import { alpha } from "../color";

// Recharts' BandGradient / FadeGradient / bandPaint (ChartFrame.tsx), as Skia paints. A `Paint` is one colour, or a
// vertical gradient between two pixel heights with hard colour switches at band thresholds.

export type Paint = { color: string } | { y0: number; y1: number; stops: { offset: number; color: string }[] };

/**
 * The paint for a line or area spanning values `top` to `bottom`: the band colour where it passes. A flat series
 * (top == bottom) takes its band colour, as the web does, since a zero-height gradient box draws nothing.
 * `y` maps a value to pixels, `css` resolves the bands' `var(--x)` colours.
 */
export function bandPaint(top: number, bottom: number, bands: Band[], y: (v: number) => number, css: (c: string) => string): Paint {
  if (!(top > bottom)) return { color: css(bandColor(top, bands)) };
  return { y0: y(top), y1: y(bottom), stops: bandStops(top, bottom, bands).map((s) => ({ offset: s.offset, color: css(s.color) })) };
}

/** A stroked path (a line, an outline) in a `Paint`. */
export function StrokePath({ path, width, paint, opacity = 1, cap = "round", join = "round" }: { path: string; width: number; paint: Paint; opacity?: number; cap?: "butt" | "round" | "square"; join?: "round" | "miter" | "bevel" }) {
  if (!path) return null;
  return (
    <Path path={path} style="stroke" strokeWidth={width} strokeCap={cap} strokeJoin={join} opacity={opacity} color={"color" in paint ? paint.color : paint.stops[0].color}>
      {"stops" in paint && <LinearGradient start={vec(0, paint.y0)} end={vec(0, paint.y1)} colors={paint.stops.map((s) => s.color)} positions={paint.stops.map((s) => s.offset)} />}
    </Path>
  );
}

/** A one-colour fade: `color` at `from` opacity at the shape's top (`y0`) to `to` at its floor (`y1`): an area under a line fading to nothing. */
export function FadeFill({ path, color, y0, y1, from = 0.35, to = 0 }: { path: string; color: string; y0: number; y1: number; from?: number; to?: number }) {
  if (!path) return null;
  return (
    <Path path={path} style="fill" color={color}>
      <LinearGradient start={vec(0, y0)} end={vec(0, y1)} colors={[alpha(color, from), alpha(color, to)]} />
    </Path>
  );
}
