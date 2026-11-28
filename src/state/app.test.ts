// What brings the screens up to date without a pull: coming back to Pulse, and a background run in the app's runtime.
// No phone: AppState, the run and the native modules are fakes; the Store is in memory.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/data/memory";
import type { Profile } from "@/data/types";

const fake = vi.hoisted(() => ({
  store: null as unknown as import("@/data/store").Store,
  storage: new Map<string, string>(),
  appState: [] as ((next: string) => void)[],
  taskRun: null as (() => void) | null,
  runSync: vi.fn(async (store: import("@/data/store").Store) => {
    await store.setSyncState({ lastSyncTs: Math.floor(Date.now() / 1000), lastError: null });
    return { ran: true, warnings: [] as string[] };
  }),
}));

vi.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: (_: string, l: (next: string) => void) => (fake.appState.push(l), { remove: () => {} }) } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => fake.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => void fake.storage.set(k, v),
    removeItem: async (k: string) => void fake.storage.delete(k),
    multiRemove: async (ks: string[]) => ks.forEach((k) => fake.storage.delete(k)),
  },
}));
vi.mock("@/background/runSync", () => ({
  runSync: fake.runSync,
  registerAppStore: () => {},
  markUiRuntime: () => {},
  onTaskRun: (fn: (() => void) | null) => void (fake.taskRun = fn),
}));
vi.mock("@/background/startup", () => ({ startBackground: async () => {} }));
vi.mock("@/widgets/publish", () => ({ refreshWidgets: async () => {}, clearWidgets: async () => {} }));
vi.mock("../../modules/pulse-workouts", () => ({ workoutNative: {}, workoutNativeAvailable: false }));
vi.mock("@/data/db", () => ({ openStore: async () => fake.store }));
vi.mock("@/health/connect", () => ({ availability: async () => "available", permissionState: async () => ({ granted: ["Steps"], background: true }), askPermissions: async () => ({ granted: [] }) }));
vi.mock("@/health/sync", () => ({ forgetChanges: async () => {} }));
vi.mock("@/i18n/language", () => ({ readChoice: async () => "en", saveChoice: async () => {}, resolveChoice: () => "en", localeFor: () => "en-US" }));
vi.mock("@/lib/telemetry", () => ({ report: vi.fn(), resetTelemetryId: vi.fn() }));
vi.mock("@/actions/photo", () => ({ deletePhoto: () => {}, deleteAllPhotos: () => {} }));
vi.mock("@/data/seed", () => ({ seedDemo: vi.fn() }));
vi.mock("@/data/seedFood", () => ({ seedDemoFood: vi.fn() }));
vi.mock("./display", () => ({ applyDisplay: () => {} }));
vi.mock("./update", () => ({ checkForUpdate: async () => {} }));

const { appState, boot, dataVersion, isSyncing } = await import("./app");

const PROFILE: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: null, heightCm: 180, timeZone: "UTC" } as Profile;
const T0 = Date.UTC(2026, 10, 28, 8);
const emit = (next: string) => fake.appState.forEach((l) => l(next));

describe("staying current without a pull", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    fake.store = new MemoryStore();
    await fake.store.setProfile(PROFILE);
    await fake.store.setSyncState({ lastSyncTs: T0 / 1000 - 3600, lastError: null });
    fake.storage.set("pulse.source", "health_connect");
    await boot(() => {});
    await vi.waitFor(() => expect(isSyncing()).toBe(false));
  });
  afterAll(() => vi.useRealTimers());

  it("syncs when Pulse comes back after a few minutes away", async () => {
    const runs = fake.runSync.mock.calls.length;
    emit("background");
    vi.setSystemTime(T0 + 5 * 60_000);
    emit("active");
    expect(fake.runSync.mock.calls.length).toBe(runs + 1);
  });

  it("reloads the screens and the sync time after a background run in the app's runtime", async () => {
    await vi.waitFor(() => expect(isSyncing()).toBe(false));
    const before = dataVersion();
    const ts = T0 / 1000 + 1800;
    await fake.store.setSyncState({ lastSyncTs: ts, lastError: null });
    fake.taskRun?.();
    await vi.waitFor(() => expect(appState().sync.lastSyncTs).toBe(ts));
    expect(dataVersion()).toBeGreaterThan(before);
  });
});
