// Settings › Profile › Delete everything. The web's "Delete account" (a quiet red-outlined pill at the foot of Account, a
// dialog that asks for the password) without an account: the confirmation is entered twice in place of the password, then
// every row and setting is deleted and the app goes back to onboarding (src/state/app.ts reset).
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { View } from "react-native";
import { reset } from "@/state/app";
import { haptic } from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { ConfirmDialog } from "./controls";
import { Press } from "@/ui/Press";

export function DeleteEverything() {
  const { t } = useTranslation("settings");
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (pending) return;
    setStep(0);
    setError(null);
  };
  const run = async () => {
    setPending(true);
    setError(null);
    try {
      // On success the gate closes and onboarding shows; only a failure comes back here.
      await reset();
    } catch {
      setError(t("delete.failed"));
    }
    setPending(false);
  };
  return (
    <>
      <View className="items-center pb-2 pt-6">
        <Press
          activeBg="bg-recovery-red/10"
          accessibilityRole="button"
          onPress={() => {
            haptic.tap();
            setStep(1);
          }}
          // Outlined in red: easy to find, clearly destructive, still quieter than the everyday buttons above.
          className="h-11 items-center justify-center rounded-full border border-recovery-red/45 px-5"
        >
          <Text className="text-[13px] font-bold uppercase tracking-[0.06em] text-recovery-red-text">{t("delete.button")}</Text>
        </Press>
      </View>
      <ConfirmDialog
        open={step === 1}
        title={t("delete.title")}
        description={t("delete.description")}
        confirmLabel={t("delete.button")}
        pendingLabel={t("delete.button")}
        pending={false}
        onCancel={close}
        onConfirm={() => setStep(2)}
      />
      <ConfirmDialog
        open={step === 2}
        title={t("delete.titleFinal")}
        description={t("delete.descriptionFinal")}
        error={error}
        confirmLabel={t("delete.confirmFinal")}
        pendingLabel={t("delete.deleting")}
        pending={pending}
        onCancel={close}
        onConfirm={run}
      />
    </>
  );
}
