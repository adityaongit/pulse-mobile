import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => void store.set(k, v) },
}));
vi.mock("react-native", () => ({ Platform: { OS: "android", Version: 35 }, PermissionsAndroid: { check: vi.fn(async () => true), PERMISSIONS: { BLUETOOTH_CONNECT: "c" } } }));
vi.mock("@/lib/telemetry", () => ({ report: vi.fn() }));
const air = { hasAir: vi.fn(() => true), readBattery: vi.fn() };
vi.mock("../../modules/pulse-air", () => air);

const HOUR = 60 * 60_000;

async function fresh() {
  vi.resetModules();
  return import("./airBattery");
}

describe("refreshAirBattery", () => {
  beforeEach(() => {
    store.clear();
    vi.useFakeTimers({ now: 1_000_000_000_000, toFake: ["Date"] });
    air.hasAir.mockReturnValue(true);
    air.readBattery.mockReset().mockResolvedValue({ percent: 37, charging: false });
  });

  it("reads at most once an hour, failures included, and keeps the last reading", async () => {
    const m = await fresh();
    await m.refreshAirBattery();
    expect(air.readBattery).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get(m.KEY)!).reading).toMatchObject({ percent: 37, charging: false });

    vi.setSystemTime(Date.now() + HOUR - 1);
    await m.refreshAirBattery();
    expect(air.readBattery).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    air.readBattery.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "TIMEOUT" }));
    await m.refreshAirBattery();
    expect(air.readBattery).toHaveBeenCalledTimes(2);
    expect(JSON.parse(store.get(m.KEY)!).reading.percent).toBe(37);

    // A restart reads the saved try time: still throttled.
    const again = await fresh();
    await again.refreshAirBattery();
    expect(air.readBattery).toHaveBeenCalledTimes(2);
  });

  it("never tries, or counts a try, without a paired Fitbit Air", async () => {
    air.hasAir.mockReturnValue(false);
    const m = await fresh();
    await m.refreshAirBattery();
    expect(air.readBattery).not.toHaveBeenCalled();
    expect(store.has(m.KEY)).toBe(false);
  });

  it("shows a reading for 12 hours", async () => {
    const { shownBattery, SHOW_FOR_MS } = await fresh();
    const r = { percent: 50, charging: null, at: 0 };
    expect(shownBattery(r, SHOW_FOR_MS - 1)).toBe(r);
    expect(shownBattery(r, SHOW_FOR_MS)).toBeNull();
  });
});
