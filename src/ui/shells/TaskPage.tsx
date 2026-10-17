import { useRef, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ground } from "../Ground";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { alpha } from "../color";
import { useKeyboardInset, useRevealFocused } from "../keyboard";
import { DetailHeader, DetailHeaderRow, detailRowHeight } from "./DetailHeader";
import { DoneScreen } from "./DoneScreen";
import { HEADER_FADE, useHeaderHeight } from "./Header";
import { goBack } from "@/ui/navigate";

export type TaskPageProps = {
  title: string;
  description?: string;
  children: ReactNode;
  /** The page's actions (Save, Edit), 44 px touch buttons pinned above the navigation bar. */
  footer?: ReactNode;
  /** The header's right-hand control (the Journal's pencil), opposite Back. */
  action?: ReactNode;
  /** The sand glow at the top that fades into the ground, under an X (the Journal, as WHOOP's journal page). */
  glow?: boolean;
  /** What Back does where a page asks first (the Journal's "Dismiss journal?"): the web's `onOpenChange(false)`. Default: close. */
  onClose?: () => void;
  /** Replaces the page's content with a confirmation ("Saved", "Success"), then calls `onDone` (usually `goBack`). */
  done?: { title: string; body: string; onDone: () => void } | null;
};

/** A caps section label with a hairline running to the edge, as the reference app's "TIME ───". Use inside a task page. */
export function TaskSection({ children }: { children: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{children}</Text>
      <View className="h-px flex-1 bg-fill-pressed" />
    </View>
  );
}

/**
 * A task page (spec §4.8). What the web shows in a drawer (check-in, the logs, the info cards) is a full-screen page here,
 * pushed like any detail page (sheets.ts): the detail header (Back, the caps title, `action`) over the ground, the
 * scrolling body, and the pill actions pinned above the navigation bar. The keyboard lifts the body and the actions.
 */
export function TaskPage({ title, description, children, footer, action, glow, done, onClose }: TaskPageProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { ref: keyboardRef, onLayout: measureKeyboard, inset: keyboardInset } = useKeyboardInset();
  const rows = detailRowHeight({ subtitle: description });
  const framed = useHeaderHeight(rows);
  // A glow page keeps its header in the flow over the glow (the detail header's ground fill would cover the glow).
  const top = glow ? 0 : framed;
  const padTop = glow ? 8 : top + HEADER_FADE;
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const offset = useRef(0);
  const reveal = useRevealFocused({ scroll, content, offset: () => offset.current, top: padTop });
  const header = { title, subtitle: description, action, onBack: onClose ?? goBack };
  // Under the pinned actions or, with none, under the body: the navigation bar's inset plus a gap, so a button never sits
  // on the screen's edge (the web's max(inset, 16px) left it touching the gesture bar). Above the keyboard: 16 pt.
  const pad = keyboardInset ? 16 : insets.bottom + 24;

  return (
    <View ref={keyboardRef} onLayout={measureKeyboard} style={[styles.fill, { backgroundColor: c.background, paddingBottom: keyboardInset }]}>
      <Ground />
      {glow && <LinearGradient pointerEvents="none" colors={[c["glow-sand"], alpha(c["glow-sand"], 0)]} style={[StyleSheet.absoluteFill, { bottom: "55%" }]} />}
      {glow && (
        <View style={{ paddingTop: insets.top }}>
          <DetailHeaderRow {...header} dismiss="close" />
        </View>
      )}
      {done ? (
        <View style={[styles.fill, { paddingTop: top }]}>
          <DoneScreen {...done} />
        </View>
      ) : (
        <>
          <ScrollView
            ref={scroll}
            {...reveal}
            onScroll={(e) => (offset.current = e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={16}
            style={styles.fill}
            contentContainerStyle={{ paddingTop: padTop, paddingHorizontal: 16, paddingBottom: footer ? 16 : pad }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <View ref={content} collapsable={false}>
              {children}
            </View>
          </ScrollView>
          {!!footer && <View className="gap-3 px-4 pt-3" style={{ paddingBottom: pad }}>{footer}</View>}
        </>
      )}
      {!glow && <DetailHeader {...header} />}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
