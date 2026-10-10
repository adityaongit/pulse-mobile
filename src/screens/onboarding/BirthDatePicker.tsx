// A birth date picker (U19). Ported from pulse src/components/profile/BirthDatePicker.tsx: the field opens three wheels
// (month, day, year) inline under it, so nothing floats over the form and it works the same inside a sheet. Each wheel is
// a snapping scroll view whose centred row is the value; scrolling or tapping a row picks. A plain ScrollView, not a
// FlatList: a wheel has at most about 110 rows, and a virtualized list may not nest inside the form's scroll view.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { CalendarDays } from "lucide-react-native";
import { DAY, formatDay } from "@/lib/format";
import { alpha } from "@/ui/color";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { ringStyle, SmallButton } from "../settings/controls";

const MONTHS = Array.from({ length: 12 }, (_, i) => formatDay(`2026-${String(i + 1).padStart(2, "0")}`, { month: "long" }));
const OLDEST = 1920;
/** Where the year wheel rests before anything is picked: the middle of the likely range. */
const START_YEAR = 1995;
const ROW = 40;
const VISIBLE = 3;
const HEIGHT = ROW * VISIBLE;

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/** One wheel column: the row at `index` sits in the middle; a scroll that comes to rest on another row, or a tap on one, picks it. */
function Wheel({ label, items, index, onIndex }: { label: string; items: string[]; index: number; onIndex: (i: number) => void }) {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(index * ROW);
  // Follow outside changes (open, a shorter month) without fighting the user's own scroll: only when the wheel is not already there.
  useEffect(() => {
    if (Math.round(offset.current / ROW) !== index) {
      offset.current = index * ROW;
      ref.current?.scrollTo({ y: index * ROW, animated: false });
    }
  }, [index, items.length]);
  const go = (i: number) => {
    const next = Math.max(0, Math.min(items.length - 1, i));
    ref.current?.scrollTo({ y: next * ROW, animated: true });
    if (next !== index) {
      haptic.select();
      onIndex(next);
    }
  };
  const settle = () => {
    const i = Math.max(0, Math.min(items.length - 1, Math.round(offset.current / ROW)));
    if (i !== index) {
      haptic.select();
      onIndex(i);
    }
  };
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: items[index] }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => go(index + (e.nativeEvent.actionName === "increment" ? 1 : -1))}
      style={{ height: HEIGHT }}
    >
      <ScrollView
        ref={ref}
        contentOffset={{ x: 0, y: index * ROW }}
        snapToInterval={ROW}
        snapToAlignment="start"
        decelerationRate="fast"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.y;
        }}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
        // The first and last row can reach the middle: a row of space above and below.
        contentContainerStyle={{ paddingVertical: ROW }}
      >
        {items.map((item, i) => (
          <Pressable key={item} accessible={false} onPress={() => go(i)} className="items-center justify-center" style={{ height: ROW }}>
            <Text className={cn("text-[17px] tabular-nums", i === index ? "font-semibold text-foreground" : "text-muted-foreground")}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** `value` is yyyy-MM-dd, or "" before one is chosen. */
export function BirthDatePicker({ value, onChange, invalid }: { value: string; onChange: (value: string) => void; invalid?: boolean }) {
  const { c } = useTheme();
  const youngest = useMemo(() => new Date().getFullYear() - 13, []);
  const years = useMemo(() => Array.from({ length: youngest - OLDEST + 1 }, (_, i) => String(OLDEST + i)), [youngest]);
  const [open, setOpen] = useState(false);
  const [y, m, d] = value ? value.split("-").map(Number) : [START_YEAR, 1, 1];
  const days = Array.from({ length: daysIn(y, m - 1) }, (_, i) => String(i + 1));
  const set = (year: number, month: number, day: number) => onChange(`${year}-${pad(month)}-${pad(Math.min(day, daysIn(year, month - 1)))}`);
  const solid = alpha(c.field, 0.65);
  const clear = alpha(c.field, 0);

  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Birth date"
        accessibilityValue={{ text: value ? formatDay(value, { ...DAY.full, month: "long" }) : "Not chosen" }}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          haptic.tap();
          setOpen((o) => !o);
        }}
        className="h-13 w-full min-w-0 flex-row items-center justify-between gap-3 rounded-xl bg-field px-4"
        style={ringStyle(invalid ? c["recovery-red-text"] : open ? alpha(c.foreground, 0.7) : null)}
      >
        <Text className={cn("text-[17px] leading-6 tabular-nums", !value && "text-muted-foreground")}>{value ? formatDay(value, { ...DAY.full, month: "long" }) : "Choose your birth date"}</Text>
        <Icon icon={CalendarDays} size={20} tone="foreground-secondary" strokeWidth={1.75} />
      </Pressable>
      {open && (
        <View accessibilityLabel="Birth date" className="overflow-hidden rounded-xl bg-field">
          <View className="flex-row gap-1 px-2 pt-1">
            {/* The selection band behind the centre row. */}
            <View accessibilityElementsHidden pointerEvents="none" className="absolute inset-x-2 h-10 rounded-lg bg-foreground/8" style={{ top: 4 + ROW }} />
            <View style={{ flex: 1.6 }}>
              <Wheel label="Month" items={MONTHS} index={m - 1} onIndex={(i) => set(y, i + 1, d)} />
            </View>
            <View style={{ flex: 1 }}>
              <Wheel label="Day" items={days} index={Math.min(d, days.length) - 1} onIndex={(i) => set(y, m, i + 1)} />
            </View>
            <View style={{ flex: 1.2 }}>
              <Wheel label="Year" items={years} index={Math.max(0, years.indexOf(String(y)))} onIndex={(i) => set(OLDEST + i, m, d)} />
            </View>
            {/* The web fades the wheels' top and bottom with a mask; the same two edges here, as gradients over the rows. */}
            <LinearGradient pointerEvents="none" colors={[solid, clear]} style={{ position: "absolute", top: 4, left: 0, right: 0, height: 50 }} />
            <LinearGradient pointerEvents="none" colors={[clear, solid]} style={{ position: "absolute", top: 4 + HEIGHT - 50, left: 0, right: 0, height: 50 }} />
          </View>
          <View className="flex-row items-center justify-between gap-3 border-t border-foreground/[0.06] py-1.5 pl-4 pr-1.5">
            <Text numberOfLines={1} className="shrink text-[13px] leading-[18px] text-muted-foreground">
              Scroll or tap to pick
            </Text>
            {/* Done keeps what the wheels show, even if they were never moved. */}
            <SmallButton
              solid
              label="Done"
              onPress={() => {
                set(y, m, d);
                setOpen(false);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}
