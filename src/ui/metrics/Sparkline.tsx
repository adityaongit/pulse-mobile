import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { linePath } from "../charts/geometry";
import { alpha } from "../color";
import { cn } from "../cn";
import { Text } from "../Text";
import { useTheme } from "../theme";

/**
 * A small line of recent values (oldest first) with the normal range shaded and the latest value dotted, as Bevel puts
 * in every tile. Gaps (null) break the line. The web stretches an SVG and keeps its stroke width with
 * non-scaling-stroke; here the box is measured and the line drawn in real pixels, which needs no such trick.
 * `color` is a colour string (resolve a token with `useTheme()`); `colorOf` instead colours each step by the value it
 * reaches (the Home heart-rate card's zones).
 */
export function Sparkline({ values, band, color, colorOf, caption, className }: { values: (number | null)[]; band?: { low: number; high: number } | null; color?: string; colorOf?: (v: number) => string; caption?: string; className?: string }) {
  const { c } = useTheme();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const stroke = color ?? c["foreground-secondary"];
  const xs = values.flatMap((v) => (v === null ? [] : [v]));
  if (xs.length < 2) return null;
  const lo = Math.min(...xs, band?.low ?? Infinity);
  const hi = Math.max(...xs, band?.high ?? -Infinity);
  const pad = (hi - lo || 1) * 0.12;
  const { w, h } = box;
  const y = (v: number) => h - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * h;
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const lastI = values.findLastIndex((v) => v !== null);
  return (
    <View accessibilityElementsHidden className={cn("gap-1", className)}>
      <View className="min-h-0 flex-1" onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {w > 0 && h > 0 && (
          <Svg width={w} height={h} style={{ overflow: "visible" }}>
            {band && (
              <>
                <Rect x={0} y={y(band.high)} width={w} height={Math.max(0, y(band.low) - y(band.high))} fill={alpha(c.foreground, 0.05)} />
                {[band.high, band.low].map((v) => (
                  <Line key={v} x1={0} x2={w} y1={y(v)} y2={y(v)} stroke={c["chart-grid"]} strokeDasharray="3 3" strokeWidth={1} />
                ))}
              </>
            )}
            {colorOf ? (
              values.map((v, i) => {
                const prev = values[i - 1];
                return i > 0 && v !== null && prev != null ? <Line key={i} x1={x(i - 1)} y1={y(prev)} x2={x(i)} y2={y(v)} stroke={colorOf(v)} strokeWidth={1.5} strokeLinecap="round" /> : null;
              })
            ) : (
              <Path d={linePath(values.map((v, i) => ({ x: x(i), y: v === null ? null : y(v) })))} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            )}
            <Circle cx={x(lastI)} cy={y(values[lastI]!)} r={6} fill={c.card} />
            <Circle cx={x(lastI)} cy={y(values[lastI]!)} r={4} fill={colorOf ? colorOf(values[lastI]!) : stroke} />
          </Svg>
        )}
      </View>
      {!!caption && <Text className="text-right text-[10px] font-semibold uppercase leading-3 tracking-[0.06em] text-muted-foreground">{caption}</Text>}
    </View>
  );
}
