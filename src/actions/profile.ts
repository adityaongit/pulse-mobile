// Onboarding and Settings › Profile (U19). Ported from pulse src/server/actions/profile.ts: one action for both,
// onboarding says so with `onboarding: true`. The form hands over its fields as typed (strings), the web's FormData.
import { saveProfile, ProfileInput } from "../profile";
import type { Store } from "../data/repos";
import { dataChanged } from "../screens/useScreen";
import { DEFAULT_JOURNAL_TAGS } from "../journalTags";

export type ProfileFormState =
  | { ok: true; error?: undefined; fields?: undefined }
  | { ok: false; error?: string; fields?: Partial<Record<keyof ProfileInput, string>> };

/** The form's values as typed: `sex` and `timeZone` null until chosen, the optional numbers blank when not set. */
export type ProfileFields = { birthDate: string; sex: string | null; maxHr: string; heightCm: string; timeZone: string | null };

const optional = (v: string) => (v.trim() !== "" ? v.trim() : null);

export async function saveProfileAction(store: Store, form: ProfileFields, opts: { onboarding?: boolean } = {}): Promise<ProfileFormState> {
  const r = ProfileInput.safeParse({
    birthDate: form.birthDate,
    sex: form.sex ?? undefined,
    maxHr: optional(form.maxHr),
    heightCm: optional(form.heightCm),
    timeZone: form.timeZone ?? undefined,
  });
  if (!r.success) {
    const fields: Partial<Record<keyof ProfileInput, string>> = {};
    for (const i of r.error.issues) fields[i.path[0] as keyof ProfileInput] ??= i.path[0] === "birthDate" && i.code !== "custom" ? "Enter your birth date" : i.message;
    return { ok: false, fields };
  }
  try {
    // Every day is marked for recompute (saveProfile): the pipeline rescores them when it next runs.
    await saveProfile(store, r.data);
    // First run: the Journal's default behaviours exist before the first check-in (pulse made them at sign-up).
    if (opts.onboarding) await store.journal.ensureDefaultTags([...DEFAULT_JOURNAL_TAGS]);
  } catch {
    return { ok: false, error: "Couldn’t save. Try again." };
  }
  dataChanged();
  return { ok: true };
}
