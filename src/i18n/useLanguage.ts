import { useSyncExternalStore } from "react";
import { i18n } from "./config";

const subscribe = (cb: () => void) => {
  i18n.on("languageChanged", cb);
  return () => i18n.off("languageChanged", cb);
};

/**
 * The language in use, re-read on a switch. The root layout keys the navigator on it, so every screen redraws: copy read
 * through `i18n.t` outside the hook (catalogues, view models) and calls React Compiler caches would otherwise stay in the old language.
 */
export const useLanguage = () => useSyncExternalStore(subscribe, () => i18n.language);
