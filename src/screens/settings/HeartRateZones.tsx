// Settings › Profile, heart-rate zones (reference study, strain-load.md § Zone settings derivation): 50 to 90 % of the
// engine's max heart rate, or the person's own lower bounds in bpm (the study's manual method). Strain is scored on them,
// so saving rescores the whole history, as a new max heart rate does (src/state/app.ts saveProfile, stage 1's key).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ZONE_BPM, zoneBoundsError, zonesOf } from "@/core/engine/strain";
import type { Profile } from "@/data/types";
import { i18n } from "@/i18n/config";
import { useShellCalendar } from "@/ui/shells/ShellStatus";
import { engineMaxHr } from "@/pipeline";
import { saveProfile, useApp } from "@/state/app";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { cn } from "@/ui/cn";
import { BODY, HINT, RadioSegments, ROW_RULE, SmallButton, TextField } from "./controls";

type Method = "automatic" | "own";

async function save(p: Profile, hrZones: number[] | null) {
  await saveProfile({ ...p, hrZones });
  toast.success(i18n.t("settings:zones.saved"));
}

const ERROR = { count: "settings:zones.errorWhole", range: "settings:zones.errorRange", order: "settings:zones.errorOrder", max: "settings:zones.errorMax" } as const;

/** Five fields as typed: the bounds, or why they can't be zones. */
export function parseZones(typed: string[], maxHr: number): { zones: number[] } | { error: string } {
  const zones = typed.map((s) => (s.trim() === "" ? NaN : Number(s.trim())));
  if (!zones.every(Number.isInteger)) return { error: i18n.t("settings:zones.errorWhole") };
  const why = zoneBoundsError(zones, maxHr);
  return why ? { error: i18n.t(ERROR[why], { maxHr, min: ZONE_BPM.min, max: ZONE_BPM.max }) } : { zones };
}

function OwnZones({ profile, start, maxHr }: { profile: Profile; start: readonly number[]; maxHr: number }) {
  const { t } = useTranslation("settings");
  const [typed, setTyped] = useState(start.map(String));
  const r = parseZones(typed, maxHr);
  const error = "error" in r ? r.error : null;
  return (
    <View className="pt-3">
      <View className="flex-row gap-2">
        {typed.map((v, i) => (
          <View key={i} className="min-w-0 flex-1 gap-1">
            <Text className={cn(HINT, "text-center")}>{t("zones.zone", { n: i + 1 })}</Text>
            <TextField
              variant="number"
              value={v}
              onChangeText={(s) => setTyped((all) => all.map((x, k) => (k === i ? s : x)))}
              keyboardType="number-pad"
              accessibilityLabel={t("zones.zoneAria", { n: i + 1 })}
              invalid={!!error}
            />
          </View>
        ))}
      </View>
      {!!error && <Text accessibilityRole="alert" className="pt-1 text-[13px] font-medium leading-[18px] text-recovery-red-text">{error}</Text>}
      <View className="flex-row items-center justify-between gap-3 pt-2">
        <Text className={cn(HINT, "flex-1")}>{t("zones.ownHint", { maxHr })}</Text>
        <SmallButton solid label={t("actions.save", { ns: "common" })} accessibilityLabel={t("zones.saveAria")} onPress={() => "zones" in r && void save(profile, r.zones)} />
      </View>
    </View>
  );
}

export function HeartRateZones() {
  const { t } = useTranslation("settings");
  const profile = useApp((a) => a.profile);
  const [method, setMethod] = useState<Method | null>(null);
  const { today } = useShellCalendar();
  if (!profile) return null;
  const maxHr = engineMaxHr(profile, today);
  const auto = zonesOf(maxHr).lowest;
  const own = profile.hrZones ?? null;
  const shown = method ?? (own ? "own" : "automatic");
  const methods = [
    { value: "automatic", label: t("zones.automatic") },
    { value: "own", label: t("zones.own") },
  ] as const;
  const pick = (m: Method) => {
    setMethod(m);
    if (m === "automatic" && own) void save(profile, null);
  };
  return (
    <SectionShell variant="card" title={t("zones.title")}>
      <Text className={cn(BODY, "pb-3")}>{t("zones.body")}</Text>
      <View className={cn(ROW_RULE, "pt-3")}>
        <RadioSegments label={t("zones.method")} value={shown} options={methods} onChange={pick} />
      </View>
      {shown === "own" ? (
        <OwnZones key={(own ?? auto).join()} profile={profile} start={own ?? auto} maxHr={maxHr} />
      ) : (
        <Text className={cn(HINT, "pt-3")}>{t("zones.automaticHint", { maxHr, z1: auto[0], z2: auto[1], z3: auto[2], z4: auto[3], z5: auto[4] })}</Text>
      )}
    </SectionShell>
  );
}
