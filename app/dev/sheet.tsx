import { useState } from "react";
import { TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Button } from "@/ui/Button";
import { SheetScreen, SheetSection } from "@/ui/shells/SheetScreen";
import { closeSheet, type SheetSize } from "@/ui/shells/sheets";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";

const BODY = "text-[15px] leading-[22px] text-foreground-secondary";

/**
 * The kit's sheet demo: /dev/sheet?size=default | tall | screen (and an optional title), one route for the three sizes (app/_layout.tsx reads
 * `size` for the detents). Has a text field to check that the keyboard does not cover it, and Save for the success
 * haptic and the confirmation.
 */
export default function SheetDemo() {
  const { size = "default", title = "How Recovery works" } = useLocalSearchParams<{ size?: SheetSize; title?: string }>();
  const { c } = useTheme();
  const [saved, setSaved] = useState(false);
  return (
    <SheetScreen
      title={title}
      description="Updated each morning"
      size={size}
      glow={size === "screen"}
      done={saved ? { title: "Saved", body: "Have a great day!", onDone: closeSheet } : null}
      footer={
        <>
          <Button size="sheet" onPress={() => setSaved(true)}>Save</Button>
          <Button size="sheet" variant="outline-pill" onPress={closeSheet}>Cancel</Button>
        </>
      }
    >
      <View className="gap-4">
        <SheetSection>Why</SheetSection>
        <Text className={BODY}>Recovery shows how ready your body is to take on strain, from 0 to 100%. Pulse scores it each morning from last night&apos;s heart rate variability, resting heart rate, respiratory rate, sleep performance and skin temperature, each compared with your own baseline.</Text>
        <Text className={BODY}>Recovery needs 7 nights of HRV before the first score and stays provisional until 14.</Text>
        <SheetSection>Note</SheetSection>
        <TextInput
          accessibilityLabel="Note"
          placeholder="Type here to try the keyboard"
          placeholderTextColor={c["muted-foreground"]}
          multiline
          className="min-h-24 rounded-xl bg-secondary px-4 py-3 text-[15px] leading-[22px] text-foreground"
          textAlignVertical="top"
        />
      </View>
    </SheetScreen>
  );
}
