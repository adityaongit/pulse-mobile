import { i18n } from "@/i18n/config";
import { push } from "@/ui/navigate";
// First run `/onboarding` (docs/onboarding.md). Welcome (connect Health Connect or explore with sample data), then the
// profile, then the explainer before Health Connect's permission sheet, then the first import with its progress. The
// profile step is pulse's src/app/onboarding/Onboarding.tsx on the AuthShell frame: birth date, sex and the time zone
// (the device's, one tap to change); height and max HR wait for Settings. Where to start comes from the app state
// (src/state/app.ts): a saved profile without a source opens on the connect step, an import in flight on its progress.
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { isBatteryOptimizationEnabledAsync } from "expo-battery";
import { File } from "expo-file-system";
import { Code2, Dumbbell, FileUp, Lock } from "lucide-react-native";
import { writeSettings } from "@/background/settings";
import { syncRegistration } from "@/background/task";
import { importStrong, previewStrong, type ImportPreview } from "@/actions/gym";
import { leetcodeErrorCopy } from "@/leetcode/copy";
import { actionCtx, appStore, dataChanged, exploreSample, refresh, stepLabel, useApp, type Progress } from "@/state/app";
import { connectLeetCode, initLeetCode, useLeetCode } from "@/state/leetcode";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { ProgressBar } from "@/ui/ProgressBar";
import { Text } from "@/ui/Text";
import { ConnectFlow } from "./Connect";
import { Frame } from "./Frame";
import { ConnectButton, TextButton } from "./buttons";
import { HeartbeatMark } from "./HeartbeatMark";
import { ProfileForm, SaveButton } from "./ProfileForm";
import { Field, TextField } from "../settings/controls";
import { attempt } from "@/lib/attempt";

type Step = "welcome" | "profile" | "extras" | "connect";

export function OnboardingScreen() {
  const hasProfile = useApp((s) => s.profile !== null);
  const source = useApp((s) => s.source);
  const status = useApp((s) => s.status);
  // A profile and no source: carry on at the connect step. A source and no profile (the sample was left before a
  // profile was ever saved): the profile step, and the import starts once it is saved.
  const [step, setStep] = useState<Step>(() => (hasProfile ? "connect" : source === "health_connect" ? "profile" : "welcome"));
  // A first profile is followed by the optional LeetCode and Strong steps; a returning profile goes straight to connect.
  // The first import (or the sample's build) runs: its progress, or its failure with a way to try again.
  if (hasProfile && source && (status === "syncing" || status === "error")) return <Importing sample={source === "demo"} />;
  if (step === "welcome") return <Welcome onConnect={() => setStep(hasProfile ? "extras" : "profile")} />;
  if (step === "profile") return <Profile onSaved={() => setStep("extras")} />;
  if (step === "extras") return <Extras onDone={() => setStep("connect")} />;
  return <ConnectFlow onCancel={() => setStep("welcome")} />;
}

/** One bar for the run: the step's share done. */
const fraction = (p: Progress | null) => (p && p.total > 0 ? Math.min(1, p.done / p.total) : 0);

function ProgressFooter({ progress, fallback }: { progress: Progress | null; fallback: string }) {
  const pct = Math.round(fraction(progress) * 100);
  return (
    <View accessibilityLiveRegion="polite" className="h-[132px] items-center justify-center gap-3 px-6">
      <ProgressBar value={pct} label={progress ? stepLabel(progress.step) : fallback} className="h-2 bg-fill-pressed" />
      <Text className="text-[13px] leading-[18px] text-foreground-secondary">{progress ? stepLabel(progress.step) : fallback}…</Text>
    </View>
  );
}

function Welcome({ onConnect }: { onConnect: () => void }) {
  const { t } = useTranslation("onboarding");
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useApp((s) => (building ? s.progress : null));

  const explore = async () => {
    setError(null);
    setBuilding(true);
    try {
      // The demo writes its own profile and runs the pipeline; the gate opens once the first run ends.
      await exploreSample();
      haptic.success();
    } catch (e) {
      setBuilding(false);
      setError(e instanceof Error ? e.message : t("welcome.sampleFailed"));
      haptic.error();
    }
  };

  return (
    <Frame
      wordmark={false}
      footer={
        building ? (
          <ProgressFooter progress={progress} fallback={t("progress.buildingSample")} />
        ) : (
          <>
            {!!error && (
              <Text accessibilityRole="alert" className="mb-2 text-center text-[13px] font-medium leading-[18px] text-recovery-red-text">
                {error}
              </Text>
            )}
            <ConnectButton onPress={onConnect} />
            <TextButton label={t("welcome.exploreSample")} onPress={explore} />
            <TextButton label={i18n.t("workouts:recorder.start")} onPress={() => push("/workout-live")} />
            <View className="mt-2 flex-row items-center justify-center gap-1.5">
              <Icon icon={Lock} size={13} tone="muted-foreground" strokeWidth={2} />
              <Text className="text-[13px] leading-[18px] text-muted-foreground">{t("welcome.private")}</Text>
            </View>
          </>
        )
      }
    >
      <View className="items-center gap-8">
        <HeartbeatMark />
        <View className="items-center gap-2">
          <Text accessibilityRole="header" className="text-center text-[24px] font-bold leading-[30px] tracking-[-0.02em]">
            {t("welcome.title")}
          </Text>
          <Text className="max-w-[300px] text-center text-[15px] leading-[22px] text-foreground-secondary">{t("welcome.subtitle")}</Text>
        </View>
      </View>
    </Frame>
  );
}

function Profile({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation("onboarding");
  return (
    <Frame>
      <Text accessibilityRole="header" className="text-[28px] font-bold leading-[34px] tracking-[-0.02em]">
        {t("profile.title")}
      </Text>
      <Text className="mb-7 mt-2 text-base leading-6 text-foreground-secondary">{t("profile.intro")}</Text>
      <ProfileForm
        onboarding
        defaults={{ birthDate: "", sex: null, maxHr: null, heightCm: null, timeZone: null }}
        // With a source already chosen (leaving the sample) the import starts now; otherwise Health Connect is next.
        onSaved={() => {
          haptic.success();
          onSaved();
        }}
        footer={({ pending, submit }) => (
          <View className="mt-4">
            <SaveButton pending={pending} label={t("profile.saveContinue")} onPress={submit} />
          </View>
        )}
      />
    </Frame>
  );
}

/**
 * Two optional sources between the profile and Health Connect: a public LeetCode profile and a Strong CSV export. Both
 * write to the same Store the rest of onboarding uses; neither blocks Continue. The Strong import reports its sessions
 * as it writes them, so the bar moves rather than a spinner.
 */
function Extras({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation(["onboarding", "leetcode", "gym"]);
  const lc = useLeetCode();
  const [draft, setDraft] = useState<string | null>(null);
  const [lcBusy, setLcBusy] = useState(false);
  const [lcError, setLcError] = useState<string | null>(null);
  const [strongText, setStrongText] = useState<string | null>(null);
  const [strongPreview, setStrongPreview] = useState<ImportPreview | null>(null);
  const [strongDone, setStrongDone] = useState<number | null>(null);
  const [strongBusy, setStrongBusy] = useState(false);
  const [strongProgress, setStrongProgress] = useState<{ done: number; total: number } | null>(null);
  const [strongError, setStrongError] = useState<string | null>(null);
  const name = draft ?? lc.username ?? "";

  // The LeetCode state is loaded at boot on an idle callback; opening this step earlier still needs its Store.
  useEffect(() => {
    void initLeetCode(appStore());
  }, []);

  const connect = async () => {
    if (lcBusy) return;
    const username = name.trim();
    if (!username) return setLcError(t("leetcode:error.invalidUsername"));
    setLcBusy(true);
    setLcError(null);
    await attempt(async () => {
      // A first run may reach this before the idle boot load set the module's Store.
      await initLeetCode(appStore());
      const result = await connectLeetCode(username);
      if (result.ok) {
        setDraft(result.snapshot.username);
        haptic.success();
      } else {
        setLcError(leetcodeErrorCopy(result.error));
      }
    }, { catch: () => {
      setLcError(leetcodeErrorCopy("offline"));
    }, finally: () => {
      setLcBusy(false);
    } });
  };

  const strongMessage = (code: string) =>
    code === "emptyFile" ? t("gym:import.errorEmpty") : code === "notStrong" ? t("gym:import.errorFormat") : t("gym:import.errorNothing");

  const pickStrong = async () => {
    if (strongBusy) return;
    setStrongError(null);
    setStrongBusy(true);
    await attempt(async () => {
      const picked = await File.pickFileAsync({ mimeTypes: ["text/csv", "text/plain", "application/vnd.ms-excel", "text/comma-separated-values", "*/*"] });
      if (picked.canceled) return;
      const content = await picked.result.text();
      const res = await previewStrong(actionCtx(), content);
      if (!res.ok) {
        setStrongError(strongMessage(res.error));
        return;
      }
      setStrongText(content);
      setStrongPreview(res.data);
      setStrongDone(null);
    }, { catch: () => {
      setStrongError(t("gym:import.error"));
    }, finally: () => {
      setStrongBusy(false);
    } });
  };

  const runStrong = async () => {
    if (!strongText || strongBusy) return;
    setStrongBusy(true);
    setStrongError(null);
    await attempt(async () => {
      const res = await importStrong(actionCtx(), strongText, setStrongProgress);
      if (!res.ok) {
        setStrongError(res.error === "nothingToImport" && strongPreview ? t("gym:import.nothing") : strongMessage(res.error));
        return;
      }
      setStrongDone(res.data.sessions);
      setStrongPreview(null);
      setStrongText(null);
      dataChanged("gym");
      haptic.success();
    }, { catch: () => {
      setStrongError(t("gym:import.error"));
    }, finally: () => {
      setStrongBusy(false);
      setStrongProgress(null);
    } });
  };

  const summary = strongPreview?.result.summary;
  const allImported = !!strongPreview && strongPreview.result.sessions.length > 0 && strongPreview.duplicates >= strongPreview.result.sessions.length;

  return (
    <Frame
      footer={
        <>
          <Button onPress={onDone} disabled={strongBusy}>
            {t("extras.continue")}
          </Button>
          <Text className="mt-2 text-center text-[13px] leading-[18px] text-muted-foreground">{t("extras.optional")}</Text>
        </>
      }
    >
      <Text accessibilityRole="header" className="text-[28px] font-bold leading-[34px] tracking-[-0.02em]">
        {t("extras.title")}
      </Text>
      <Text className="mb-6 mt-2 text-[15px] leading-[22px] text-foreground-secondary">{t("extras.body")}</Text>

      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <Icon icon={Code2} size={22} tone="foreground" strokeWidth={1.75} />
          <Text className="min-w-0 flex-1 text-[17px] font-semibold leading-[22px]">{t("leetcode:settings.title")}</Text>
        </View>
        <Text className="text-[13px] leading-[19px] text-foreground-secondary">{t("leetcode:settings.description")}</Text>
        {!!lc.username && <Text className="text-[13px] font-medium leading-[19px] text-optimal">{t("leetcode:settings.connectedAs", { username: lc.username })}</Text>}
        <Field label={t("leetcode:settings.username")} hint={t("leetcode:settings.usernameHint")} error={lcError ?? undefined}>
          <TextField
            value={name}
            onChangeText={(v) => {
              setDraft(v);
              setLcError(null);
            }}
            placeholder={t("leetcode:settings.usernamePlaceholder")}
            accessibilityLabel={t("leetcode:settings.username")}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={() => void connect()}
          />
        </Field>
        <Button variant={lc.username ? "secondary" : "default"} disabled={lcBusy} onPress={() => void connect()}>
          {lcBusy ? t("leetcode:settings.connecting") : lc.username ? t("leetcode:settings.save") : t("leetcode:settings.connect")}
        </Button>
      </Card>

      <Card className="mt-4 gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <Icon icon={Dumbbell} size={22} tone="foreground" strokeWidth={1.75} />
          <Text className="min-w-0 flex-1 text-[17px] font-semibold leading-[22px]">{t("gym:import.title")}</Text>
        </View>
        <Text className="text-[13px] leading-[19px] text-foreground-secondary">{t("gym:import.body")}</Text>

        {!!strongError && (
          <Text accessibilityRole="alert" className="text-[13px] font-medium leading-[18px] text-recovery-red-text">
            {strongError}
          </Text>
        )}

        {!!strongDone && <Text className="text-[13px] font-medium leading-[18px] text-optimal">{t("extras.strongDone", { count: strongDone })}</Text>}

        {!!strongProgress && (
          <View className="gap-2">
            <ProgressBar value={strongProgress.total > 0 ? (strongProgress.done / strongProgress.total) * 100 : 0} label={t("extras.strongImporting")} />
            <Text className="text-[12px] tabular-nums text-muted-foreground">
              {t("extras.strongImporting")} {strongProgress.done} / {strongProgress.total}
            </Text>
          </View>
        )}

        {!!summary && !strongDone && (
          <Text className="text-[13px] leading-[19px] text-muted-foreground">
            {t("gym:import.sessions", { count: summary.sessions })} · {t("gym:import.sets", { count: summary.sets })}
            {strongPreview && strongPreview.duplicates > 0 ? ` · ${t("gym:import.duplicates", { count: strongPreview.duplicates })}` : ""}
          </Text>
        )}
        {!!strongPreview && !!strongPreview.custom.length && <Text className="text-[13px] leading-[19px] text-muted-foreground">{t("gym:import.custom", { count: strongPreview.custom.length })}</Text>}

        {strongDone ? (
          <Button variant="secondary" disabled={strongBusy} onPress={() => void pickStrong()}>
            {t("gym:import.again")}
          </Button>
        ) : allImported ? (
          <Button variant="secondary" disabled={strongBusy} onPress={() => void pickStrong()}>
            {t("gym:import.allImported")}
          </Button>
        ) : strongPreview ? (
          <Button disabled={strongBusy} onPress={() => void runStrong()}>
            {t("gym:import.run")}
          </Button>
        ) : (
          <Button variant="secondary" disabled={strongBusy} onPress={() => void pickStrong()}>
            <View className="flex-row items-center gap-2">
              <Icon icon={FileUp} size={16} tone="foreground" />
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-foreground">{strongBusy ? t("gym:import.reading") : t("gym:import.pick")}</Text>
            </View>
          </Button>
        )}
      </Card>
    </Frame>
  );
}

/** The first import (or the sample's build), with its progress; the tabs open when it ends. */
function Importing({ sample }: { sample: boolean }) {
  const { t } = useTranslation("onboarding");
  const progress = useApp((s) => s.progress);
  const error = useApp((s) => (s.status === "error" ? s.error : null));
  return (
    <Frame
      footer={
        error ? (
          <>
            <Text accessibilityRole="alert" className="mb-2 text-center text-[13px] font-medium leading-[18px] text-recovery-red-text">
              {error}
            </Text>
            <ConnectButton label={t("actions.tryAgain", { ns: "common" })} onPress={() => void refresh()} />
          </>
        ) : (
          <ProgressFooter progress={progress} fallback={sample ? t("progress.buildingSample") : t("progress.importing")} />
        )
      }
    >
      <View className="items-center gap-2">
        <Text accessibilityRole="header" className="text-center text-[22px] font-semibold leading-7 tracking-[-0.01em]">
          {error ? t("importing.stopped") : sample ? t("importing.titleSample") : t("importing.title")}
        </Text>
        <Text className="max-w-[300px] text-center text-[15px] leading-[22px] text-foreground-secondary">
          {sample ? t("importing.bodySample") : t("importing.body")}
        </Text>
      </View>
      {!sample && !error && <BackgroundOffer />}
    </Frame>
  );
}

/**
 * While the first import runs: background sync, and the phone's battery setting it needs. Phone makers' app freezers
 * pause Pulse a few seconds into a background run unless it may run in the background (docs/learning.md, "Background
 * sync that finishes"), and their switch is in the app's own settings, so the button opens those when it is not set.
 */
function BackgroundOffer() {
  const { t } = useTranslation("onboarding");
  const [on, setOn] = useState(false);
  const [unrestricted, setUnrestricted] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => void isBatteryOptimizationEnabledAsync().then((opt) => setUnrestricted(!opt), () => setUnrestricted(null));
    check();
    const sub = AppState.addEventListener("change", (st) => st === "active" && check());
    return () => sub.remove();
  }, []);

  const turnOn = async () => {
    await writeSettings({ backgroundSync: true });
    await syncRegistration(true);
    setOn(true);
    if (unrestricted === false) await Linking.openSettings();
  };

  const done = on && unrestricted !== false;
  return (
    <Card className="mt-8 gap-3 p-4">
      <Text className="text-[15px] font-semibold leading-5">{done ? t("background.titleOn") : t("background.title")}</Text>
      <Text className="text-[13px] leading-[18px] text-foreground-secondary">
        {done
          ? t("background.bodyOn")
          : on
            ? t("background.bodyBattery")
            : t("background.body")}
      </Text>
      {!done && (
        <Button variant="outline" onPress={() => void (on ? Linking.openSettings() : turnOn())}>
          {on ? t("background.openBattery") : t("background.turnOn")}
        </Button>
      )}
    </Card>
  );
}
