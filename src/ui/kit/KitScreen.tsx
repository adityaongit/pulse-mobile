import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { addDays } from "@/lib/url";
import { cn } from "../cn";
import { Ground } from "../Ground";
import { Icon } from "../Icon";
import { Segmented } from "../Segmented";
import { type CalendarDay, ShellCalendarProvider } from "../shells/ShellStatus";
import { Text } from "../Text";
import * as fx from "../fixtures/kit";
import { Divided } from "../Divided";

// The frame of the kit screens (app/dev/kit*): the web kit page's Entry and Frame, as React Native. Not part of the
// app: only the dev kit uses it.

const byDay = (rows: { date: string; value: number | null }[]) => new Map(rows.map((r) => [r.date, r.value]));
const recovery = byDay(fx.recoveryTrend);
const strain = byDay(fx.strainTrend);

/** The calendar panel's month data from the fixtures: Recovery and Strain by day, Sleep derived from Recovery. */
export async function loadKitMonth(month: string): Promise<CalendarDay[]> {
  const days: CalendarDay[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) {
    const r = recovery.get(d) ?? null;
    days.push({ day: d, recovery: r, strain: strain.get(d) ?? null, sleep: r === null ? null : Math.min(100, r + 6) });
  }
  return days;
}

const CALENDAR = { today: fx.TODAY, firstDay: addDays(fx.TODAY, -179), timeZone: fx.TZ, loadMonth: loadKitMonth };

type Preference = "system" | "light" | "dark";
const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

/**
 * The light / dark toggle. NativeWind's `setColorScheme` flips the class the tokens hang on (global.css), and every
 * class and every Skia chart follows. "System" hands control back to the phone's setting.
 */
export function ThemeToggle() {
  const { setColorScheme } = useColorScheme();
  const [pref, setPref] = useState<Preference>("system");
  return (
    <Segmented
      label="Theme"
      value={pref}
      options={THEMES}
      textClassName="text-[13px] font-bold"
      onChange={(p) => {
        setPref(p);
        setColorScheme(p);
      }}
    />
  );
}

/** A kit screen: the ground, a header with Back and the theme toggle, then the entries. The calendar fixtures make the DateSwitcher work. */
export function KitScreen({ title, blurb, children }: { title: string; blurb?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ShellCalendarProvider value={CALENDAR}>
      <View className="flex-1 bg-background">
        <Ground />
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 48 }} showsVerticalScrollIndicator={false}>
          <View className="gap-4 px-4 pb-6">
            <View className="flex-row items-center justify-between gap-2">
              <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/dev/kit"))} className="-ml-2 size-11 items-center justify-center rounded-full active:bg-foreground/8">
                <Icon icon={ChevronLeft} size={26} tone="foreground" strokeWidth={1.75} />
              </Pressable>
              <ThemeToggle />
            </View>
            <Text accessibilityRole="header" className="text-[28px] font-semibold leading-9 tracking-[-0.01em]">
              {title}
            </Text>
            {blurb && <Text className="text-[15px] leading-[22px] text-foreground-secondary">{blurb}</Text>}
          </View>
          <View className="gap-12 px-4">{children}</View>
        </ScrollView>
      </View>
    </ShellCalendarProvider>
  );
}

/** A group of entries with a heading (the web's Shells / Metrics / Charts sections). */
export function Group({ title, blurb, children }: { title: string; blurb?: string; children: ReactNode }) {
  return (
    <View className="gap-8">
      <View className="gap-2 border-b border-border pb-4">
        <Text accessibilityRole="header" className="text-2xl font-semibold leading-8 tracking-[-0.01em]">
          {title}
        </Text>
        {blurb && <Text className="text-[15px] leading-[22px] text-foreground-secondary">{blurb}</Text>}
      </View>
      {children}
    </View>
  );
}

/** One component: its name, file, where the app uses it, its key props, then its states in frames. */
export function Entry({ name, file, use, props = [], children }: { name: string; file: string; use: string; props?: string[]; children: ReactNode }) {
  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text accessibilityRole="header" className="text-[17px] font-semibold leading-6">
          {name}
        </Text>
        <Text className="text-xs leading-4 text-muted-foreground">{file}</Text>
        <Text className="text-[15px] leading-[22px] text-foreground-secondary">{use}</Text>
        {props.length > 0 && (
          <View className="flex-row flex-wrap gap-1.5">
            {props.map((p) => (
              <View key={p} className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5">
                <Text className="text-xs leading-4 text-foreground-secondary">{p}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <View className="gap-3">{children}</View>
    </View>
  );
}

/** One labelled state of a component. `narrow`: inside a 320 px column, the narrowest phone Pulse supports. `center`: centred (dials, marks). */
export function Frame({ name, narrow, center, children }: { name: string; narrow?: boolean; center?: boolean; children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-2xl border border-border">
      <View className="flex-row items-baseline justify-between gap-3 border-b border-border px-3 py-2">
        <Text className="shrink text-xs font-medium leading-4 text-muted-foreground">{name}</Text>
        {narrow && <Text className="shrink-0 font-numeric text-xs leading-4 tabular-nums text-muted-foreground">320 px</Text>}
      </View>
      <View className={cn("p-3", center && "items-center")}>{narrow ? <View className="w-[320px] max-w-full self-center border border-dashed border-border">{children}</View> : children}</View>
    </View>
  );
}

/** The web's `row`: dials side by side, centred. */
export const ROW = "flex-row flex-wrap items-start justify-center gap-2";
/** A list of rows in a card (KeyStatRow rows). */
export const ROWS = "rounded-xl bg-card px-4 py-1";

export { Divided };

/** The calendar fixtures alone, for the whole-screen demos (home, detail), which bring their own scroll view and header. */
export function KitCalendar({ children }: { children: ReactNode }) {
  return <ShellCalendarProvider value={CALENDAR}>{children}</ShellCalendarProvider>;
}
