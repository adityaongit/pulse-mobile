// Settings › Profile. Ported from pulse (app)/settings/SettingsView.tsx `Profile` and SettingsClient.tsx `EditProfileButton`:
// the rows, and "Edit", which opens the onboarding fields in a sheet (the route app/(sheets)/profile.tsx, U19).
import { View } from "react-native";
import { Pencil } from "lucide-react-native";
import { DAY, formatDay } from "@/lib/format";
import type { SettingsVM } from "@/queries/types";
import { CAPTION } from "@/ui/metrics/primitives";
import { SectionShell } from "@/ui/shells/SectionShell";
import { openSheet } from "@/ui/shells/sheets";
import { Text } from "@/ui/Text";
import { Divider, ROW, ROW_LABEL, ROW_VALUE, SmallButton } from "./controls";

export function ProfileCard({ profile }: { profile: SettingsVM["profile"] }) {
  const rows: [string, string][] = [
    ["Birth date", formatDay(profile.birthDate, DAY.full)],
    ["Age", String(profile.age)],
    ["Sex", profile.sex === "male" ? "Male" : "Female"],
    ["Height", profile.heightCm ? `${profile.heightCm} cm` : "Not set"],
    ["Max heart rate", `${profile.maxHr} bpm, ${profile.maxHrSource}`],
    ["Time zone", profile.timeZone],
  ];
  return (
    <SectionShell variant="card" title="Profile" action={<SmallButton icon={Pencil} label="Edit" accessibilityLabel="Edit profile" onPress={() => openSheet("/profile")} className="-my-2" />}>
      <View>
        {rows.map(([k, v], i) => (
          <View key={k}>
            {i > 0 && <Divider />}
            <View className={ROW}>
              <Text className={ROW_LABEL}>{k}</Text>
              <Text className={ROW_VALUE}>{v}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text className={`${CAPTION} mt-2`}>Your days start at midnight in your time zone. Edit changes it and recomputes your scores.</Text>
    </SectionShell>
  );
}
