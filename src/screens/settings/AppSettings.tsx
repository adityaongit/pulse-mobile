// Settings › App (appearance, units and time, notifications). Ported from pulse (app)/settings/SettingsView.tsx (Appearance), SettingsClient
// `ThemePicker` and AppSettings.tsx. The theme is system, light or dark, kept on the device (AsyncStorage `pulse.theme`, applied
// at launch by src/state/app.ts boot). The notification toggles live in Settings › Notifications & background
// (NotificationsSection.tsx); this section links there.
import { useState } from "react";
import { View } from "react-native";
import { colorScheme } from "nativewind";
import { Bell, Monitor, Moon, Sun } from "lucide-react-native";
import { saveTheme, type AppPrefs, type Theme } from "@/actions/preferences";
import { displayPrefs } from "@/lib/units";
import { setDisplay, useApp } from "@/state/app";
import { LinkList } from "@/ui/shells/LinkList";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { HINT, RadioSegments } from "./controls";

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

/** Appearance: system, light or dark, as a radio group styled like the profile's segmented control. Kept per device. */
function ThemePicker({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState(initial);
  return (
    <RadioSegments
      label="Theme"
      value={theme}
      options={THEMES}
      feedback="toggle"
      onChange={(v) => {
        setTheme(v);
        colorScheme.set(v);
        void saveTheme(v);
      }}
    />
  );
}

const UNITS = [
  { value: "metric", label: "Metric" },
  { value: "imperial", label: "Imperial" },
] as const;
const HOURS = [
  { value: "24", label: "24-hour" },
  { value: "12", label: "12-hour" },
] as const;

/** Units and the clock, kept in the profile; every screen redraws in them at once (src/lib/units.ts). */
function UnitsPicker() {
  const display = useApp((a) => a.profile?.display) ?? displayPrefs();
  return (
    <View className="gap-4">
      <View className="gap-2">
        <RadioSegments label="Units" value={display.units} options={UNITS} onChange={(units) => void setDisplay({ ...display, units })} />
        <Text className={HINT}>Imperial shows pounds, feet and inches, miles and °F.</Text>
      </View>
      <RadioSegments label="Clock" value={String(display.hours) as "24" | "12"} options={HOURS} onChange={(h) => void setDisplay({ ...display, hours: h === "12" ? 12 : 24 })} />
    </View>
  );
}

export function AppSettings({ prefs }: { prefs: AppPrefs }) {
  return (
    <>
      <SectionShell variant="card" title="Appearance">
        <ThemePicker initial={prefs.theme} />
        <Text className={`${HINT} mt-2`}>System follows this device’s light or dark setting.</Text>
      </SectionShell>
      <SectionShell variant="card" title="Units and time">
        <UnitsPicker />
      </SectionShell>
      <LinkList title="App" rows={[{ icon: Bell, label: "Notifications & background", href: "/settings?s=notifications" }]} />
    </>
  );
}
