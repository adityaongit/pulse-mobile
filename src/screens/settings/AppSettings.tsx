// Settings › App (appearance, notifications). Ported from pulse (app)/settings/SettingsView.tsx (Appearance), SettingsClient
// `ThemePicker` and AppSettings.tsx. The theme is system, light or dark, kept on the device (the `theme` setting, applied
// at launch by src/screens/onboarding/gate.ts). Notifications are two stored toggles (the web had one push subscription:
// "Recovery ready, and when Pulse can’t sync"); scheduling them is the background stream's. Dropped: Install Pulse (a PWA thing).
import { useState } from "react";
import { View } from "react-native";
import { colorScheme } from "nativewind";
import { Monitor, Moon, Sun } from "lucide-react-native";
import { saveNotify, saveTheme, type NotifyKey, type Theme } from "@/actions/preferences";
import { store } from "@/data/store";
import type { AppPrefs } from "@/queries/settings";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { Divider, HINT, RadioSegments, ROW, ROW_LABEL, Switch } from "./controls";

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
        void saveTheme(store, v);
      }}
    />
  );
}

function NotifyRow({ label, hint, settingKey, initial }: { label: string; hint: string; settingKey: NotifyKey; initial: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <View className={ROW}>
      <View className="min-w-0 flex-1">
        <Text className={ROW_LABEL}>{label}</Text>
        <Text className={HINT}>{hint}</Text>
      </View>
      <Switch
        label={label}
        value={on}
        onValueChange={(v) => {
          setOn(v);
          void saveNotify(store, settingKey, v);
        }}
      />
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
      <SectionShell variant="card" title="App">
        <View>
          <NotifyRow label="Recovery ready" hint="Once a day, when your Recovery is scored." settingKey="notify.recovery" initial={prefs.notifyRecovery} />
          <Divider />
          <NotifyRow label="Pulse can’t sync" hint="Once a day, if Pulse can’t sync." settingKey="notify.syncProblem" initial={prefs.notifySyncProblem} />
        </View>
      </SectionShell>
    </>
  );
}
