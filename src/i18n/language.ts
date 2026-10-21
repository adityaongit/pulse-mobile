// The language: the stored choice and the phone's. The choice is in AsyncStorage, not the profile, because it is needed
// before a profile exists (onboarding) and in the headless background task.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { LANGUAGES, PSEUDO, matchLanguage, showPseudo, type LanguageChoice, type LanguageCode } from "./config";

export const LANGUAGE_KEY = "pulse.language";

export async function readChoice(): Promise<LanguageChoice> {
  const v = await AsyncStorage.getItem(LANGUAGE_KEY).catch(() => null);
  return LANGUAGES.some((l) => l.code === v) || (showPseudo && v === PSEUDO) ? (v as LanguageCode) : "auto";
}

export const saveChoice = (choice: LanguageChoice) => AsyncStorage.setItem(LANGUAGE_KEY, choice).catch(() => undefined);

/** The language a choice means: the phone's (which follows Android's per-app language) for "auto". */
export function resolveChoice(choice: LanguageChoice): LanguageCode {
  return choice === "auto" ? matchLanguage(getLocales().map((l) => l.languageTag)) : choice;
}

export async function resolveLanguage(): Promise<LanguageCode> {
  return resolveChoice(await readChoice());
}

/** The Intl locale for a language: its tag, with the phone's region when the phone speaks the same language (`de` + AT). */
export function localeFor(language: LanguageCode): string {
  const base = language.split("-")[0];
  const same = getLocales().find((l) => l.languageCode === base && l.regionCode);
  return language.includes("-") ? language : same ? `${base}-${same.regionCode}` : language;
}
