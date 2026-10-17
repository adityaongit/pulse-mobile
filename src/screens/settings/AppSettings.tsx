// Settings › App (display: theme, units and clock; notifications). Ported from pulse (app)/settings/SettingsView.tsx (Appearance), SettingsClient
// `ThemePicker` and AppSettings.tsx. The theme is system, light or dark, kept on the device (AsyncStorage `pulse.theme`, applied
// at launch by src/state/app.ts boot). The notification toggles live in Settings › Notifications & background
// (NotificationsSection.tsx); this section links there.
import { useState } from "react";
import { View } from "react-native";
import { colorScheme } from "nativewind";
import { Bell, Monitor, Moon, Sun } from "lucide-react-native";
import { saveTheme, type AppPrefs, type Theme } from "@/actions/preferences";
import { displayPrefs, type UnitSystem } from "@/lib/units";
import { setDisplay, useApp } from "@/state/app";
import { LinkList } from "@/ui/shells/LinkList";
import { SectionShell } from "@/ui/shells/SectionShell";
import { SelectRow, type SelectOption } from "./controls";

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const satisfies readonly SelectOption<Theme>[];

const UNITS = [
  { value: "metric", label: "Metric", detail: "kg, km, cm, °C, ml" },
  { value: "imperial", label: "Imperial", detail: "lb, mi, ft and in, °F, fl oz" },
] as const satisfies readonly SelectOption<UnitSystem>[];

const HOURS = [
  { value: "24", label: "24-hour", detail: "22:05" },
  { value: "12", label: "12-hour", detail: "10:05 PM" },
] as const satisfies readonly SelectOption<"24" | "12">[];

/**
 * The theme (kept on the device), the units and the clock (kept in the profile; every screen redraws in them at once,
 * src/lib/units.ts), each a row whose choices open in a dropdown.
 */
function DisplayRows({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState(initialTheme);
  const display = useApp((a) => a.profile?.display) ?? displayPrefs();
  return (
    <View>
      <SelectRow
        label="Theme"
        value={theme}
        options={THEMES}
        onChange={(v) => {
          setTheme(v);
          colorScheme.set(v);
          void saveTheme(v);
        }}
      />
      <SelectRow rule label="Units" value={display.units} options={UNITS} onChange={(units) => void setDisplay({ ...display, units })} />
      <SelectRow rule label="Clock" value={String(display.hours) as "24" | "12"} options={HOURS} onChange={(h) => void setDisplay({ ...display, hours: h === "12" ? 12 : 24 })} />
    </View>
  );
}

export function AppSettings({ prefs }: { prefs: AppPrefs }) {
  return (
    <>
      <SectionShell variant="card" title="Display">
        <DisplayRows initialTheme={prefs.theme} />
      </SectionShell>
      <LinkList title="App" rows={[{ icon: Bell, label: "Notifications & background", href: "/settings?s=notifications" }]} />
    </>
  );
}
