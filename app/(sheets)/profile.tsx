import { View } from "react-native";
import { ProfileForm, SaveButton } from "@/screens/onboarding/ProfileForm";
import { toast } from "@/ui/Toast";
import { useScreen } from "@/screens/useScreen";
import { SheetScreen } from "@/ui/shells/SheetScreen";
import { closeSheet } from "@/ui/shells/sheets";

// Settings › Profile › Edit (U19): the onboarding fields in a sheet. Saving recomputes every day's scores. Registered in
// app/_layout.tsx. Ported from pulse (app)/settings/SettingsClient.tsx `EditProfileButton`.
export default function EditProfile() {
  const { data } = useScreen(async (ctx) => ctx.profile, []);
  return (
    <SheetScreen title="Profile" description="Changing it recomputes every day’s scores." size="tall">
      <View className="pb-4">
        {data && (
          <ProfileForm
            defaults={{ birthDate: data.birthDate, sex: data.sex, maxHr: data.maxHrSource === "set" ? data.maxHr : null, heightCm: data.heightCm, timeZone: data.timeZone }}
            onSaved={() => {
              closeSheet();
              toast.success("Profile saved. Scores are being recomputed.");
            }}
            footer={({ pending, submit }) => <SaveButton pending={pending} label="Save profile" onPress={submit} />}
          />
        )}
      </View>
    </SheetScreen>
  );
}
