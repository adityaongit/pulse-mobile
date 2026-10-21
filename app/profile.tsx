import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { ProfileForm, SaveButton } from "@/screens/onboarding/ProfileForm";
import { toast } from "@/ui/Toast";
import { useScreen } from "@/screens/useScreen";
import { TaskPage } from "@/ui/shells/TaskPage";
import { goBack } from "@/ui/navigate";

// Settings › Profile › Edit (U19): the onboarding fields in a sheet, at the sheet's smaller sizes. Saving recomputes every
// day's scores. Registered in app/_layout.tsx. Ported from pulse (app)/settings/SettingsClient.tsx `EditProfileButton`.
// The fields scroll in the sheet's body and Save is pinned under them, as in the log sheets, so it stays in reach however
// long the form grows. The web wraps the form in its own `px-4`: 32 px of side margin, for the fields and Save alike.
export default function EditProfile() {
  const { t } = useTranslation("ui");
  const TITLE = t("app.profileTitle");
  const DESCRIPTION = t("app.profileDescription");
  const { data } = useScreen(async (ctx) => ctx.profile, ["profile"]);
  if (!data) return <TaskPage title={TITLE} description={DESCRIPTION}>{null}</TaskPage>;
  return (
    <ProfileForm
      defaults={{ birthDate: data.birthDate, sex: data.sex, maxHr: data.maxHr, heightCm: data.heightCm, timeZone: data.timeZone, name: data.name }}
      onSaved={() => {
        goBack();
        toast.success(t("app.profileSaved"));
      }}
      footer={({ pending, submit }) => <SaveButton pending={pending} label={t("app.profileSave")} onPress={submit} />}
      sheet={(fields, footer) => (
        <TaskPage title={TITLE} description={DESCRIPTION} footer={<View className="px-4">{footer}</View>}>
          <View className="px-4">{fields}</View>
        </TaskPage>
      )}
    />
  );
}
