// The coach wired to the phone: the saved provider, model and key (storage.ts) over expo/fetch (net.ts), the chats in
// the app's Store, the person's query context from the app state, and the hooks the screens and the tab bar read. Not
// loaded by tests (native modules); transport.ts, tools.ts, workout.ts and validate.ts carry the logic and are tested.
import * as React from "react";
import type { QueryCtx } from "@/queries/ctx";
import { queryCtx } from "@/state/app";
import { deviceFetch } from "./net";
import { coachReady, modelFor } from "./providers";
import { apiKey, chatCount, coachSetup, loadChat, saveChat, subscribe, type CoachSetup } from "./storage";
import { CoachTransport, type CoachModel } from "./transport";
import { testKey, type ProviderInput } from "./validate";
import { workoutGlance } from "./workout";

/** The model for a turn: consent, a provider and model, and a key the keystore can read; else null. */
export async function deviceModel(): Promise<CoachModel | null> {
  const s = await coachSetup();
  if (!coachReady(s) || !s.provider || !s.model) return null;
  const model = modelFor({ provider: s.provider, model: s.model, apiKey: await apiKey(), baseUrl: s.baseUrl }, deviceFetch);
  return model ? { model, provider: s.provider, instructions: s.instructions } : null;
}

/** The person's query context as of now; null before onboarding. */
function currentCtx(): QueryCtx | null {
  try {
    return queryCtx();
  } catch {
    return null;
  }
}

/** useChat's transport for this person's chats. The context is read when each turn starts, as of that moment. */
export function deviceTransport(): CoachTransport {
  return new CoachTransport({
    ctx: currentCtx,
    model: deviceModel,
    load: loadChat,
    save: saveChat,
    onSaveError: (e) => console.warn(`[coach] saving the chat failed: ${e instanceof Error ? e.name : "error"}`),
  });
}

/** The coach's one-line take on a workout, from the phone (the activity screen's pill). */
export const deviceWorkoutGlance = (id: string) => workoutGlance({ ctx: currentCtx, model: deviceModel }, id);

/** The tiny test request, from the phone. */
export const testDeviceKey = (input: ProviderInput) => testKey(input, deviceFetch);

/** The setup (never the key), refreshed on every change; undefined while it loads. */
export function useCoachSetup(): CoachSetup | undefined {
  const [setup, setSetup] = React.useState<CoachSetup>();
  React.useEffect(() => {
    let live = true;
    const read = () => void coachSetup().then((s) => live && setSetup(s));
    read();
    const off = subscribe(read);
    return () => {
      live = false;
      off();
    };
  }, []);
  return setup;
}

/** Whether a provider key is saved: the phone's "has coach access" (the tab bar's round button opens the coach). */
export function useHasCoachKey(): boolean {
  const s = useCoachSetup();
  return coachReady(s);
}

/** How many chats are saved, refreshed on every change. */
export function useChatCount(): number | undefined {
  const [n, setN] = React.useState<number>();
  React.useEffect(() => {
    let live = true;
    const read = () => void chatCount().then((c) => live && setN(c), () => live && setN(0));
    read();
    const off = subscribe(read);
    return () => {
      live = false;
      off();
    };
  }, []);
  return n;
}
