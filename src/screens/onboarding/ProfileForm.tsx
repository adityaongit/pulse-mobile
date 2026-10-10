// The profile fields (U19), shared by onboarding and Settings › Profile. Ported from pulse
// src/components/profile/ProfileForm.tsx: a year-first birth date picker, the sex choice as a segmented control, the time
// zone (on first run the device's, one line, "Change" opens the picker), and, in Settings, height and max heart rate.
// `footer` renders the submit, so each host places it (onboarding pins it to the bottom, the sheet to its foot).
import { useState, type ReactNode } from "react";
import { haptic } from "@/ui/haptics";
import { View } from "react-native";
import { saveProfileAction, type ProfileFormState } from "@/actions/profile";
import { store } from "@/data/store";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { Field, RadioSegments, SmallButton, TextField } from "../settings/controls";
import { BirthDatePicker } from "./BirthDatePicker";
import { TimeZonePicker } from "./TimeZonePicker";
import { deviceZone, describeZone } from "./timeZones";

export type ProfileDefaults = { birthDate: string; sex: "male" | "female" | null; maxHr: number | null; heightCm: number | null; timeZone: string | null };

export function ProfileForm({
  defaults,
  onboarding = false,
  onSaved,
  footer,
}: {
  defaults: ProfileDefaults;
  /** First run: only what nothing else can supply (birth date, sex). Height and max HR wait for Settings. */
  onboarding?: boolean;
  onSaved?: () => void;
  footer: (state: { pending: boolean; submit: () => void }) => ReactNode;
}) {
  const [birthDate, setBirthDate] = useState(defaults.birthDate);
  const [sex, setSex] = useState<"male" | "female" | null>(defaults.sex);
  const [edited, setTimeZone] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState(defaults.heightCm?.toString() ?? "");
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
    const r = await saveProfileAction(store, { birthDate, sex, maxHr, heightCm, timeZone: timeZone || null }, { onboarding });
    setPending(false);
    setState(r);
    if (r.ok) onSaved?.();
    else haptic.error();
  };

  return (
    <View className="gap-6">
      <Field label="Birth date" hint="For heart rate zones, sleep need and Pulse Age." error={f?.birthDate}>
        <BirthDatePicker value={birthDate} onChange={setBirthDate} invalid={!!f?.birthDate} />
      </Field>

      <View accessibilityRole="radiogroup" className="gap-2">
        <Text className="mb-2 text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary">Sex</Text>
        <RadioSegments
          label="Sex"
          value={sex}
          onChange={setSex}
          options={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
          ]}
        />
        {f?.sex ? (
          <Text accessibilityLiveRegion="polite" className="text-[13px] font-medium leading-[18px] text-recovery-red-text">
            Choose one
          </Text>
        ) : (
          <Text className="text-[13px] leading-[18px] text-muted-foreground">Sex at birth. Reference ranges differ by sex.</Text>
        )}
      </View>

      {zoneOpen || !timeZone || f?.timeZone ? (
        <Field label="Time zone" hint="Where you live. Your days start at midnight here." error={f?.timeZone}>
          <TimeZonePicker value={timeZone} onChange={setTimeZone} invalid={!!f?.timeZone} />
        </Field>
      ) : (
        <View className="min-h-14 flex-row items-center gap-3 rounded-xl bg-field py-2 pl-4 pr-2">
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary">Time zone</Text>
            <Text numberOfLines={1} className="text-[15px] leading-5 text-foreground">
              {describeZone(timeZone)}
            </Text>
          </View>
          <SmallButton label="Change" accessibilityLabel="Change time zone" onPress={() => setZoneOpen(true)} />
        </View>
      )}

      {!onboarding && (
        <View className="gap-6">
          <Field label="Height" hint="In cm. Adds lean body mass to Pulse Age." error={f?.heightCm} optional>
            <TextField accessibilityLabel="Height in cm" keyboardType="decimal-pad" placeholder="cm" value={heightCm} onChangeText={setHeightCm} invalid={!!f?.heightCm} />
          </Field>
          <Field label="Max heart rate" hint="Leave blank to estimate it from your age." error={f?.maxHr} optional>
            <TextField accessibilityLabel="Max heart rate in bpm" keyboardType="number-pad" placeholder="bpm" value={maxHr} onChangeText={setMaxHr} invalid={!!f?.maxHr} />
          </Field>
        </View>
      )}

      {state?.ok === false && state.error && (
        <Text accessibilityRole="alert" className="text-[13px] font-medium leading-[18px] text-recovery-red-text">
          {state.error}
        </Text>
      )}
      {footer({ pending, submit })}
    </View>
  );
}

/** The submit, as the web's `SaveButton`: a sheet-size pill that reads "Saving…" while the action runs. */
export function SaveButton({ pending, label, onPress }: { pending: boolean; label: string; onPress: () => void }) {
  return (
    <Button size="sheet" disabled={pending} onPress={onPress}>
      {pending ? "Saving…" : label}
    </Button>
  );
}
