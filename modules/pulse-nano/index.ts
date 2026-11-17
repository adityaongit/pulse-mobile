export type NanoStatus = { state: "available" | "downloadable" | "downloading" | "unavailable" | "unsupported"; model: string | null; reason?: string };
type Native = {
  status(): Promise<NanoStatus>;
  prepare(): Promise<NanoStatus>;
  generate(prompt: string, maxOutputTokens: number, signalId: string): Promise<string>;
  cancel(signalId: string): void;
};
let cached: Native | null | undefined;
function getNative(): Native | null {
  if (cached !== undefined) return cached;
  try {
    // Keep native module resolution lazy so the provider registry can load in web and test environments.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo").requireOptionalNativeModule("PulseNano") as Native | null;
  } catch {
    cached = null;
  }
  return cached ?? null;
}

export const nanoModuleAvailable = () => getNative() !== null;
export const nanoStatus = (): Promise<NanoStatus> => getNative()?.status() ?? Promise.resolve({ state: "unsupported", model: null, reason: "native_module_missing" });
export const prepareNano = (): Promise<NanoStatus> => getNative()?.prepare() ?? Promise.resolve({ state: "unsupported", model: null, reason: "native_module_missing" });
export const generateNano = (prompt: string, maxOutputTokens = 256, signalId = "request"): Promise<string> => {
  const native = getNative();
  if (!native) return Promise.reject(new Error("nano_unavailable"));
  return native.generate(prompt, Math.max(1, Math.min(maxOutputTokens, 256)), signalId);
};
export const cancelNano = (signalId: string) => getNative()?.cancel(signalId);
