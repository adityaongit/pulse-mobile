import { beforeEach, expect, it, vi } from "vitest";
import { activateProvider, apiKey, coachSetup, removeAllProviders, removeProvider, saveProvider } from "./storage";
const { plain, secure } = vi.hoisted(() => ({ plain: new Map<string, string>(), secure: new Map<string, string>() }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async (key: string) => plain.get(key) ?? null, setItem: async (key: string, value: string) => { plain.set(key, value); } } }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1, getItemAsync: async (key: string) => secure.get(key) ?? null, setItemAsync: async (key: string, value: string) => { secure.set(key, value); }, deleteItemAsync: async (key: string) => { secure.delete(key); } }));
vi.mock("@/state/app", () => ({ appStore: () => ({}) }));
beforeEach(() => { plain.clear(); secure.clear(); });
it("retains a cloud key and model across Nano switches without putting secrets in ordinary storage", async () => {
  await saveProvider({ provider: "openai", model: "model-a", apiKey: "secret-cloud-key", baseUrl: null });
  await saveProvider({ provider: "nano", model: "gemini-nano", apiKey: null, baseUrl: null });
  expect(await apiKey()).toBeNull();
  await activateProvider("openai");
  expect(await apiKey()).toBe("secret-cloud-key");
  expect((await coachSetup()).model).toBe("model-a");
  expect([...plain.values()].join()).not.toContain("secret-cloud-key");
});
it("migrates the legacy key before switching and preserves another profile when removing one", async () => {
  plain.set("pulse.coach.setup", JSON.stringify({ provider: "custom", model: "local-model", baseUrl: "https://example.test/v1", last4: "-key" }));
  secure.set("pulse.coach.apiKey", "legacy-key");
  await saveProvider({ provider: "nano", model: "gemini-nano", apiKey: null, baseUrl: null });
  await removeProvider();
  await activateProvider("custom");
  expect(await apiKey()).toBe("legacy-key");
  expect((await coachSetup()).baseUrl).toBe("https://example.test/v1");
  await removeAllProviders();
  expect(secure.size).toBe(0);
});
