import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryCtx } from "@/queries/ctx";
import type { HomeVM } from "@/queries/types";
import { clearWidgets, refreshWidgets } from "./publish";

const mocks = vi.hoisted(() => ({ available: vi.fn(() => true), installed: vi.fn(() => true), epoch: vi.fn(async () => 7), publish: vi.fn(async () => {}), clear: vi.fn(async () => {}), readSource: vi.fn(async () => "health_connect" as string | null), home: vi.fn<(...args: unknown[]) => Promise<HomeVM>>(), build: vi.fn(() => ({ version: 1 })) }));
vi.mock("../../modules/pulse-widgets", () => ({ widgetsAvailable: mocks.available, hasWidgets: mocks.installed, widgetEpoch: mocks.epoch, publishSnapshot: mocks.publish, clearSnapshot: mocks.clear }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: mocks.readSource } }));
vi.mock("@/health/live", () => ({ storedRecentHeartRate: async () => ({ latest: null, samples: [] }) }));
vi.mock("@/queries/home", () => ({ getHome: mocks.home }));
vi.mock("./model", () => ({ buildWidgetSnapshot: mocks.build }));
const ctx = { store: { getProfile: async () => ({}) }, today: "2026-10-29", now: 1793260800, timeZone: "UTC", sync: { lastSyncTs: null } } as unknown as QueryCtx;

beforeEach(async () => {
  await clearWidgets();
  vi.clearAllMocks();
  mocks.available.mockReturnValue(true);
  mocks.installed.mockReturnValue(true);
  mocks.readSource.mockResolvedValue("health_connect");
  mocks.home.mockResolvedValue({} as HomeVM);
});
describe("widget publication", () => {
  it("leaves older development builds and missing native modules usable", async () => {
    mocks.available.mockReturnValue(false);
    await refreshWidgets(ctx, "health_connect");
    expect(mocks.home).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("avoids extra Home reads when no widget is installed, except during pin setup", async () => {
    mocks.installed.mockReturnValue(false);
    await refreshWidgets(ctx, "health_connect");
    expect(mocks.home).not.toHaveBeenCalled();
    await refreshWidgets(ctx, "health_connect", { force: true });
    expect(mocks.publish).toHaveBeenCalledOnce();
  });
  it("publishes through the existing Home query with the native invalidation epoch", async () => {
    await refreshWidgets(ctx, "health_connect");
    expect(mocks.home).toHaveBeenCalledWith(ctx.today, ctx);
    expect(mocks.publish).toHaveBeenCalledWith('{"version":1}', 7);
  });
  it("carries the sync-start epoch to native publication even after a reset in another runtime", async () => {
    await refreshWidgets(ctx, "health_connect", { epoch: 3 });
    expect(mocks.epoch).not.toHaveBeenCalled();
    expect(mocks.publish).toHaveBeenCalledWith('{"version":1}', 3);
  });
  it("rejects a source changed by onboarding or another runtime", async () => {
    mocks.readSource.mockResolvedValue("demo");
    await refreshWidgets(ctx, "health_connect");
    expect(mocks.home).not.toHaveBeenCalled();
    mocks.readSource.mockResolvedValueOnce("health_connect").mockResolvedValue("demo");
    await refreshWidgets(ctx, "health_connect");
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("does not restore an in-flight summary after reset", async () => {
    let finish!: (home: HomeVM) => void;
    mocks.home.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = refreshWidgets(ctx, "health_connect");
    await vi.waitFor(() => expect(mocks.home).toHaveBeenCalled());
    const clearing = clearWidgets();
    finish({} as HomeVM);
    await Promise.all([pending, clearing]);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalledOnce();
  });
  it("coalesces rapid display/data changes to the latest projection", async () => {
    await Promise.all([refreshWidgets(ctx, "health_connect"), refreshWidgets(ctx, "health_connect"), refreshWidgets(ctx, "health_connect")]);
    expect(mocks.publish).toHaveBeenCalledOnce();
  });
  it("does not let a widget failure break health sync", async () => {
    mocks.home.mockRejectedValueOnce(new Error("query unavailable"));
    await expect(refreshWidgets(ctx, "health_connect")).resolves.toBeUndefined();
    await refreshWidgets(ctx, "health_connect");
    expect(mocks.publish).toHaveBeenCalledOnce();
  });
});
