import { View } from "react-native";
import { RoundedRect } from "@shopify/react-native-skia";
import { Path } from "@/ui/charts/path";
import { Activity, Moon, PersonStanding } from "lucide-react-native";
import { DATA_COLORS, ZONE_COLOR } from "@/lib/bands";
import type { Band } from "@/lib/charts";
import { alpha } from "../color";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { ChartLabel } from "./ChartFrame";

/** A marked stretch on an intraday chart. `label` is the short name: "Run", "Ride", "Strength", "Sleep", "Nap". */
export type ChartSpan = { kind: "workout" | "sleep"; start: number; end: number; label: string };
export type HrZone = { zone: number; label: string; min: number; max: number };

/** Bands for colouring heart rate by zone, ascending; under the first zone the line stays neutral. */
export const zoneBands = (zones: HrZone[]): Band[] => [
  { from: 0, color: "var(--foreground-secondary)" },
  ...[...zones].sort((a, b) => a.min - b.min).map((z) => ({ from: z.min, color: DATA_COLORS[ZONE_COLOR[z.zone] ?? "strain"].css })),
];

const clampX = (x: number, x0: number, x1: number) => Math.min(Math.max(x, x0), x1);

/** Each marked stretch shaded (canvas part). `ifOverflow="hidden"`: spans are clipped to the plot. */
export function SpanFills({ spans, x, x0, x1, y0, y1 }: { spans?: ChartSpan[]; x: (t: number) => number; x0: number; x1: number; y0: number; y1: number }) {
  const { css } = useTheme();
  return (
    <>
      {(spans ?? []).map((s) => {
        const a = clampX(x(s.start), x0, x1);
        const b = clampX(x(s.end), x0, x1);
        if (b <= a) return null;
        return <RoundedRect key={`${s.kind}-${s.start}`} x={a} y={y0} width={b - a} height={y1 - y0} r={0} color={alpha(css(s.kind === "workout" ? "var(--strain-deep)" : "var(--sleep)"), s.kind === "workout" ? 0.12 : 0.08)} />;
      })}
      {(spans ?? []).map((s) => {
        const a = clampX(x(s.start), x0, x1);
        const b = clampX(x(s.end), x0, x1);
        return b > a ? <Path key={`top-${s.kind}-${s.start}`} path={`M${a},${y0}H${b}`} style="stroke" strokeWidth={2} color={css(s.kind === "workout" ? "var(--strain)" : "var(--sleep)")} /> : null;
      })}
    </>
  );
}

/**
 * A marked stretch's header (overlay part): an icon with its name centred above its 2 px accent. `iconOnly`: the Stress
 * Monitor's moon and walker, drawn over even a narrow stretch.
 */
export function SpanHeads({ spans, x, x0, x1, y0, iconOnly }: { spans?: ChartSpan[]; x: (t: number) => number; x0: number; x1: number; y0: number; iconOnly?: boolean }) {
  return (
    <>
      {(spans ?? []).map((s) => {
        const a = clampX(x(s.start), x0, x1);
        const b = clampX(x(s.end), x0, x1);
        const width = b - a;
        if (width <= 0) return null;
        const Glyph = s.kind === "sleep" ? Moon : iconOnly ? PersonStanding : Activity;
        if (iconOnly)
          return (
            <View key={`${s.kind}-${s.start}`} pointerEvents="none" style={{ position: "absolute", left: a + width / 2 - 7, top: y0 - 18 }}>
              <Icon icon={Glyph} size={14} tone="foreground" strokeWidth={2} />
            </View>
          );
        const w = 14 + Math.ceil(s.label.length * 6.2);
        // A header stays inside its own stretch, so back-to-back spans never overprint: the name when it fits, else the icon alone.
        const named = width >= w;
        const left = named ? a + width / 2 - w / 2 : a + width / 2 - 5.5;
        return (
          <View key={`${s.kind}-${s.start}`} pointerEvents="none" style={{ position: "absolute", left, top: y0 - 15, flexDirection: "row", alignItems: "center", gap: 3 }}>
            {width >= 11 && <Icon icon={Glyph} size={11} tone={s.kind === "workout" ? "strain" : "sleep"} strokeWidth={2.25} />}
            {named && <Text className="text-[11px] font-semibold leading-[11px] text-foreground-secondary" numberOfLines={1}>{s.label}</Text>}
          </View>
        );
      })}
    </>
  );
}

/**
 * The zones on the bpm axis: a 4 px colour strip along the plot's right edge at each zone's height (canvas part), labelled
 * Z1-Z5 (overlay part). Only the part of a zone inside the y domain is drawn.
 */
export function zoneStrips(zones: HrZone[] | undefined, domain: [number, number], y: (v: number) => number, x1: number) {
  return (zones ?? []).flatMap((z) => {
    const lo = Math.max(z.min, domain[0]);
    const hi = Math.min(z.max, domain[1]);
    if (hi <= lo) return [];
    return [{ zone: z.zone, top: y(hi), height: y(lo) - y(hi), x: x1, color: DATA_COLORS[ZONE_COLOR[z.zone] ?? "strain"].css }];
  });
}

export function ZoneStripBars({ strips, css }: { strips: ReturnType<typeof zoneStrips>; css: (c: string) => string }) {
  return (
    <>
      {strips.map((s) => (
        <RoundedRect key={s.zone} x={s.x + 3} y={s.top + 0.5} width={4} height={Math.max(0, s.height - 1)} r={2} color={css(s.color)} />
      ))}
    </>
  );
}

export function ZoneStripLabels({ strips, css }: { strips: ReturnType<typeof zoneStrips>; css: (c: string) => string }) {
  return (
    <>
      {strips.map((s) =>
        s.height >= 11 ? (
          <ChartLabel key={s.zone} x={s.x + 11} y={s.top + s.height / 2} anchor="start" w={20} className="text-[10px] font-bold" color={css(s.color)}>{`Z${s.zone}`}</ChartLabel>
        ) : null,
      )}
    </>
  );
}
