// The profile gate (pulse's (app) layout sends a person without a profile to /onboarding): the root layout reads this
// once the database is migrated. `null` while the first read runs; `false` sends the person to onboarding; onboarding's
// save calls `profileSaved()` and the layout lets them in. The stored theme is applied in the same read, before the first
// frame, so a dark-mode person never sees a light flash.
import { useEffect, useSyncExternalStore } from "react";
import { colorScheme } from "nativewind";
import { store } from "@/data/store";

let has: boolean | null = null;
const listeners = new Set<() => void>();
const set = (v: boolean) => {
  has = v;
  for (const l of listeners) l();
};

/** Onboarding saved the profile: the gate opens. */
export const profileSaved = () => set(true);

/** Whether a profile exists: null until read. Pass `enabled` once the migrations have run. */
export function useProfileGate(enabled: boolean): boolean | null {
  useEffect(() => {
    if (!enabled || has !== null) return;
    let live = true;
    Promise.all([store.profile.getProfileRow(), store.settings.get("theme")])
      .then(([row, theme]) => {
        if (theme) colorScheme.set(theme);
        if (live) set(row !== null);
      })
      // A failed read must not strand the app on the splash screen: treat it as a person who is set up.
      .catch(() => live && set(true));
    return () => {
      live = false;
    };
  }, [enabled]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => has,
  );
}
