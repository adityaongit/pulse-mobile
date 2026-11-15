// Settings › LeetCode: connect a public profile by username (validated against LeetCode first, so a typo is never
// saved), then Sync now or Disconnect. The card is the manage surface; the full data screen is /leetcode.
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Code2, ExternalLink, RefreshCw } from "lucide-react-native";
import { ago } from "@/lib/format";
import { leetcodeErrorCopy } from "@/leetcode/copy";
import { connectLeetCode, disconnectLeetCode, refreshLeetCode, useLeetCode } from "@/state/leetcode";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { push } from "@/ui/navigate";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { haptic } from "@/ui/haptics";
import { BODY, ConfirmDialog, Field, TextField } from "./controls";
import { attempt } from "@/lib/attempt";

export function LeetCodeSection() {
  const { t } = useTranslation("leetcode");
  const state = useLeetCode();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [now] = useState(() => Date.now());

  const connected = !!state.username;
  const input = draft ?? state.username ?? "";
  const setInput = (v: string) => {
    setDraft(v);
    setError(null);
  };
  const save = async () => {
    if (busy) return;
    const name = input.trim();
    if (!name) {
      setError(t("error.invalidUsername"));
      return;
    }
    haptic.tap();
    setBusy(true);
    setError(null);
    await attempt(async () => {
      const result = await connectLeetCode(name);
      if (result.ok) {
        setDraft(result.snapshot.username);
        toast.success(t("settings.connected"));
      } else {
        setError(leetcodeErrorCopy(result.error));
      }
    }, { catch: () => {
      setError(leetcodeErrorCopy("offline"));
    }, finally: () => {
      setBusy(false);
    } });
  };

  const sync = async () => {
    haptic.tap();
    setBusy(true);
    await attempt(async () => {
      const result = await refreshLeetCode(true);
      if (!result) return;
      if (result.ok) toast.success(t("settings.synced"));
      else toast.error(t("settings.syncFailed", { error: leetcodeErrorCopy(result.error) }));
    }, { catch: () => {
      toast.error(t("settings.syncFailed", { error: leetcodeErrorCopy("offline") }));
    }, finally: () => {
      setBusy(false);
    } });
  };

  const disconnect = async () => {
    setBusy(true);
    await attempt(async () => {
      await disconnectLeetCode();
      setConfirm(false);
      setDraft("");
      setError(null);
      toast.success(t("settings.disconnected"));
    }, { catch: () => {
      toast.error(t("settings.disconnectFailed"));
    } });
    setBusy(false);
  };

  const last = state.snapshot?.fetchedAt;
  return (
    <SectionShell variant="card" title={t("settings.title")}>
      <View className="min-h-11 flex-row items-center gap-3">
        <View accessibilityElementsHidden className="size-11 shrink-0 items-center justify-center rounded-xl bg-fill-faint">
          <Icon icon={Code2} size={24} tone="foreground" strokeWidth={1.5} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold leading-[22px]">{!state.ready ? t("settings.loading") : connected ? state.username : t("settings.notConnected")}</Text>
          <Text numberOfLines={1} className="text-[13px] leading-[18px] tabular-nums text-muted-foreground">
            {connected ? (last ? t("settings.lastSync", { ago: ago(last * 1000, Math.max(now, last * 1000)) }) : t("settings.neverSynced")) : t("settings.notConnectedBody")}
          </Text>
        </View>
      </View>
      {!connected && <Text className={`${BODY} mt-3`}>{t("settings.description")}</Text>}
      {connected && !!state.error && !busy && (
        <Text accessibilityRole="alert" className="mt-3 text-[13px] font-medium leading-[18px] text-recovery-red-text">
          {t("settings.syncFailed", { error: leetcodeErrorCopy(state.error) })}
        </Text>
      )}
      <View className="mt-4 gap-2">
        <Field label={t("settings.username")} hint={t("settings.usernameHint")} error={error ?? undefined}>
          <TextField
            value={input}
            onChangeText={(v) => {
              setInput(v);
            }}
            placeholder={t("settings.usernamePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            maxLength={30}
            returnKeyType="done"
            invalid={!!error}
            onSubmitEditing={() => void save()}
          />
        </Field>
        <View className="flex-row gap-2">
          <Button className="flex-1" disabled={busy || !state.ready} onPress={() => void save()}>
            {busy ? t("settings.saving") : connected ? t("settings.save") : t("settings.connect")}
          </Button>
          {connected && (
            <Button variant="secondary" className="flex-1" disabled={busy} onPress={() => void sync()}>
              <Icon icon={RefreshCw} size={16} tone="secondary-foreground" strokeWidth={2} />
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">{t("settings.syncNow")}</Text>
            </Button>
          )}
        </View>
        {connected && (
          <>
            <Text className={`${BODY} mt-2`}>{t("settings.privacy")}</Text>
            <View className="flex-row gap-2">
              <Button variant="secondary" className="flex-1" onPress={() => push("/leetcode")}>
                <Icon icon={ExternalLink} size={16} tone="secondary-foreground" strokeWidth={2} />
                <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">{t("settings.open")}</Text>
              </Button>
              <Button variant="outline" className="flex-1" textClassName="text-recovery-red-text" disabled={busy} onPress={() => setConfirm(true)}>
                {t("settings.disconnect")}
              </Button>
            </View>
          </>
        )}
      </View>
      <ConfirmDialog
        open={confirm}
        title={t("settings.disconnectTitle")}
        description={t("settings.disconnectBody")}
        confirmLabel={t("settings.disconnect")}
        pendingLabel={t("settings.disconnect")}
        pending={busy}
        onCancel={() => !busy && setConfirm(false)}
        onConfirm={() => void disconnect()}
      />
    </SectionShell>
  );
}
