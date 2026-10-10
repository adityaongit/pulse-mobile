// The person's profile: one row, written by onboarding and Settings › Profile. Ported from pulse src/server/profile.ts;
// the rows go through the profile repository instead of drizzle, and there is no user id.
import { z } from "zod";
import { isTimeZone } from "@/lib/timeZone";
import type { Store } from "./data/repos";
import { wholeYears } from "./time";

export type Profile = {
  birthDate: string;
  sex: "male" | "female";
  maxHr: number;
  /** "set": the user's own; "estimated": 208 − 0.7 × age. */
  maxHrSource: "set" | "estimated";
  heightCm: number | null;
  /** IANA zone: the person's days start at local midnight there. */
  timeZone: string;
};

/** What onboarding and Settings submit. Ages 13 to 100: under 13 Google accounts are restricted anyway. */
export const ProfileInput = z.object({
  birthDate: z.iso.date().refine((d) => {
    const age = wholeYears(d, new Date().toISOString().slice(0, 10));
    return age >= 13 && age <= 100;
  }, "Enter a birth date between 13 and 100 years ago"),
  sex: z.enum(["male", "female"], "Choose one"),
  maxHr: z.coerce.number().int().min(100, "Between 100 and 240").max(240, "Between 100 and 240").nullable(),
  heightCm: z.coerce.number().min(100, "Between 100 and 250 cm").max(250, "Between 100 and 250 cm").nullable(),
  timeZone: z.string().refine(isTimeZone, "Choose a time zone"),
});
// eslint-disable-next-line @typescript-eslint/no-redeclare -- pulse's pattern: the schema and its type share a name
export type ProfileInput = z.infer<typeof ProfileInput>;

/**
 * The stored profile with max HR resolved, or null before onboarding. Max HR: the user's own wins; else Tanaka,
 * 208 - 0.7 * age. Not the top of Google's PEAK zone: Google sends a flat 220 there for everyone (seen 2026-10-05),
 * which put every zone and Strain's heart-rate reserve too high.
 */
export async function getProfile(store: Store, today = new Date().toISOString().slice(0, 10)): Promise<Profile | null> {
  const row = await store.profile.getProfileRow();
  if (!row) return null;
  const height = row.heightCm ?? (await store.daily.googleHeight());
  return {
    birthDate: row.birthDate,
    sex: row.sex,
    maxHr: row.maxHr ?? Math.round(208 - 0.7 * wholeYears(row.birthDate, today)),
    maxHrSource: row.maxHr !== null ? "set" : "estimated",
    // The user's own height wins; else the latest from Google (sync's `height` job).
    heightCm: height,
    timeZone: row.timeZone,
  };
}

/**
 * Saves the profile and marks every day for recompute: zones, Strain, Pulse Age and fitness level all
 * depend on age, sex and max HR. Returns true when anything changed.
 */
export async function saveProfile(store: Store, input: ProfileInput, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  return store.transaction(async (tx) => {
    const changed = await tx.profile.saveProfile(input, now);
    if (changed) await tx.scores.markAllDaysDirty();
    return changed;
  });
}

/** The time zone alone (one cheap read), or null before onboarding. */
export const userTimeZone = (store: Store) => store.profile.userTimeZone();
