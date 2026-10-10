// Settings › Profile › Delete everything. The web's "Delete account" (a quiet red-outlined pill at the foot of Account, a
// dialog that asks for the password) without an account: the confirmation is asked twice instead of the password, then the
// database file is deleted and the app restarts into onboarding (src/actions/reset.ts).
import { useState } from "react";
import { Pressable, View } from "react-native";
import { deleteEverything } from "@/actions/reset";
import { haptic } from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { forgetCoachKey, forgetGoogleTokens } from "./connect";
import { ConfirmDialog } from "./controls";

export function DeleteEverything() {
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
    const r = await deleteEverything(async () => {
      await forgetGoogleTokens();
      await forgetCoachKey();
    });
    // On success the app restarts; only a failure comes back.
    setPending(false);
    if (!r.ok) setError(r.error);
  };
  return (
    <>
      <View className="items-center pb-2 pt-6">
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            haptic.tap();
            setStep(1);
          }}
          // Outlined in red: easy to find, clearly destructive, still quieter than the everyday buttons above.
          className="h-11 items-center justify-center rounded-full border border-recovery-red/45 px-5 active:bg-recovery-red/10"
        >
          <Text className="text-[13px] font-bold uppercase tracking-[0.06em] text-recovery-red-text">Delete everything</Text>
        </Pressable>
      </View>
      <ConfirmDialog
        open={step === 1}
        title="Delete everything?"
        description="Removes everything Pulse stored on this phone: synced data, scores, journal, profile, coach chats and the Google connection. Export what you want to keep first (More › Your data)."
        confirmLabel="Delete everything"
        pendingLabel="Delete everything"
        pending={false}
        onCancel={close}
        onConfirm={() => setStep(2)}
      />
      <ConfirmDialog
        open={step === 2}
        title="Delete everything for good?"
        description="This can’t be undone: your data is only on this phone, so nothing can bring it back. Pulse restarts and asks for your profile again."
        error={error}
        confirmLabel="Yes, delete it all"
        pendingLabel="Deleting…"
        pending={pending}
        onCancel={close}
        onConfirm={run}
      />
    </>
  );
}
