import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { alpha } from "../color";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { DoneScreen } from "./DoneScreen";
import { closeSheet, type SheetSize } from "./sheets";

export type SheetScreenProps = {
  title: string;
  description?: string;
  children: ReactNode;
  /** Stacked full-width actions: `Button size="sheet"` (white primary, then `variant="outline-pill"`). */
  footer?: ReactNode;
  /** The size the route was registered with in app/_layout.tsx (`sheetOptions(size)`); see sheets.ts. */
  size?: SheetSize;
  /** Screen only: the header's right-hand control (the Journal's pencil), in place of the X. */
  action?: ReactNode;
  /** Screen only: the sand glow at the top that fades into the sheet (the Journal). */
  glow?: boolean;
  /** Replaces the sheet's content with a confirmation ("Saved", "Success"), then calls `onDone` (usually `closeSheet`). */
  done?: { title: string; body: string; onDone: () => void } | null;
};

/** A caps section label with a hairline running to the edge, as the reference app's "TIME ───". Use inside a sheet. */
export function SheetSection({ children }: { children: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{children}</Text>
      <View className="h-px flex-1 bg-foreground/10" />
    </View>
  );
}

/**
 * The content of a sheet route (spec §4.8). The frame (drag, detents, dim, corners, dismissal) is the platform's, set
 * by `sheetOptions` in app/_layout.tsx; this draws what is inside: the opaque dark gradient from `sheet` to
 * `sheet-bottom` (spec §2.6: not glass), the centred caps title with the X at the right, the body and pinned pill
 * actions. A route renders it once as its whole content. The keyboard lifts the body (`KeyboardAvoidingView`).
 */
export function SheetScreen({ title, description, children, footer, size = "default", action, glow, done }: SheetScreenProps) {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const fit = size === "default";
  const screen = size === "screen";

  const header = (
    <View className="flex-row items-center gap-2 px-2 pb-3 pt-1">
      <View className="w-11" />
      <View className="flex-1 items-center">
        <Text accessibilityRole="header" className="text-center text-[15px] font-bold uppercase leading-5 tracking-[0.1em]">
          {title}
        </Text>
        {description && <Text className="mt-0.5 text-center text-xs font-medium leading-4 text-muted-foreground">{description}</Text>}
      </View>
      {/* X at the right everywhere, where people look for it (2026-10-04, spec §4.8); `action` takes its place on a screen. */}
      {screen && action ? (
        action
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={closeSheet} className="size-11 items-center justify-center rounded-full active:bg-foreground/8">
          <X size={22} color={c.foreground} strokeWidth={1.75} />
        </Pressable>
      )}
    </View>
  );
  const foot = footer && <View className="gap-3 px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>{footer}</View>;
  const bottom = !footer && fit ? <View style={{ height: Math.max(insets.bottom, 8) }} /> : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={fit ? undefined : styles.fill}>
      {/* The fill is painted by the sheet's own content, over the native frame's plain background. */}
      <LinearGradient
        pointerEvents="none"
        colors={[glow && !done ? c["glow-sand"] : c.sheet, c.sheet, c["sheet-bottom"]]}
        locations={[0, glow && !done ? 0.45 : 0.001, 1]}
        style={StyleSheet.absoluteFill}
      />
      {screen && <StatusBar style={scheme === "dark" ? "light" : "dark"} />}
      {/* iOS draws its own grabber (sheetGrabberVisible); Android's native sheet has none. */}
      {Platform.OS === "android" && !screen && <View className="mt-2 h-1.5 w-10 self-center rounded-full" style={{ backgroundColor: alpha(c.foreground, 0.25) }} />}
      <View style={[fit ? undefined : styles.fill, { paddingTop: Platform.OS === "ios" ? 14 : screen ? insets.top + 8 : 8 }]}>
        {done ? (
          <View style={fit ? styles.doneFit : styles.fill}>
            <DoneScreen {...done} />
          </View>
        ) : (
          <>
            {header}
            {fit ? (
              <View className="px-4 pb-4">{children}</View>
            ) : (
              <ScrollView style={styles.fill} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
                {children}
              </ScrollView>
            )}
            {foot}
            {bottom}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 }, doneFit: { height: 320 } });
