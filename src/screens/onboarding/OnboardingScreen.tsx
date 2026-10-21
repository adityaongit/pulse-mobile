// First run `/onboarding` (docs/onboarding.md). Welcome (connect Health Connect or explore with sample data), then the
// profile, then the explainer before Health Connect's permission sheet, then the first import with its progress. The
// profile step is pulse's src/app/onboarding/Onboarding.tsx on the AuthShell frame: birth date, sex and the time zone
// (the device's, one tap to change); height and max HR wait for Settings. Where to start comes from the app state
// (src/state/app.ts): a saved profile without a source opens on the connect step, an import in flight on its progress.
import { useEffect, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { isBatteryOptimizationEnabledAsync } from "expo-battery";
import { Lock } from "lucide-react-native";
import { writeSettings } from "@/background/settings";
import { syncRegistration } from "@/background/task";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { exploreSample, refresh, stepLabel, useApp, type Progress } from "@/state/app";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { ConnectFlow } from "./Connect";
import { Frame } from "./Frame";
import { ConnectButton, TextButton } from "./buttons";
import { HeartbeatMark } from "./HeartbeatMark";
import { ProfileForm, SaveButton } from "./ProfileForm";
import { cn } from "@/ui/cn";
import { BAR_CORNERS } from "@/ui/radius";

type Step = "welcome" | "profile" | "connect";

export function OnboardingScreen() {
  const hasProfile = useApp((s) => s.profile !== null);
  const source = useApp((s) => s.source);
  const status = useApp((s) => s.status);
  // A profile and no source: carry on at the connect step. A source and no profile (the sample was left before a
  // profile was ever saved): the profile step, and the import starts once it is saved.
  const [step, setStep] = useState<Step>(() => (hasProfile ? "connect" : source === "health_connect" ? "profile" : "welcome"));
  // The first import (or the sample's build) runs: its progress, or its failure with a way to try again.
  if (hasProfile && source && (status === "syncing" || status === "error")) return <Importing sample={source === "demo"} />;
  if (step === "welcome") return <Welcome onConnect={() => setStep("profile")} />;
  if (step === "profile") return <Profile onSaved={() => setStep("connect")} />;
  return <ConnectFlow onCancel={() => setStep(hasProfile ? "profile" : "welcome")} />;
}

/** One bar for the run: the step's share done. */
const fraction = (p: Progress | null) => (p && p.total > 0 ? Math.min(1, p.done / p.total) : 0);

function ProgressFooter({ progress, fallback }: { progress: Progress | null; fallback: string }) {
  const pct = Math.round(fraction(progress) * 100);
  return (
    <View accessibilityLiveRegion="polite" className="h-[132px] items-center justify-center gap-3 px-6">
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} className={cn("h-2 w-full overflow-hidden bg-fill-pressed", BAR_CORNERS)}>
        <View className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </View>
      <Text className="text-[13px] leading-[18px] text-foreground-secondary">{progress ? stepLabel(progress.step) : fallback}…</Text>
    </View>
  );
}

function Welcome({ onConnect }: { onConnect: () => void }) {
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
      setError(e instanceof Error ? e.message : "Couldn’t build the sample data. Try again.");
      haptic.error();
    }
  };

  return (
    <Frame
      wordmark={false}
      footer={
        building ? (
          <ProgressFooter progress={progress} fallback="Building sample data" />
        ) : (
          <>
            {!!error && (
              <Text accessibilityRole="alert" className="mb-2 text-center text-[13px] font-medium leading-[18px] text-recovery-red-text">
                {error}
              </Text>
            )}
            <ConnectButton onPress={onConnect} />
            <TextButton label="Explore with sample data" onPress={explore} />
            <View className="mt-2 flex-row items-center justify-center gap-1.5">
              <Icon icon={Lock} size={13} tone="muted-foreground" strokeWidth={2} />
              <Text className="text-[13px] leading-[18px] text-muted-foreground">Stays on this phone. No account, no server.</Text>
            </View>
          </>
        )
      }
    >
      <View className="items-center gap-8">
        <HeartbeatMark />
        <View className="items-center gap-2">
          <Text accessibilityRole="header" className="text-center text-[24px] font-bold leading-[30px] tracking-[-0.02em]">
            Your Fitbit, scored every morning
          </Text>
          <Text className="max-w-[300px] text-center text-[15px] leading-[22px] text-foreground-secondary">Sleep, Recovery and Strain from Health Connect, worked out on this phone.</Text>
        </View>
      </View>
    </Frame>
  );
}

function Profile({ onSaved }: { onSaved: () => void }) {
  return (
    <Frame>
      <Text accessibilityRole="header" className="text-[28px] font-bold leading-[34px] tracking-[-0.02em]">
        Two things Health Connect doesn’t share
      </Text>
      <Text className="mb-7 mt-2 text-base leading-6 text-foreground-secondary">Pulse compares your heart rate with people of your age, using the reference ranges you choose. You can change these later in Settings.</Text>
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
            <SaveButton pending={pending} label="Save and continue" onPress={submit} />
          </View>
        )}
      />
    </Frame>
  );
}

/** The first import (or the sample's build), with its progress; the tabs open when it ends. */
function Importing({ sample }: { sample: boolean }) {
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
            <ConnectButton label="Try again" onPress={() => void refresh()} />
          </>
        ) : (
          <ProgressFooter progress={progress} fallback={sample ? "Building sample data" : "Importing from Health Connect"} />
        )
      }
    >
      <View className="items-center gap-2">
        <Text accessibilityRole="header" className="text-center text-[22px] font-semibold leading-7 tracking-[-0.01em]">
          {error ? "The import stopped" : sample ? "Building your sample data" : "Importing your data"}
        </Text>
        <Text className="max-w-[300px] text-center text-[15px] leading-[22px] text-foreground-secondary">
          {sample ? "Half a year of a demo person’s days, scored on this phone." : "Up to 180 days from Health Connect, scored on this phone. The first import takes a few minutes."}
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
      <Text className="text-[15px] font-semibold leading-5">{done ? "Background sync is on" : "Keep Pulse up to date"}</Text>
      <Text className="text-[13px] leading-[18px] text-foreground-secondary">
        {done
          ? "Pulse syncs while it’s closed. Change it in Settings › Notifications & background."
          : on
            ? "One more step: under Battery, choose Allow background activity or Unrestricted. Many phones pause Pulse in the background otherwise."
            : "Sync while Pulse is closed. Many phones also need Pulse allowed to run in the background; the button opens that setting."}
      </Text>
      {!done && (
        <Button variant="outline" onPress={() => void (on ? Linking.openSettings() : turnOn())}>
          {on ? "Open battery settings" : "Turn on background sync"}
        </Button>
      )}
    </Card>
  );
}
