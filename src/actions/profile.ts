// Onboarding and Settings › Profile: one action for both. The form hands over its fields as typed (strings), checked
// with pulse's rules; `save` writes the profile (src/state/app.ts saveProfile, which also reruns the scores).
import { z } from "zod";
import type { Profile } from "@/data/types";
import { defaultSleepGoal } from "@/core/engine/sleep";
import { heightText } from "@/lib/format";
import { wholeYears } from "@/lib/time";
import { isTimeZone } from "@/lib/timeZone";

/** Heights the profile takes, kept in cm. */
const HEIGHT_CM = { min: 100, max: 250 };
/** The height limits in the person's units: "Between 100 cm and 250 cm", or "Between 3′ 3″ and 8′ 2″". */
const heightRange = () => `Between ${heightText(HEIGHT_CM.min)} and ${heightText(HEIGHT_CM.max)}`;

/** What onboarding and Settings submit. Ages 13 to 100. */
export const ProfileInput = z.object({
  birthDate: z.iso.date().refine((d) => {
    const age = wholeYears(d, new Date().toISOString().slice(0, 10));
    return age >= 13 && age <= 100;
  }, "Enter a birth date between 13 and 100 years ago"),
  sex: z.enum(["male", "female"], "Choose one"),
  maxHr: z.coerce.number().int().min(100, "Between 100 and 240").max(240, "Between 100 and 240").nullable(),
  heightCm: z.coerce.number().min(HEIGHT_CM.min, { error: heightRange }).max(HEIGHT_CM.max, { error: heightRange }).nullable(),
  timeZone: z.string().refine(isTimeZone, "Choose a time zone"),
  name: z.string().max(60, "Up to 60 characters").nullable(),
});
// eslint-disable-next-line @typescript-eslint/no-redeclare -- pulse's pattern: the schema and its type share a name
export type ProfileInput = z.infer<typeof ProfileInput>;

export type ProfileFormState =
  | { ok: true; error?: undefined; fields?: undefined }
  | { ok: false; error?: string; fields?: Partial<Record<keyof ProfileInput, string>> };

/** The form's values as typed: `sex` and `timeZone` null until chosen, the optional numbers blank when not set. */
export type ProfileFields = { birthDate: string; sex: string | null; maxHr: string; heightCm: string; timeZone: string | null; name: string };

const optional = (v: string) => (v.trim() !== "" ? v.trim() : null);

/** The avatar's letters: the first and last words' initials ("Asha Rao" → "AR", "Asha" → "A"), or null without a name. */
export function initials(name: string | null | undefined): string | null {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!words.length) return null;
  const first = (w: string) => Array.from(w)[0]!.toUpperCase();
  return words.length === 1 ? first(words[0]!) : first(words[0]!) + first(words.at(-1)!);
}

/**
 * Checks the form; on success saves `{ ...previous, ...fields }` (a waist set elsewhere stays) through `save`. A first
 * profile (onboarding) gets the age default sleep goal, automatic (reference study, sleep.md § Goal setting).
 */
export async function saveProfileAction(form: ProfileFields, previous: Profile | null, save: (p: Profile) => Promise<void>): Promise<ProfileFormState> {
  const r = ProfileInput.safeParse({
    birthDate: form.birthDate,
    sex: form.sex ?? undefined,
    maxHr: optional(form.maxHr),
    heightCm: optional(form.heightCm),
    timeZone: form.timeZone ?? undefined,
    name: optional(form.name),
  });
  if (!r.success) {
    const fields: Partial<Record<keyof ProfileInput, string>> = {};
    for (const i of r.error.issues) fields[i.path[0] as keyof ProfileInput] ??= i.path[0] === "birthDate" && i.code !== "custom" ? "Enter your birth date" : i.message;
    return { ok: false, fields };
  }
  try {
    const goal = { hours: defaultSleepGoal(wholeYears(r.data.birthDate, new Date().toISOString().slice(0, 10))), method: "automatic" as const };
    await save({ ...(previous ?? { sleepGoal: goal }), ...r.data });
  } catch {
    return { ok: false, error: "Couldn’t save. Try again." };
  }
  return { ok: true };
}
