import { requireOptionalNativeModule } from "expo";

type Native = {
  notificationsEnabled(): Promise<boolean>;
  start(config: string): Promise<string>;
  command(id: string, action: string): Promise<string>;
  active(): Promise<string | null>;
  pending(): Promise<string>;
  samples(id: string, offset: number): Promise<string>;
  acknowledge(id: string, revision: number): Promise<void>;
  resetPending(): Promise<boolean>;
  beginReset(): Promise<void>;
  finishReset(): Promise<void>;
};
const native = requireOptionalNativeModule<Native>("PulseWorkouts");
export const workoutNativeAvailable = !!native;
function required(): Native {
  if (!native) throw new Error("nativeUnavailable");
  return native;
}
/** Native owns the Bluetooth link and journal even when the React screen is gone. */
export const workoutNative = {
  notificationsEnabled: () => required().notificationsEnabled(),
  start: (config: unknown) => required().start(JSON.stringify(config)),
  command: (id: string, action: "pause" | "resume" | "finish") => required().command(id, action),
  active: () => required().active(),
  pending: () => required().pending(),
  samples: (id: string, offset: number) => required().samples(id, offset),
  acknowledge: (id: string, revision: number) => required().acknowledge(id, revision),
  resetPending: () => required().resetPending(),
  beginReset: () => required().beginReset(),
  finishReset: () => required().finishReset(),
};
