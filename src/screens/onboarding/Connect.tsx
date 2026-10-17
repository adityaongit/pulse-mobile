// Connecting Health Connect (docs/onboarding.md): the explainer that comes before Health Connect's permission sheet, then
// the screen that waits behind it while the sheet is up, and "Allow Health Connect" when the person grants nothing.
// Used by onboarding's connect step and by `/connect` (leaving sample data). The sheet is Health Connect's own, over the
// app (halo's askPermissions: every read type, older data and background reads).
import { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, View } from "react-native";
import { Activity, Footprints, HeartPulse, Moon, Utensils, Weight, type LucideIcon } from "lucide-react-native";
import { openHealthConnectSettings } from "@/health/connect";
import { connectHealth, useApp } from "@/state/app";
import { Card } from "@/ui/Card";
import { Divided } from "@/ui/Divided";
import { Icon } from "@/ui/Icon";
import { haptic } from "@/ui/haptics";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { ConnectButton, TextButton } from "./buttons";
import { Frame } from "./Frame";

// What the read permissions in src/health/connect.ts READ_TYPES let Pulse read, in the person's words, with the app's
// icons. Titles only, so the screen fits without scrolling; Health Connect's own sheet has the detail.
const READS: { icon: LucideIcon; title: string }[] = [
  { icon: Footprints, title: "Steps, distance and workouts" },
  { icon: HeartPulse, title: "Heart rate and HRV" },
  { icon: Moon, title: "Sleep and its stages" },
  { icon: Activity, title: "Breathing, oxygen and temperature" },
  { icon: Utensils, title: "Food and water you log in Fitbit" },
  { icon: Weight, title: "Weight, body fat and VO2 max" },
];

/** `sample`: the person is leaving sample data, so the explainer says it goes. */
export function ConnectFlow({ sample, onCancel }: { sample?: boolean; onCancel: () => void }) {
  const [waiting, setWaiting] = useState(false);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availability = useApp((s) => s.availability);
  const { c } = useTheme();
  // Android back is "Not now"; while Health Connect's sheet is up there is nothing to go back to.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (waiting || onCancel(), true));
    return () => sub.remove();
  }, [waiting, onCancel]);

  const unavailable = availability === "unavailable" ? "Health Connect isn’t available on this phone." : availability === "update_required" ? "Health Connect needs an update. Open it, update it, then come back." : null;

  const connect = async () => {
    if (availability === "update_required") return void openHealthConnectSettings();
    if (availability === "unavailable") return haptic.error();
    setWaiting(true);
    setError(null);
    try {
      const perms = await connectHealth();
      // Granted: the app state starts the import, and onboarding shows its progress.
      setRefused(!!perms && perms.granted.length === 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t open Health Connect. Try again.");
      haptic.error();
    }
    setWaiting(false);
  };

  if (waiting)
    return (
      // Behind Health Connect's permission sheet: what the person sees if they look past it.
      <Frame>
        <View accessibilityLiveRegion="polite" className="items-center gap-5">
          <ActivityIndicator size="large" color={c["foreground-secondary"]} />
          <View className="items-center gap-2">
            <Text accessibilityRole="header" className="text-center text-[22px] font-semibold leading-7 tracking-[-0.01em]">
              Waiting for Health Connect
            </Text>
            <Text className="max-w-[300px] text-center text-[15px] leading-[22px] text-foreground-secondary">Choose what Pulse can read in Health Connect’s window. You come back here when you’re done.</Text>
          </View>
        </View>
      </Frame>
    );

  if (refused)
    // Nothing was granted: the way back in, and the way out.
    return (
      <Frame
        footer={
          <>
            <ConnectButton onPress={connect} />
            <TextButton label="Not now" onPress={onCancel} />
          </>
        }
      >
        <View className="items-center gap-2">
          <Text accessibilityRole="header" className="text-center text-[22px] font-semibold leading-7 tracking-[-0.01em]">
            Allow Health Connect
          </Text>
          <Text className="max-w-[300px] text-center text-[15px] leading-[22px] text-foreground-secondary">
            Pulse needs at least heart rate and sleep. Allow every permission, including access to older data.
          </Text>
        </View>
      </Frame>
    );

  return (
    <Frame
      footer={
        <>
          {!!(error ?? unavailable) && (
            <Text accessibilityRole="alert" className="mb-2 text-center text-[13px] font-medium leading-[18px] text-recovery-red-text">
              {error ?? unavailable}
            </Text>
          )}
          <ConnectButton label={availability === "update_required" ? "Open Health Connect" : undefined} onPress={connect} />
          <TextButton label="Not now" onPress={onCancel} />
        </>
      }
    >
      <Text accessibilityRole="header" className="text-[28px] font-bold leading-[34px] tracking-[-0.02em]">
        What Pulse reads
      </Text>
      <Text className="mt-2 text-[15px] leading-[22px] text-foreground-secondary">
        From Health Connect, kept on this phone. The first import reads the last 180 days.{sample ? " Your sample data is cleared once you connect." : ""}
      </Text>
      <Card className="mt-6 px-4 py-1">
        <Divided>
          {READS.map((r) => (
            <View key={r.title} className="min-h-12 flex-row items-center gap-3.5 py-2.5">
              <Icon icon={r.icon} size={20} tone="foreground-secondary" />
              <Text className="min-w-0 flex-1 text-[15px] font-medium leading-5">{r.title}</Text>
            </View>
          ))}
        </Divided>
      </Card>
    </Frame>
  );
}
