// Home › My Dashboard's CUSTOMIZE (dashboard-03..06, spec §11 CD1, CD2, R41): the reference app's full-screen editor,
// ported from pulse (app)/_lib/EditDashboard.tsx. "My Dashboard" holds the shown metrics in order, each dragged by its
// handle and removed with its minus; "Add to My Dashboard" holds the rest by group with a search field, and a tap adds
// one at the end. SAVE stores the list and shows Success. The sheet is a route (app/(sheets)/dashboard.tsx) that takes
// the metrics on Home now (`keys`) and the ones with no data (`empty`) as comma-separated params.
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { GestureHandlerRootView, Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { ChartNoAxesColumn, Equal, Minus, Pencil, Plus, Search } from "lucide-react-native";
import { saveDashboard } from "@/actions/dashboard";
import { store } from "@/data/store";
import { DASHBOARD_GROUPS, DASHBOARD_LABEL, DASHBOARD_METRICS, isDashboardKey, type DashboardKey } from "@/lib/dashboard";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { FACES } from "@/ui/fontClasses";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { SheetScreen, SheetSection } from "@/ui/shells/SheetScreen";
import { closeSheet, openSheet } from "@/ui/shells/sheets";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { statIcon } from "../_lib/view";

const CARD = "min-h-14 flex-row items-center gap-3 rounded-xl bg-foreground/[0.07] pl-4";
const NAME = "min-w-0 flex-1 text-[13px] font-bold uppercase leading-4 tracking-[0.1em]";
const ROW_H = 56;
/** One row and the 12 px gap under it: the distance a dragged row travels per place. */
const PITCH = ROW_H + 12;
const GROUP_LABEL = Object.fromEntries(DASHBOARD_GROUPS.map((g) => [g.key, g.label])) as Record<string, string>;
const moveTo = <T,>(items: T[], from: number, to: number) => {
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

/** "CUSTOMIZE" with a pencil at My Dashboard's header (home-12): opens the editor sheet. */
export function EditDashboardButton({ keys, empty }: { keys: DashboardKey[]; empty: DashboardKey[] }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Customize My Dashboard"
      onPress={() => openSheet(`/dashboard?keys=${keys.join(",")}&empty=${empty.join(",")}`)}
      hitSlop={{ top: 6, bottom: 6 }}
      className="-mr-2 h-8 flex-row items-center gap-1.5 rounded-full px-2 active:bg-foreground/[0.06]"
    >
      <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em]">Customize</Text>
      <Icon icon={Pencil} size={16} tone="foreground" strokeWidth={1.75} />
    </Pressable>
  );
}

const keysOf = (raw: string | undefined) => (raw ?? "").split(",").filter(isDashboardKey);

export function EditDashboardSheet({ keys: rawKeys, empty: rawEmpty }: { keys?: string; empty?: string }) {
  const { c } = useTheme();
  const [shown, setShown] = useState(() => keysOf(rawKeys));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState("");
  const noData = new Set(keysOf(rawEmpty));

  const q = query.trim().toLowerCase();
  const hidden = DASHBOARD_METRICS.filter((m) => !shown.includes(m.key));
  const matches = hidden.filter((m) => !q || m.label.toLowerCase().includes(q) || GROUP_LABEL[m.group].toLowerCase().includes(q));
  const groups = DASHBOARD_GROUPS.map((g) => ({ ...g, items: matches.filter((m) => m.group === g.key) })).filter((g) => g.items.length);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= shown.length || to === from) return;
    setShown((s) => moveTo(s, from, to));
    setStatus(`${DASHBOARD_LABEL[shown[from]]} moved to position ${to + 1} of ${shown.length}`);
  };
  const remove = (i: number) => {
    haptic.tap();
    setShown((s) => s.filter((_, j) => j !== i));
    setStatus(`${DASHBOARD_LABEL[shown[i]]} removed from Home`);
  };
  const add = (key: DashboardKey) => {
    haptic.tap();
    setShown((s) => [...s, key]);
    setStatus(`${DASHBOARD_LABEL[key]} added at position ${shown.length + 1}`);
  };
  const save = async () => {
    setSaving(true);
    setFailed(false);
    const r = await saveDashboard(store, { keys: shown }).catch(() => ({ ok: false as const, error: "storage" }));
    setSaving(false);
    if (!r.ok) {
      haptic.error();
      return setFailed(true);
    }
    setDone(true);
  };

  return (
    <SheetScreen
      title="Customize dashboard"
      size="screen"
      done={done ? { title: "Success", body: "Your preferences have been saved.", onDone: closeSheet } : null}
      footer={
        <>
          {/* The web shows a toast; a phone sheet shows the line above its button. */}
          {failed && <Text accessibilityRole="alert" className="text-center text-[15px] leading-[22px] text-destructive">Couldn’t save your dashboard. Try again.</Text>}
          <Button size="sheet" variant="outline-pill" onPress={save} disabled={saving || shown.length === 0}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Text accessibilityRole="header" className="mt-4 text-[22px] font-semibold leading-7">My Dashboard</Text>
      {shown.length === 0 ? (
        <Text accessibilityRole="alert" className="py-4 text-[15px] leading-[22px] text-foreground-secondary">Add at least one metric to save.</Text>
      ) : (
        // Rows sit at fixed places (index × pitch) so a drag only moves one row and the others slide into the gap.
        <GestureHandlerRootView>
          <View accessibilityRole="list" className="mt-4" style={{ height: shown.length * PITCH - 12 }}>
            {shown.map((key, i) => (
              <SortableRow key={key} id={key} index={i} count={shown.length} onMove={move} onRemove={() => remove(i)} />
            ))}
          </View>
        </GestureHandlerRootView>
      )}

      <View className="mt-8">
        <SheetSection>Add to My Dashboard</SheetSection>
      </View>
      <View className="relative mt-3">
        <View pointerEvents="none" className="absolute left-3.5 top-0 z-10 h-12 justify-center">
          <Icon icon={Search} size={18} tone="muted-foreground" strokeWidth={1.75} />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search metrics…"
          placeholderTextColor={c["muted-foreground"]}
          accessibilityLabel="Search metrics"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          className="h-12 rounded-xl bg-foreground/[0.06] pl-10 pr-3 text-base text-foreground"
          style={{ fontFamily: FACES.sans.regular }}
        />
      </View>
      {groups.map((g) => (
        <View key={g.key} className="mt-5">
          <Text accessibilityRole="header" className="text-[13px] font-semibold leading-4 text-foreground-secondary">{g.label}</Text>
          <View className="mt-2 gap-3">
            {g.items.map((m) => (
              <Pressable
                key={m.key}
                accessibilityRole="button"
                accessibilityLabel={`Add ${m.label}${noData.has(m.key) ? ", no data yet" : ""}`}
                onPress={() => add(m.key)}
                className={cn(CARD, "w-full pr-3 active:scale-[0.98]")}
              >
                <View accessibilityElementsHidden className="size-5 shrink-0 items-center justify-center">{statIcon(m.key)}</View>
                <View className="min-w-0 flex-1">
                  <Text className={NAME}>{m.label}</Text>
                  {noData.has(m.key) && <Text className="mt-0.5 text-xs font-medium leading-4 text-muted-foreground">No data yet</Text>}
                </View>
                <Icon icon={Plus} size={24} tone="foreground" strokeWidth={2} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {groups.length === 0 && (
        <Text className="py-6 text-center text-[15px] leading-[22px] text-foreground-secondary">{hidden.length ? `No metric matches “${query.trim()}”.` : "Every metric is on Home."}</Text>
      )}
      <Text accessibilityLiveRegion="polite" className="absolute h-px w-px opacity-0">{status}</Text>
    </SheetScreen>
  );
}

type Place = { top: SharedValue<number>; start: SharedValue<number>; at: SharedValue<number>; lift: SharedValue<number>; drag: SharedValue<number> };

/** The drag of one row's handle: the row follows the finger on the UI thread, and the list is told each time it crosses a neighbour. */
function sortPan(p: Place, count: number, onMove: (from: number, to: number) => void, hold: (on: boolean) => void) {
  return Gesture.Pan()
    .onBegin(() => {
      p.start.value = p.top.value;
      p.drag.value = 1;
      p.lift.value = withTiming(1, { duration: 120 });
      runOnJS(hold)(true);
    })
    .onUpdate((e) => {
      const y = Math.min(Math.max(p.start.value + e.translationY, 0), (count - 1) * PITCH);
      p.top.value = y;
      const to = Math.round(y / PITCH);
      if (to !== p.at.value) {
        const from = p.at.value;
        p.at.value = to;
        runOnJS(onMove)(from, to);
      }
    })
    .onFinalize(() => {
      p.drag.value = 0;
      p.lift.value = withTiming(0, { duration: 120 });
      p.top.value = withTiming(p.at.value * PITCH, { duration: 150 });
      runOnJS(hold)(false);
    });
}

/**
 * One row of My Dashboard. It is absolutely placed at `index × PITCH`; dragging its handle moves it with the finger (on the UI
 * thread) and asks the list to reorder each time it crosses a neighbour, the others slide to their new places.
 */
function SortableRow({ id, index, count, onMove, onRemove }: { id: DashboardKey; index: number; count: number; onMove: (from: number, to: number) => void; onRemove: () => void }) {
  const label = DASHBOARD_LABEL[id];
  const top = useSharedValue(index * PITCH);
  const start = useSharedValue(0);
  const at = useSharedValue(index);
  const lift = useSharedValue(0);
  const drag = useSharedValue(0);
  const [lifted, setLifted] = useState(false);

  // A row that is not held slides to its place when the list reorders or a row above it is removed.
  useEffect(() => {
    at.value = index;
    if (drag.value === 0) top.value = withTiming(index * PITCH, { duration: 150 });
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps -- the shared values are stable

  const hold = (on: boolean) => {
    setLifted(on);
    if (on) haptic.select();
  };
  const pan = sortPan({ top, start, at, lift, drag }, count, onMove, hold);

  const place = useAnimatedStyle(() => ({ transform: [{ translateY: top.value }, { scale: 1 + 0.02 * lift.value }] }));
  return (
    <Animated.View style={[{ position: "absolute", left: 0, right: 0, height: ROW_H, zIndex: lifted ? 10 : 0 }, place]}>
      <View className={cn(CARD, "h-14")} style={lifted ? { boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)" } : undefined}>
        <View accessibilityElementsHidden className="size-5 shrink-0 items-center justify-center">{statIcon(id)}</View>
        <Text className={NAME}>{label}</Text>
        {/* dashboard-03: the chart tile carries a small bar-chart glyph. */}
        {id === "stress" && <Icon icon={ChartNoAxesColumn} size={20} tone="muted-foreground" strokeWidth={1.5} />}
        {/* the reference app hides removal behind a swipe that members could not find; Pulse shows it (spec §11 CD2). */}
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={onRemove} className="size-11 items-center justify-center rounded-full active:scale-[0.96]">
          <View className="size-6 items-center justify-center rounded-full border border-foreground-secondary">
            <Icon icon={Minus} size={14} tone="foreground-secondary" strokeWidth={2.25} />
          </View>
        </Pressable>
        <GestureDetector gesture={pan}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`Reorder ${label}, position ${index + 1} of ${count}`}
            accessibilityHint="Drag, or swipe up or down, to move"
            accessibilityActions={[{ name: "increment", label: "Move up" }, { name: "decrement", label: "Move down" }]}
            onAccessibilityAction={(e) => onMove(index, index + (e.nativeEvent.actionName === "increment" ? -1 : 1))}
            className="size-11 items-center justify-center rounded-full"
          >
            <Icon icon={Equal} size={24} tone="foreground" strokeWidth={2} />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}
