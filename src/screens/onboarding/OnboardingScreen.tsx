// First run `/onboarding` (U19). Ported from pulse src/app/onboarding/Onboarding.tsx and the AuthShell frame: no tab bar,
// the wordmark at the top, one 400 px column. Only what Google can't tell us: its Health profile has an age in whole years
// but no birth date and no sex; height and weight come from Google data later, max HR is estimated, and the time zone is
// the device's, one tap to change.
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ground } from "@/ui/Ground";
import { haptic } from "@/ui/haptics";
import { Wordmark } from "@/ui/brand";
import { Text } from "@/ui/Text";
import { profileSaved } from "./gate";
import { ProfileForm, SaveButton } from "./ProfileForm";

export function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background">
      <Ground />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        <View className="items-center pb-2" style={{ paddingTop: Math.max(insets.top, 32) }}>
          <Wordmark height={16} />
        </View>
        <View className="mx-auto w-full max-w-[400px] flex-1 px-5 pt-6">
          <Text accessibilityRole="header" className="text-[28px] font-bold leading-[34px] tracking-[-0.02em]">
            Two things Google doesn’t share
          </Text>
          <Text className="mb-7 mt-2 text-base leading-6 text-foreground-secondary">Pulse scores your heart rate against your age and sex. You can change these later in Settings.</Text>
          <ProfileForm
            onboarding
            defaults={{ birthDate: "", sex: null, maxHr: null, heightCm: null, timeZone: null }}
            // The gate opens: the root layout swaps onboarding for the tabs, so Home is next (app/_layout.tsx).
            onSaved={() => {
              haptic.success();
              profileSaved();
            }}
            footer={({ pending, submit }) => (
              <View className="mt-2" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
                <SaveButton pending={pending} label="Save and continue" onPress={submit} />
              </View>
            )}
          />
        </View>
      </ScrollView>
    </View>
  );
}
