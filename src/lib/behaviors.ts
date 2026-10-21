// The journal's behaviour catalogue (journal-04..09): every behaviour a person can add to the daily journal, with the
// sentence the journal asks, its Select Behaviors category and the journal section it sits in. Keys are stored in
// journal_tags and journal_entries; never rename one. The nine defaults keep their original keys.

import { i18n } from "@/i18n/config"

/** Text from the journal namespace, read when called (never at import) so it follows the language in use. */
const tr = (key: string) => i18n.t(`journal:${key}` as never) as unknown as string
/** `obj` with a getter per entry of `texts`: the text resolves when it is read. Typed by the declaration it fills. */
const withText = (obj: object, texts: Record<string, string>): any =>
  Object.defineProperties(obj, Object.fromEntries(Object.entries(texts).map(([k, key]) => [k, { get: () => tr(key), enumerable: true }])))

const CATEGORY_KEYS = ["drugs", "health", "personal", "lifestyle", "mental", "nutrition", "recovery"] as const
export type BehaviorCategory = (typeof CATEGORY_KEYS)[number]
export const BEHAVIOR_CATEGORIES: readonly { key: BehaviorCategory; readonly label: string }[] = CATEGORY_KEYS.map((key) => withText({ key }, { label: `category.${key}` }))

/** The journal's sections (journal-01): when in the day the question is about. Custom behaviours sit under "custom". */
const SECTION_KEYS = ["daytime", "nighttime", "status", "custom"] as const
export type JournalSection = (typeof SECTION_KEYS)[number]
export const JOURNAL_SECTIONS: readonly { key: JournalSection; readonly title: string }[] = SECTION_KEYS.map((key) => withText({ key }, { title: `section.${key}` }))

/**
 * A follow-up asked once the answer is yes (journal-12): a slider whose value is stored beside the answer.
 * "clock" is minutes after midnight in 30-minute steps; "count" a whole number.
 */
export type FollowUp = { question: string; kind: "clock" | "count"; min: number; max: number; step: number }

export type Behavior = { key: string; label: string; question: string; category: BehaviorCategory; section: Exclude<JournalSection, "custom">; followUp?: FollowUp }

const LAST: FollowUp = withText({ kind: "clock" as const, min: 6 * 60, max: 24 * 60 - 30, step: 30 }, { question: "followUp.lastConsumed" })
const DRINKS: FollowUp = withText({ kind: "count" as const, min: 1, max: 10, step: 1 }, { question: "followUp.drinks" })

type Raw = Omit<Behavior, "label" | "question">
const RAW: readonly Raw[] = [
  { key: "accutane", category: "drugs", section: "daytime" },
  { key: "acne", category: "health", section: "status" },
  { key: "acupuncture", category: "recovery", section: "daytime" },
  { key: "adhd_medication", category: "drugs", section: "daytime" },
  { key: "adaptogens", category: "nutrition", section: "daytime" },
  { key: "added_sugar", category: "nutrition", section: "daytime" },
  { key: "afternoon_snack", category: "nutrition", section: "daytime" },
  { key: "air_travel", category: "lifestyle", section: "daytime" },
  { key: "alcohol", category: "nutrition", section: "nighttime", followUp: DRINKS },
  { key: "allergy_medication", category: "drugs", section: "daytime" },
  { key: "anti_anxiety_medication", category: "drugs", section: "daytime" },
  { key: "anxiety", category: "mental", section: "status" },
  { key: "blood_donation", category: "personal", section: "daytime" },
  { key: "caffeine", category: "nutrition", section: "daytime", followUp: LAST },
  { key: "camping", category: "lifestyle", section: "nighttime" },
  { key: "car_train_travel", category: "lifestyle", section: "daytime" },
  { key: "caregiving", category: "lifestyle", section: "daytime" },
  { key: "cold_exposure", category: "recovery", section: "daytime" },
  { key: "electrolytes", category: "nutrition", section: "daytime", followUp: LAST },
  { key: "family_friends", category: "mental", section: "daytime" },
  { key: "feeding_baby", category: "lifestyle", section: "nighttime" },
  { key: "fever", category: "health", section: "daytime" },
  { key: "headache", category: "health", section: "status" },
  { key: "illness", category: "health", section: "status" },
  { key: "injury", category: "health", section: "status" },
  { key: "intermittent_fasting", category: "nutrition", section: "daytime" },
  { key: "journaling", category: "mental", section: "nighttime" },
  { key: "late_caffeine", category: "nutrition", section: "daytime" },
  { key: "late_meal", category: "nutrition", section: "nighttime" },
  { key: "magnesium", category: "nutrition", section: "nighttime" },
  { key: "meditation", category: "mental", section: "daytime" },
  { key: "melatonin", category: "drugs", section: "nighttime" },
  { key: "menstruating", category: "personal", section: "status" },
  { key: "mouth_tape", category: "recovery", section: "nighttime" },
  { key: "nap", category: "recovery", section: "daytime" },
  { key: "night_shift", category: "lifestyle", section: "nighttime" },
  { key: "on_call", category: "lifestyle", section: "nighttime" },
  { key: "outdoor_time", category: "lifestyle", section: "daytime" },
  { key: "parenting", category: "lifestyle", section: "daytime" },
  { key: "remote_work", category: "lifestyle", section: "daytime" },
  { key: "sauna", category: "recovery", section: "daytime" },
  { key: "screen_in_bed", category: "lifestyle", section: "nighttime" },
  { key: "sexual_activity", category: "personal", section: "nighttime" },
  { key: "shared_bed_child", category: "lifestyle", section: "nighttime" },
  { key: "sleep_aid", category: "drugs", section: "nighttime" },
  { key: "sore_throat", category: "health", section: "status" },
  { key: "stress", category: "mental", section: "status" },
  { key: "stretching", category: "recovery", section: "daytime" },
  { key: "therapy", category: "mental", section: "daytime" },
  { key: "travel", category: "lifestyle", section: "status" },
]

export const BEHAVIORS: readonly Behavior[] = RAW.map((r) => withText({ ...r }, { label: `behavior.${r.key}`, question: `question.${r.key}` }))

const BY_KEY = new Map(BEHAVIORS.map((b) => [b.key, b]))
export const behavior = (key: string): Behavior | undefined => BY_KEY.get(key)

/** The journal's question for a tag: the catalogue sentence, or a custom label as a question. */
export const questionOf = (tag: string, label: string) => behavior(tag)?.question ?? i18n.t("journal:question.custom", { label })

/** A follow-up value as words: "3:30 PM" or "3". */
export function followUpText(f: FollowUp, v: number) {
  if (f.kind === "count") return String(v)
  const h = Math.floor(v / 60) % 24
  return `${h % 12 || 12}:${String(v % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}
