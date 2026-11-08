// Coach settings `/coach/settings` (spec §7.21 Settings › Coach), ported from pulse src/app/(app)/coach/CoachSettings.tsx
// via halo: Provider, Model and the key as ••••last4; Change, Remove key, Delete chats, Turn off; and About you, up to
// 500 characters of the person's own notes for the coach. Without consent or a provider, the setup steps instead.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { i18n } from "@/i18n/config";
import { MAX_NOTES } from "@/coach/instructions";
import { providerLabel, providerOf } from "@/coach/providers";
import { useCoachSetup } from "@/coach/session";
import { deleteAllChats, removeProvider, setAutoAnalysis, setConsent, setInstructions } from "@/coach/storage";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { DetailShell } from "@/ui/shells/DetailShell";
import { GROUP_LABEL } from "@/ui/shells/LinkList";
import { ConfirmDialog, Field, HINT, ROW, ROW_LABEL, ROW_RULE, ROW_VALUE, SmallButton, SwitchRow, TextField } from "@/screens/settings/controls";
import { cn } from "@/ui/cn";
import { ConnectProvider, Consent } from "./CoachSetup";

const failed = () => toast.error(i18n.t("coach:settings.saveFailed"));

function Row({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View className={cn(ROW, "px-4", !first && ROW_RULE)}>
      <Text className={ROW_LABEL}>{label}</Text>
      <Text className={ROW_VALUE}>{value}</Text>
    </View>
  );
}

function Notes({ saved }: { saved: string | null }) {
  const { t } = useTranslation("coach");
  const [text, setText] = useState(saved ?? "");
  return (
    <Field label={t("settings.aboutYou")} hint={t("settings.aboutHint")} optional>
      <TextField
        accessibilityLabel={t("settings.aboutYou")}
        value={text}
        onChangeText={setText}
        onBlur={() => text.trim() !== (saved ?? "") && void setInstructions(text).catch(failed)}
        multiline
        maxLength={MAX_NOTES}
        placeholder={t("settings.aboutPlaceholder")}
      />
    </Field>
  );
}

type Confirm = "key" | "chats" | "off" | null;

export function CoachSettings() {
  const { t } = useTranslation("coach");
  const setup = useCoachSetup();
  const [changing, setChanging] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, setPending] = useState(false);

  // The person's own server: its address shows, and it may have no key to remove.
  const custom = providerOf(setup?.provider)?.custom;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setPending(true);
    try {
      await fn();
      toast.success(done);
    } catch {
      failed();
    }
    setPending(false);
    setConfirm(null);
  };
  const DIALOG = {
    key: custom
      ? { title: t("settings.disconnectTitle"), description: t("settings.disconnectBody"), label: t("settings.disconnect"), go: () => run(removeProvider, t("settings.disconnected")) }
      : { title: t("settings.removeKeyTitle"), description: t("settings.removeKeyBody"), label: t("settings.removeKey"), go: () => run(removeProvider, t("settings.keyRemoved")) },
    chats: { title: t("settings.deleteChatsTitle"), description: t("settings.deleteChatsBody"), label: t("settings.deleteChats"), go: () => run(deleteAllChats, t("settings.chatsDeleted")) },
    off: { title: t("settings.turnOffTitle"), description: t("settings.turnOffBody"), label: t("settings.turnOff"), go: () => run(async () => (await removeProvider(), await setConsent(false)), t("settings.turnedOff")) },
  } as const;

  const body =
    setup === undefined ? null : !setup.consent ? (
      <Consent />
    ) : !setup.provider || changing ? (
      <View className="gap-4">
        <ConnectProvider current={setup} onSaved={() => setChanging(false)} />
        {changing && <SmallButton label={t("settings.cancel")} onPress={() => setChanging(false)} />}
      </View>
    ) : (
      <View className="gap-6">
        <View className="gap-2">
          <Text className={GROUP_LABEL}>{t("settings.provider")}</Text>
          <Card>
            <Row first label={t("settings.provider")} value={providerLabel(setup.provider)} />
            <Row label={t("settings.model")} value={setup.model ?? ""} />
            {!!custom && <Row label={t("settings.server")} value={setup.baseUrl ?? ""} />}
            <Row label={t("settings.apiKey")} value={setup.last4 ? `••••${setup.last4}` : custom ? t("settings.none") : t("settings.notSaved")} />
          </Card>
          <View className="flex-row flex-wrap gap-2">
            <SmallButton label={t("settings.change")} onPress={() => setChanging(true)} />
            <SmallButton label={custom ? t("settings.disconnect") : t("settings.removeKey")} onPress={() => setConfirm("key")} />
          </View>
        </View>
        <Notes key={setup.instructions ?? ""} saved={setup.instructions} />
        <View className="gap-2">
          <Text className={GROUP_LABEL}>{t("settings.activities")}</Text>
          <SwitchRow rule={false} label={t("settings.analyze")} hint={t("settings.analyzeHint")} value={setup.autoAnalysis} onChange={(on) => void setAutoAnalysis(on).catch(failed)} />
        </View>
        <View className="gap-2">
          <Text className={GROUP_LABEL}>{t("settings.chats")}</Text>
          <Text className={HINT}>{t("settings.chatsHint")}</Text>
          <View className="flex-row flex-wrap gap-2">
            <SmallButton label={t("settings.deleteChats")} onPress={() => setConfirm("chats")} />
            <SmallButton label={t("settings.turnOff")} onPress={() => setConfirm("off")} />
          </View>
        </View>
      </View>
    );

  const d = confirm && DIALOG[confirm];
  return (
    <DetailShell
      title={t("settingsTitle")}
      backHref="/more"
      loading={setup === undefined}
      primary={
        <View>
          {body}
          <ConfirmDialog open={!!d} title={d?.title ?? ""} description={d?.description ?? ""} confirmLabel={d?.label ?? ""} pendingLabel={t("settings.saving")} pending={pending} onCancel={() => setConfirm(null)} onConfirm={() => void d?.go()} />
        </View>
      }
    />
  );
}
