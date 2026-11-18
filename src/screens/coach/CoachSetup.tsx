// Coach setup (spec §7.21 Setup), ported from pulse src/app/(app)/coach/CoachSetup.tsx via halo: "Before you start"
// with Allow, then "Connect your AI provider": provider pills, the API key, the model (pre-filled), and Test and save,
// which stores the key only after one tiny request with it worked.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { PROVIDERS, providerOf } from "@/coach/providers";
import { testDeviceKey } from "@/coach/session";
import { apiKey, saveProvider, setConsent, type CoachSetup } from "@/coach/storage";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { BODY, Field, HINT, TextField } from "@/screens/settings/controls";

const HEADING = "text-[22px] font-bold leading-7 text-foreground";
const ERROR = "text-[13px] leading-[18px] text-recovery-red-text";

const BULLETS = ["consentSend", "consentTerms", "consentLocal", "consentAccuracy"] as const;

export function Consent() {
  const { t } = useTranslation("coach");
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="gap-4">
      <Text accessibilityRole="header" className={HEADING}>
        {t("setup.consentTitle")}
      </Text>
      <View className="gap-3">
        {BULLETS.map((b) => (
          <View key={b} className="flex-row">
            <Text className="w-5 text-[15px] leading-[22px] text-coach-text">•</Text>
            <Text className="flex-1 text-[15px] leading-[22px] text-foreground">{t(`setup.${b}`)}</Text>
          </View>
        ))}
      </View>
      {!!error && <Text className={ERROR}>{error}</Text>}
      <Button onPress={() => void setConsent(true).catch(() => setError(t("setup.consentFailed")))}>{t("setup.allow")}</Button>
    </View>
  );
}

/** Provider, key and model; `onSaved` runs after the key is stored (settings closes its form). */
export function ConnectProvider({ current, onSaved }: { current: CoachSetup; onSaved?: () => void }) {
  const { t } = useTranslation("coach");
  const [provider, setProvider] = useState(providerOf(current.provider)?.id ?? PROVIDERS[0].id);
  const p = providerOf(provider)!;
  const savedLast4 = current.profiles?.[provider]?.last4 ?? (current.provider === provider ? current.last4 : null);
  const [model, setModel] = useState(current.provider === provider && current.model ? current.model : p.model);
  const [key, setKey] = useState("");
  const [server, setServer] = useState(current.baseUrl ?? "");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (id: string) => {
    const profile = current.profiles?.[id];
    setProvider(id as typeof provider);
    setModel(profile?.model ?? (id === current.provider ? current.model : null) ?? providerOf(id)!.model);
    setServer(profile?.baseUrl ?? (id === current.provider ? current.baseUrl : null) ?? "");
    setKey("");
    setError(null);
  };
  const save = async () => {
    setTesting(true);
    setError(null);
    const savedKey = key.trim() || await apiKey(provider) || "";
    const r = await testDeviceKey({ provider, model, apiKey: savedKey, baseUrl: server });
    if (!r.ok) {
      setTesting(false);
      return setError(r.error);
    }
    try {
      await saveProvider(r);
      setKey("");
      onSaved?.();
    } catch {
      setError(t("setup.keySaveFailed"));
    }
    setTesting(false);
  };

  return (
    <View className="gap-5">
      <View className="gap-2">
        <Text accessibilityRole="header" className={HEADING}>
          {t("setup.connectTitle")}
        </Text>
        <Text className={BODY}>{t("setup.connectBody")}</Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("setup.providerLabel")} className="flex-row flex-wrap gap-2">
        {PROVIDERS.map((x) => {
          const on = x.id === provider;
          return (
            <Press
              key={x.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => pick(x.id)}
              className={cn("h-10 justify-center rounded-full border px-4", on ? "border-coach/60 bg-secondary" : "border-border")}
            >
              <Text className={cn("text-[14px] font-semibold", on ? "text-foreground" : "text-foreground-secondary")}>{x.label}</Text>
            </Press>
          );
        })}
      </View>
      {p.local && <Text className={BODY}>{t("setup.nanoBody")}</Text>}
      {p.custom && (
        <Field label={t("setup.serverLabel")} hint={t("setup.serverHint")}>
          <TextField accessibilityLabel={t("setup.serverLabel")} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} spellCheck={false} keyboardType="url" maxLength={300} placeholder="http://192.168.1.20:11434/v1" />
        </Field>
      )}
      {!p.local && <Field label={t("setup.keyLabel")} hint={p.custom ? t("setup.keyHintOptional") : t("setup.keyHint")} optional={p.custom}>
        <TextField accessibilityLabel={t("setup.keyLabel")} value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={500} placeholder={savedLast4 ? `••••${savedLast4}` : t("setup.keyPlaceholder")} />
      </Field>}
      {!!p.keyUrl && (
        <Text accessibilityRole="link" onPress={() => void Linking.openURL(p.keyUrl!).catch(() => {})} className="-mt-3 text-[13px] font-semibold text-coach-text">
          {t("setup.getKey", { provider: p.label })}
        </Text>
      )}
      {!p.local && <Field label={t("setup.modelLabel")} hint={t("setup.modelHint")}>
        <TextField accessibilityLabel={t("setup.modelLabel")} value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={120} />
      </Field>}
      {!!error && (
        <Text accessibilityRole="alert" className={ERROR}>
          {error}
        </Text>
      )}
      <Button disabled={testing || (!p.local && (p.custom ? !server.trim() : !key.trim() && !current.profiles?.[provider]?.last4 && !(current.provider === provider && current.last4)))} onPress={() => void save()}>
        {testing ? t("setup.testing") : p.local ? t("setup.prepareNano") : t("setup.testAndSave")}
      </Button>
      <Text className={HINT}>{p.local ? t("setup.nanoOffline") : p.custom ? t("setup.checkServer") : t("setup.checkKey")}</Text>
    </View>
  );
}
