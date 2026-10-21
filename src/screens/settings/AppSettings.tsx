// Settings › App (display: theme, units and clock; notifications). Ported from pulse (app)/settings/SettingsView.tsx (Appearance), SettingsClient
// `ThemePicker` and AppSettings.tsx. The theme is system, light or dark, kept on the device (AsyncStorage `pulse.theme`, applied
// at launch by src/state/app.ts boot). The notification toggles live in Settings › Notifications & background
// (NotificationsSection.tsx); this section links there.
import { useEffect, useState } from "react";
import { View } from "react-native";
import { colorScheme } from "nativewind";
import { Bell, Monitor, Moon, Sun } from "lucide-react-native";
import { saveTheme, type AppPrefs, type Theme } from "@/actions/preferences";
import { displayPrefs, type UnitSystem } from "@/lib/units";
import { LANGUAGES, REVIEWED, type LanguageChoice } from "@/i18n/config";
import { readChoice } from "@/i18n/language";
import { setDisplay, setLanguage, useApp } from "@/state/app";
import { LinkList } from "@/ui/shells/LinkList";
import { SectionShell } from "@/ui/shells/SectionShell";
import { APP_VERSION } from "@/queries/settings";
import { checkForUpdate, getUpdate, setUpdateCheck, useUpdate } from "@/state/update";
import { cn } from "@/ui/cn";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { ROW, ROW_LABEL, ROW_RULE, ROW_VALUE, SelectRow, SmallButton, SwitchRow, type SelectOption } from "./controls";

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

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Phone’s language" },
  ...LANGUAGES.map((l) => ({ value: l.code, label: REVIEWED.has(l.code) ? l.name : `${l.name} · Beta` })),
] as const satisfies readonly SelectOption<LanguageChoice>[];

/** The language (kept on the device): the phone's, or one of Pulse's. Every screen redraws in it at once. */
function LanguageRow() {
  const [choice, setChoice] = useState<LanguageChoice>("auto");
  useEffect(() => void readChoice().then(setChoice), []);
  return (
    <SelectRow
      rule
      label="Language"
      value={choice}
      options={LANGUAGE_OPTIONS}
      onChange={(v) => {
        setChoice(v);
        void setLanguage(v);
      }}
    />
  );
}

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
      <LanguageRow />
    </View>
  );
}

/**
 * Updates: the daily check for a newer Pulse on GitHub (src/state/update.ts), and Check now. The check is the one request
 * Pulse makes on its own, and it carries nothing about the person.
 */
function Updates() {
  const { enabled, available } = useUpdate();
  const [checking, setChecking] = useState(false);
  const checkNow = async () => {
    setChecking(true);
    await checkForUpdate(true);
    setChecking(false);
    if (!getUpdate().available) toast.success(`Pulse ${APP_VERSION} is the latest version.`);
  };
  return (
    <SectionShell variant="card" title="Updates">
      <SwitchRow rule={false} label="Check for updates" hint="Once a day Pulse asks GitHub whether a newer version is out. Nothing about you is sent." value={enabled} onChange={(on) => void setUpdateCheck(on)} />
      <View className={cn(ROW, ROW_RULE)}>
        <Text className={ROW_LABEL}>Pulse {APP_VERSION}</Text>
        {available ? <Text className={ROW_VALUE}>{available.version} is out</Text> : <SmallButton label={checking ? "Checking…" : "Check now"} onPress={() => void checkNow()} />}
      </View>
    </SectionShell>
  );
}

export function AppSettings({ prefs }: { prefs: AppPrefs }) {
  return (
    <>
      <SectionShell variant="card" title="Display">
        <DisplayRows initialTheme={prefs.theme} />
      </SectionShell>
      <Updates />
      <LinkList title="App" rows={[{ icon: Bell, label: "Notifications & background", href: "/settings?s=notifications" }]} />
    </>
  );
}
