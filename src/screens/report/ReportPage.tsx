// Report a problem (docs/telemetry.md § Shake to report): opened by a shake or from Settings › App › Privacy. The
// person writes what went wrong; Send passes their words and the screen's route to Sentry as feedback (sendFeedback).
// No screenshot: the screens show health data.
import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { sendFeedback, telemetryEnabled } from "@/lib/telemetry";
import { Button } from "@/ui/Button";
import { goBack } from "@/ui/navigate";
import { TaskPage } from "@/ui/shells/TaskPage";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { TextField } from "@/screens/settings/controls";

const MAX = 2000;

export function ReportPage() {
  const { t } = useTranslation("settings");
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const send = async () => {
    setSending(true);
    const ok = await sendFeedback(text, from || "settings");
    setSending(false);
    if (ok) setSent(true);
    else toast.error(t((await telemetryEnabled()) ? "report.failed" : "report.off"));
  };
  return (
    <TaskPage
      title={t("report.title")}
      done={sent ? { title: t("report.sentTitle"), body: t("report.sentBody"), onDone: goBack } : null}
      footer={
        <Button disabled={sending || !text.trim()} onPress={() => void send()}>
          {sending ? t("report.sending") : t("report.send")}
        </Button>
      }
    >
      <View className="gap-3">
        <TextField accessibilityLabel={t("report.title")} value={text} onChangeText={setText} multiline maxLength={MAX} autoFocus placeholder={t("report.placeholder")} />
        <Text className="text-[13px] leading-5 text-muted-foreground">{t("report.description")}</Text>
      </View>
    </TaskPage>
  );
}
