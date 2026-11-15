// A reorder sheet for the gym's lists: hold a row, drag it, and Done writes the new order. The hold delay lets a
// normal drag scroll the sheet first, and it matches the long-press used to open it from a template or an exercise.
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { GripVertical, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { DURATION } from "@/ui/motion";
import { haptic } from "@/ui/haptics";
import { i18n } from "@/i18n/config";

export type ReorderItem = { id: string; label: string; meta?: string };

const ROW_H = 54;
const PITCH = 60;

/** Reorders `items` locally, then hands the new id order to `onDone`. */
export function ReorderSheet({ open, title, items, onClose, onDone }: { open: boolean; title: string; items: ReorderItem[]; onClose: () => void; onDone: (ordered: string[]) => void }) {
  const { t } = useTranslation("gym");
  const [order, setOrder] = useState<ReorderItem[]>(items);
  const [dragging, setDragging] = useState(false);
  const wasOpen = useRef(false);
  // Reset only when the sheet opens: a live data reload must not wipe an order the finger is in the middle of making.
  useEffect(() => {
    if (open && !wasOpen.current) setOrder(items);
    wasOpen.current = open;
  }, [open, items, wasOpen]);
  const move = (from: number, to: number) =>
    setOrder((prev) => {
      if (from === to) return prev;
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-dim-strong px-4">
        <Pressable onPress={() => {}} className="w-full max-w-[420px] gap-4 rounded-3xl bg-popover p-5">
          <View className="flex-row items-center justify-between gap-3">
            <Text accessibilityRole="header" className="text-[17px] font-semibold leading-6">
              {title}
            </Text>
            <Press accessibilityRole="button" accessibilityLabel={i18n.t("common:actions.close")} onPress={onClose} className="size-11 items-center justify-center">
              <Icon icon={X} size={20} tone="muted-foreground" />
            </Press>
          </View>
          <Text className="text-[13px] leading-[18px] text-muted-foreground">{t("reorder.hint")}</Text>
          <ScrollView scrollEnabled={!dragging} showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            <View style={{ height: order.length * PITCH }}>
              {order.map((item, index) => (
                <ReorderRow key={item.id} item={item} index={index} count={order.length} onMove={move} onHold={setDragging} />
              ))}
            </View>
          </ScrollView>
          <Button onPress={() => onDone(order.map((i) => i.id))}>{t("reorder.done")}</Button>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type Place = { top: SharedValue<number>; start: SharedValue<number>; at: SharedValue<number>; lift: SharedValue<number>; drag: SharedValue<number> };

/** The drag of one row: it follows the finger after a hold, and the list is told each time it crosses a neighbour. */
function sortPan(p: Place, count: number, onMove: (from: number, to: number) => void, hold: (on: boolean) => void) {
  return Gesture.Pan()
    .activateAfterLongPress(260)
    .onStart(() => {
      p.start.value = p.top.value;
      p.drag.value = 1;
      p.lift.value = withTiming(1, { duration: DURATION.lift });
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
      p.lift.value = withTiming(0, { duration: DURATION.lift });
      p.top.value = withTiming(p.at.value * PITCH, { duration: DURATION.fast });
      runOnJS(hold)(false);
    });
}

function ReorderRow({ item, index, count, onMove, onHold }: { item: ReorderItem; index: number; count: number; onMove: (from: number, to: number) => void; onHold: (on: boolean) => void }) {  const { t } = useTranslation("gym");
  const top = useSharedValue(index * PITCH);
  const start = useSharedValue(0);
  const at = useSharedValue(index);
  const lift = useSharedValue(0);
  const drag = useSharedValue(0);
  const [lifted, setLifted] = useState(false);

  // A row nobody is holding slides to its place when the list reorders.
  useEffect(() => {
    at.value = index;
    if (drag.value === 0) top.value = withTiming(index * PITCH, { duration: DURATION.fast });
  }, [index, at, drag, top]); // the shared values are the same objects on every render

  const hold = (on: boolean) => {
    setLifted(on);
    onHold(on);
    if (on) haptic.select();
  };
  const pan = sortPan({ top, start, at, lift, drag }, count, onMove, hold);
  const place = useAnimatedStyle(() => ({ transform: [{ translateY: top.value }, { scale: 1 + 0.02 * lift.value }] }));

  return (
    <Animated.View style={[{ position: "absolute", left: 0, right: 0, height: ROW_H, zIndex: lifted ? 10 : 0 }, place]}>
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={item.label}
          accessibilityHint={t("reorder.hint")}
          accessibilityValue={{ text: `${index + 1}/${count}` }}
          accessibilityActions={[{ name: "increment", label: t("session.moveUp") }, { name: "decrement", label: t("session.moveDown") }]}
          onAccessibilityAction={(e) => onMove(index, Math.min(count - 1, Math.max(0, index + (e.nativeEvent.actionName === "increment" ? -1 : 1))))}
          className="h-full flex-row items-center gap-3 rounded-xl bg-secondary px-3"
        >
          <View className="flex-1">
            <Text className="text-[15px] font-semibold leading-5" numberOfLines={1}>
              {item.label}
            </Text>
            {!!item.meta && (
              <Text className="text-[12px] leading-4 text-muted-foreground" numberOfLines={1}>
                {item.meta}
              </Text>
            )}
          </View>
          <Icon icon={GripVertical} size={20} tone="muted-foreground" />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}
