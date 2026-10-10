import { haptic } from "../haptics";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View, type LayoutRectangle } from "react-native";
import { Check } from "lucide-react-native";
import { BAND_WORD, DATA_COLORS, recoveryBand, recoveryColor } from "@/lib/bands";
import { DAY, formatDay } from "@/lib/format";
import { cn } from "../cn";
import { Skeleton } from "../Skeleton";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { useSelectedDay } from "../shells/DateSwitcher";
import { Icon } from "../Icon";

export type DayStripDay = {
  /** YYYY-MM-DD. */
  date: string;
  /** `recovery` indicator: the day's Recovery, null when none. */
  recovery?: number | null;
  /** `journal` indicator: checked in. */
  done?: boolean;
};

export type DayStripProps = {
  indicator: "recovery" | "journal";
  /** The 30 days ending today, extended back to include `d` (U10). Oldest first; no future days. */
  days: DayStripDay[];
  /** "pill": the Journal's tall rounded days with a short weekday, the selected one ringed (journal-01). */
  variant?: "tile" | "pill";
  /** With `onSelect`, the strip picks a day for its owner instead of changing the route's `d`. */
  value?: string;
  onSelect?: (day: string) => void;
};

function Strip({ indicator, days, variant = "tile", value: controlled, onSelect }: DayStripProps) {
  const { c } = useTheme();
  const [urlDay, setUrlDay] = useSelectedDay();
  const selected = controlled ?? urlDay;
  const scroller = useRef<ScrollView>(null);
  const boxes = useRef(new Map<string, LayoutRectangle>());
  const [viewport, setViewport] = useState(0);
  const first = useRef(true);

  // Centre the selected day inside the strip (the strip only: it never scrolls the page).
  useEffect(() => {
    const b = boxes.current.get(selected);
    if (!b || !viewport) return;
    scroller.current?.scrollTo({ x: Math.max(0, b.x + b.width / 2 - viewport / 2), animated: !first.current });
    first.current = false;
  }, [selected, viewport, days.length]);

  return (
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} onLayout={(e) => setViewport(e.nativeEvent.layout.width)} accessibilityLabel="Choose a day" contentContainerClassName={cn("px-4 py-1", variant === "pill" ? "gap-2" : "gap-1")} className="-my-1">
      {days.map((day) => {
        const r = day.recovery ?? null;
        const label =
          indicator === "recovery"
            ? `${formatDay(day.date, DAY.long)}, ${r === null ? "no Recovery" : `Recovery ${Math.round(r)} percent, ${BAND_WORD[recoveryBand(r)].toLowerCase()}`}`
            : `${formatDay(day.date, DAY.long)}, ${day.done ? "checked in" : "not checked in"}`;
        const on = day.date === selected;
        const pill = variant === "pill";
        return (
          <Pressable
            key={day.date}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            onLayout={(e) => boxes.current.set(day.date, e.nativeEvent.layout)}
            onPress={() => {
              // The route's day changes through useSelectedDay, which ticks; an owner's onSelect ticks here.
              if (onSelect) {
                haptic.select();
                onSelect(day.date);
              } else setUrlDay(day.date);
            }}
            // Sized by its contents with 8 px above and below, so the badge sits fully inside the lit tile (SYM1).
            className={cn("items-center justify-center active:scale-[0.96]", pill ? "w-12 gap-1.5 rounded-full py-3" : "w-11 gap-1 rounded-xl py-2", pill ? "bg-foreground/[0.07]" : on && "bg-foreground/10")}
            style={pill && on ? { boxShadow: `inset 0 0 0 2px ${c.foreground}` } : undefined}
          >
            <Text accessible={false} className={cn("font-semibold leading-3 text-muted-foreground", pill ? "text-xs" : "text-[11px]")}>
              {formatDay(day.date, { weekday: pill ? "short" : "narrow" })}
            </Text>
            <Text accessible={false} className="font-numeric text-[17px] font-semibold leading-5 tabular-nums">
              {formatDay(day.date, { day: "numeric" })}
            </Text>
            {indicator === "recovery" ? (
              <View className={cn("h-1 w-4 rounded-full", r === null ? "bg-dial-track" : DATA_COLORS[recoveryColor(r)].bg)} />
            ) : (
              <View
                className={cn("items-center justify-center rounded-full", pill ? "size-5" : "size-4", day.done ? (pill ? "bg-optimal" : "bg-optimal/20") : "border border-border")}
                style={undefined}
              >
                {day.done && <Icon icon={Check} size={pill ? 12 : 10} tone={pill ? "on-color" : "optimal-text"} strokeWidth={3} />}
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Scrub the last 30 days (spec §5.11). Changes the route's `d` (or calls `onSelect`). */
export function DayStrip(props: DayStripProps) {
  return <Strip {...props} />;
}

export function DayStripSkeleton({ indicator = "recovery" }: { indicator?: DayStripProps["indicator"] }) {
  return (
    // The strip's 30 tiles, clipped like the real one, so wide columns fill too.
    <View accessibilityElementsHidden className="flex-row gap-1 overflow-hidden px-4">
      {Array.from({ length: 30 }, (_, i) => (
        <Skeleton key={i} className={cn("w-11 shrink-0 rounded-xl", indicator === "journal" ? "h-[72px]" : "h-[60px]")} />
      ))}
    </View>
  );
}
DayStrip.Skeleton = DayStripSkeleton;
