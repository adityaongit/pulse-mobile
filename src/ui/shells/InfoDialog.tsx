import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { X } from "lucide-react-native";
import type { ChipTone } from "@/lib/bands";
import { router, type Href } from "expo-router";
import { Button } from "../Button";
import { StatusChip } from "../metrics/primitives";
import { Text } from "../Text";
import { useTheme } from "../theme";

export type InfoContent = {
  title: string;
  /** A string, or nodes (use <Text> for each paragraph). */
  body: ReactNode;
  /** A 28 px icon above the title. */
  icon?: ReactNode;
  /** Status chip beside the title ("Within 24 - 28"). */
  chip?: { tone: ChipTone; text: string };
  /** One outline action, e.g. "Open trend view". */
  action?: { label: string; href: string };
};

/**
 * The reference app's centred info card (spec §4.8) for every explanation: an opaque card over an 85 % dim with no
 * blur. A native <Modal> (fade), so the OS back gesture closes it and focus returns to the opener on its own.
 */
export function InfoDialog({ open, onClose, title, body, icon, chip, action }: InfoContent & { open: boolean; onClose: () => void }) {
  const { c, scheme } = useTheme();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityLabel="Close" onPress={onClose} className="flex-1 items-center justify-center bg-dim-strong px-4">
        {/* The card swallows taps, so only the dim closes the dialog. */}
        <Pressable
          accessible={false}
          onPress={() => {}}
          className="max-h-[80%] w-full max-w-[360px] overflow-hidden rounded-3xl bg-popover"
          style={{ boxShadow: `inset 0 0 0 1px ${scheme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(16, 21, 24, 0.08)"}, ${scheme === "dark" ? "0 8px 24px rgba(0, 0, 0, 0.45)" : "0 8px 24px rgba(16, 21, 24, 0.14)"}`, backgroundColor: c.popover }}
        >
          <ScrollView contentContainerClassName="p-6" showsVerticalScrollIndicator={false}>
            {icon && <View className="mb-4">{icon}</View>}
            <View className="mb-3 flex-row items-start gap-2.5 pr-8">
              {chip && <StatusChip tone={chip.tone}>{chip.text}</StatusChip>}
              <Text accessibilityRole="header" className="shrink text-[15px] font-bold uppercase leading-5 tracking-[0.1em] text-popover-foreground">
                {title}
              </Text>
            </View>
            <View className="gap-4">{typeof body === "string" ? <Text className="text-[15px] leading-[22px] text-foreground/85">{body}</Text> : body}</View>
            {action && (
              <Button
                variant="outline-pill"
                className="mt-6 h-12 w-full"
                onPress={() => {
                  onClose();
                  router.push(action.href as Href);
                }}
              >
                {action.label}
              </Button>
            )}
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="absolute right-3 top-3 size-11 items-center justify-center rounded-full active:bg-foreground/8">
            <X size={22} color={c.foreground} strokeWidth={1.75} />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
