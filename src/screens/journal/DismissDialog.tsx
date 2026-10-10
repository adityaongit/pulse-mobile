// "Dismiss journal?" (journal-15): a centred dialog over the check-in. Its copy and buttons are the web's; the frame
// is the info card's (src/ui/shells/InfoDialog.tsx), a native <Modal> so the back gesture keeps editing.
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Check } from "lucide-react-native";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Gradient } from "@/ui/Gradient";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

/** "Don't show me this message again", kept for the session. ponytail: the web keeps it on the device; that needs a settings key (src/data/repos/settings.ts), a shared file. */
let quiet = false;
export const dismissIsQuiet = () => quiet;

export function DismissDialog({ open, onKeep, onDismiss }: { open: boolean; onKeep: () => void; onDismiss: () => void }) {
  const { c, scheme } = useTheme();
  const [checked, setChecked] = useState(false);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onKeep} statusBarTranslucent navigationBarTranslucent onShow={() => setChecked(false)}>
      <Pressable accessibilityLabel="No, complete journal" onPress={onKeep} className="flex-1 items-center justify-center bg-dim-strong px-4">
        {/* The card swallows taps, so only the dim keeps editing. */}
        <Pressable
          accessible={false}
          onPress={() => {}}
          className="w-full max-w-[384px] gap-5 overflow-hidden rounded-3xl p-6"
          style={{ backgroundColor: c.popover, boxShadow: `inset 0 0 0 1px ${c.border}, ${scheme === "dark" ? "0 8px 24px rgba(0, 0, 0, 0.45)" : "0 8px 24px rgba(16, 21, 24, 0.14)"}` }}
        >
          <Gradient from={c["popover-top"]} to={c.popover} angle="y" />
          <View className="items-center gap-2 pt-4">
            <Text accessibilityRole="header" className="text-center text-[15px] font-bold uppercase leading-5 tracking-[0.1em]">
              Dismiss journal?
            </Text>
            <Text className="text-center text-[15px] leading-[22px] text-foreground-secondary">Choosing “Yes” discards what you’ve entered. You can come back and complete this journal later.</Text>
          </View>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setChecked(!checked)} className="min-h-11 flex-row items-center gap-3">
            <View className={cn("size-7 items-center justify-center rounded-md border", checked ? "border-primary bg-primary" : "border-input")}>{checked && <Check size={14} color={c["primary-foreground"]} strokeWidth={2.5} />}</View>
            <Text className="shrink text-xs font-bold uppercase leading-4 tracking-[0.1em]">Don’t show me this message again</Text>
          </Pressable>
          <View className="gap-3">
            <Button size="sheet" onPress={onKeep}>
              No, complete journal
            </Button>
            <Button
              size="sheet"
              variant="outline-pill"
              onPress={() => {
                if (checked) quiet = true;
                onDismiss();
              }}
            >
              Yes, dismiss journal
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
