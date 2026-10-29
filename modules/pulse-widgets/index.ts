// Optional for an older development build and for Node tests. A missing module is surfaced by the Settings UI.
import { requireOptionalNativeModule } from "expo";

type Native = { hasWidgets(): boolean; epoch(): Promise<number>; publish(snapshot: string, epoch: number): Promise<void>; clear(): Promise<void>; requestPin(size: string): boolean; isPinSupported(): boolean };
const native = requireOptionalNativeModule<Native>("PulseWidgets");
export const widgetsAvailable = () => native !== null;
export const hasWidgets = () => native?.hasWidgets() ?? false;
export const pinSupported = () => native?.isPinSupported() ?? false;
export const requestWidget = (size: "small" | "medium" | "large") => native?.requestPin(size) ?? false;
export const widgetEpoch = (): Promise<number> => native?.epoch() ?? Promise.resolve(0);
export const publishSnapshot = (snapshot: string, epoch: number): Promise<void> => native?.publish(snapshot, epoch) ?? Promise.resolve();
export const clearSnapshot = (): Promise<void> => native?.clear() ?? Promise.resolve();
