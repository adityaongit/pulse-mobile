import { useTranslation } from "react-i18next";
// Every screen's error boundary (app/_layout.tsx `unstable_settings.screenErrorBoundary`): a screen that throws while it
// draws shows this in its place, with the tabs and the rest of the stack still mounted, instead of closing the app. Kept
// to plain views and the kit's Button and Text, so the fallback cannot fail the way the screen did.
import { useEffect } from "react";
import { View } from "react-native";
import { router, type ErrorBoundaryProps } from "expo-router";
import { CircleAlert } from "lucide-react-native";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";

export function ScreenError({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation(["errors", "common"]);
  // The message and the stack name the code that failed; they never carry health records.
  useEffect(() => console.error("Screen error:", error.message, error.stack), [error]);
  return (
    <View accessibilityRole="alert" className="flex-1 items-center justify-center gap-3 bg-background px-8">
      <Icon icon={CircleAlert} size={28} tone="muted-foreground" />
      <Text className="text-center text-[17px] font-semibold leading-6 text-foreground">{t("screen.title")}</Text>
      <Text className="max-w-72 text-center text-[15px] leading-[22px] text-foreground-secondary">{t("screen.body")}</Text>
      <View className="mt-2 flex-row gap-3">
        <Button variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>
          {t("actions.back", { ns: "common" })}
        </Button>
        <Button onPress={() => void retry()}>{t("actions.tryAgain", { ns: "common" })}</Button>
      </View>
    </View>
  );
}
