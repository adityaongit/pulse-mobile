// The profile fields (U19), shared by onboarding and Settings › Profile. Ported from pulse
// src/components/profile/ProfileForm.tsx: a year-first birth date picker, the sex choice as a segmented control, the time
// zone (on first run the device's, one line, "Change" opens the picker), and, in Settings, height and max heart rate.
// `footer` renders the submit, so each host places it (onboarding pins it to the bottom, the sheet to its foot).
import { useTranslation } from "react-i18next";
import { useState, type ReactNode } from "react";
import { haptic } from "@/ui/haptics";
import { View } from "react-native";
import { saveProfileAction, type ProfileFormState } from "@/actions/profile";
import { displayPrefs, feetInches, fromFeetInches } from "@/lib/units";
import { appState, saveProfile } from "@/state/app";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { Field, RadioSegments, SmallButton, TextField } from "../settings/controls";
import { BirthDatePicker } from "./BirthDatePicker";
import { TimeZonePicker } from "./TimeZonePicker";
import { deviceZone, describeZone } from "./timeZones";

/**
 * The profile's sex, framed as what it does: it picks the male or female reference tables (Strain's heart-rate weighting,
 * sleep stage targets, VO2 max norms, Pulse Age). "Sex at birth" did not fit people on long-term hormone therapy.
 */
export const RANGES_LABEL = "Reference ranges";

export type ProfileDefaults = { birthDate: string; sex: "male" | "female" | null; maxHr: number | null; heightCm: number | null; timeZone: string | null; name?: string | null };

export function ProfileForm({
  defaults,
  onboarding = false,
  onSaved,
  footer,
  sheet,
}: {
  defaults: ProfileDefaults;
  /** First run: only what nothing else can supply (birth date, sex). Height and max HR wait for Settings. */
  onboarding?: boolean;
  onSaved?: () => void;
  footer: (state: { pending: boolean; submit: () => void }) => ReactNode;
  /** The Edit profile sheet: smaller fields, and the host places the fields and the footer itself (the sheet pins the footer under its scrolling body). */
  sheet?: (fields: ReactNode, footer: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation("onboarding");
  const [name, setName] = useState(defaults.name ?? "");
  const [birthDate, setBirthDate] = useState(defaults.birthDate);
  const [sex, setSex] = useState<"male" | "female" | null>(defaults.sex);
  const [edited, setTimeZone] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState(defaults.heightCm?.toString() ?? "");
  // Imperial: feet and inches, sent on as cm (src/lib/units.ts).
  const imperial = displayPrefs().units === "imperial";
  const startHeight = defaults.heightCm != null ? feetInches(defaults.heightCm) : null;
  const [feet, setFeet] = useState(startHeight ? String(startHeight.feet) : "");
  const [inches, setInches] = useState(startHeight ? String(startHeight.inches) : "");
  const typedHeight = !imperial ? heightCm : feet.trim() || inches.trim() ? String(Math.round(fromFeetInches(Number(feet || 0), Number(inches || 0)) * 10) / 10) : "";
  const [maxHr, setMaxHr] = useState(defaults.maxHr?.toString() ?? "");
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<ProfileFormState | null>(null);
  // Onboarding shows the detected zone as one line; Change opens the picker. An error opens it too.
  const [zoneOpen, setZoneOpen] = useState(!onboarding);
  // No saved zone (onboarding): the device's own.
  const timeZone = edited ?? defaults.timeZone ?? deviceZone();
  const f = state?.ok === false ? state.fields : undefined;

  const submit = async () => {
    setPending(true);
    const r = await saveProfileAction({ birthDate, sex, maxHr, heightCm: typedHeight, timeZone: timeZone || null, name }, appState().profile, saveProfile);
    setPending(false);
    setState(r);
    if (r.ok) onSaved?.();
    else haptic.error();
  };
  const compact = !!sheet;
  const variant = compact ? "compact" : "field";
  // The unit after a number that has a partner (5 ft 10 in), in the field's own type size and padding.
  const unitSuffix = (unit: string) => <Text className={compact ? "pr-3.5 text-[15px] text-muted-foreground" : "pr-4 text-[17px] text-muted-foreground"}>{unit}</Text>;
  const gap = compact ? "gap-4" : "gap-6";

  const fields = (
    <View className={gap}>
      {/* No autofill: Android paints an autofilled field olive over our fill. */}
      <Field label={t("form.name")} hint={t("form.nameHint")} error={f?.name} optional>
        <TextField variant={variant} accessibilityLabel={t("form.name")} autoCapitalize="words" autoComplete="off" importantForAutofill="no" placeholder={t("form.namePlaceholder")} value={name} onChangeText={setName} invalid={!!f?.name} />
      </Field>
      <Field label={t("form.birthDate")} hint={t("form.birthDateHint")} error={f?.birthDate}>
        <BirthDatePicker value={birthDate} onChange={setBirthDate} invalid={!!f?.birthDate} compact={compact} />
      </Field>

      <View accessibilityRole="radiogroup" className="gap-2">
        <Text className={`${compact ? "" : "mb-2 "}text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary`}>{t("form.rangesLabel")}</Text>
        <RadioSegments
          label={t("form.rangesLabel")}
          value={sex}
          onChange={setSex}
          options={[
            { value: "male", label: t("form.male") },
            { value: "female", label: t("form.female") },
          ]}
        />
        {f?.sex ? (
          <Text accessibilityLiveRegion="polite" className="text-[13px] font-medium leading-[18px] text-recovery-red-text">
            {t("form.chooseOne")}
          </Text>
        ) : (
          <Text className="text-[13px] leading-[18px] text-muted-foreground">
            {t("form.rangesHint")}
          </Text>
        )}
      </View>

      {zoneOpen || !timeZone || f?.timeZone ? (
        <Field label={t("form.timeZone")} hint={t("form.timeZoneHint")} error={f?.timeZone}>
          <TimeZonePicker value={timeZone} onChange={setTimeZone} invalid={!!f?.timeZone} compact={compact} />
        </Field>
      ) : (
        <View className="min-h-14 flex-row items-center gap-3 rounded-xl bg-field py-2 pl-4 pr-2">
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary">{t("form.timeZone")}</Text>
            <Text numberOfLines={1} className="text-[15px] leading-5 text-foreground">
              {describeZone(timeZone)}
            </Text>
          </View>
          <SmallButton label={t("form.change")} accessibilityLabel={t("form.changeTimeZone")} onPress={() => setZoneOpen(true)} />
        </View>
      )}

      {!onboarding && (
        <View className={gap}>
          <Field label={t("form.height")} hint={t("form.heightHint")} error={f?.heightCm} optional>
            {imperial ? (
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <TextField variant={variant} accessibilityLabel={t("form.heightFeet")} keyboardType="number-pad" right={unitSuffix("ft")} value={feet} onChangeText={setFeet} invalid={!!f?.heightCm} />
                </View>
                <View className="flex-1">
                  <TextField variant={variant} accessibilityLabel={t("form.heightInches")} keyboardType="number-pad" right={unitSuffix("in")} value={inches} onChangeText={setInches} invalid={!!f?.heightCm} />
                </View>
              </View>
            ) : (
              <TextField variant={variant} accessibilityLabel={t("form.heightCm")} keyboardType="decimal-pad" placeholder="cm" value={heightCm} onChangeText={setHeightCm} invalid={!!f?.heightCm} />
            )}
          </Field>
          <Field label={t("form.maxHr")} hint={t("form.maxHrHint")} error={f?.maxHr} optional>
            <TextField variant={variant} accessibilityLabel={t("form.maxHrBpm")} keyboardType="number-pad" placeholder="bpm" value={maxHr} onChangeText={setMaxHr} invalid={!!f?.maxHr} />
          </Field>
        </View>
      )}

      {state?.ok === false && !!state.error && (
        <Text accessibilityRole="alert" className="text-[13px] font-medium leading-[18px] text-recovery-red-text">
          {state.error}
        </Text>
      )}
    </View>
  );
  const foot = footer({ pending, submit });
  return sheet ? (
    sheet(fields, foot)
  ) : (
    <View className="gap-6">
      {fields}
      {foot}
    </View>
  );
}

/** The submit, as the web's `SaveButton`: a sheet-size pill that reads "Saving…" while the action runs. */
export function SaveButton({ pending, label, onPress }: { pending: boolean; label: string; onPress: () => void }) {
  const { t } = useTranslation("onboarding");
  return (
    <Button disabled={pending} onPress={onPress}>
      {pending ? t("profile.saving") : label}
    </Button>
  );
}
