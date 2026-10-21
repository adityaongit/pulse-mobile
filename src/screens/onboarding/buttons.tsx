// Onboarding's two buttons. Connect is an outline pill in the shape of Google's sign-in button (sentence case, a thin
// rim) with Health Connect's official icon, so the step reads as Health Connect's. Its rim and label are theme
// tokens (the kit's outline button), so it reads on the light and the dark ground. The second action is a quiet text button. Both hug their label at
// 44 px tall, smaller than the app's sheet buttons: this screen asks, it does not push.
import { useTranslation } from "react-i18next";
import { ActivityIndicator, View } from "react-native";
import { haptic } from "@/ui/haptics";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { HealthConnectMark } from "@/ui/HealthConnectMark";

/** "Connect Health Connect": an outline pill with the Google Health mark (Fitbit data reaches Health Connect through the Google Health app), label in the foreground token. */
export function ConnectButton({ label, pending, onPress }: { label?: string; pending?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const { t } = useTranslation("onboarding");
  return (
    <Press
      accessibilityRole="button"
      accessibilityState={{ disabled: !!pending, busy: !!pending }}
      disabled={pending}
      activeScale={0.96}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      className="h-11 flex-row items-center justify-center gap-2.5 self-center rounded-full border border-border bg-background pl-4 pr-5 dark:border-input dark:bg-input/30"
    >
      {pending ? <ActivityIndicator size="small" color={c.foreground} /> : <HealthConnectMark size={20} />}
      <Text className="text-[14px] font-semibold leading-5 text-foreground">{label ?? t("connect.button")}</Text>
    </Press>
  );
}

/** The second action ("Explore with sample data", "Not now"): text only, a 44 px tall target. */
export function TextButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <View className="items-center">
      <Press accessibilityRole="button" disabled={disabled} activeOpacity={0.6} onPress={onPress} className="h-11 justify-center px-4">
        <Text className="text-[14px] font-semibold leading-5 text-foreground-secondary">{label}</Text>
      </Press>
    </View>
  );
}
