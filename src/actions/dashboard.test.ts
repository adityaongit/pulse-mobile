import { beforeEach, expect, it, vi } from "vitest";
import { testStore } from "../data/testing";
import { dashboardKeys } from "../queries/home";
import { saveDashboard } from "./dashboard";

// dataChanged lives in useScreen.ts, which imports expo-router and the app's database: not loadable in Node.
const h = vi.hoisted(() => ({ changed: vi.fn() }));
vi.mock("../screens/useScreen", () => ({ dataChanged: h.changed }));

const store = testStore();
beforeEach(async () => {
  await store.settings.saveDashboard([]);
  await store.samples.clearSynced();
  h.changed.mockClear();
});

it("saves the chosen metrics in order and tells every screen to reload", async () => {
  expect(await saveDashboard(store, { keys: ["steps", "hrv", "sleep"] })).toEqual({ ok: true, data: undefined });
  expect(await store.settings.dashboardKeys()).toEqual(["steps", "hrv", "sleep"]);
  expect(await dashboardKeys(store)).toEqual(["steps", "hrv", "sleep"]);
  expect(h.changed).toHaveBeenCalledOnce();
});

it("rejects unknown, repeated or no metrics, writing nothing", async () => {
  await saveDashboard(store, { keys: ["hrv"] });
  h.changed.mockClear();
  for (const keys of [["hrv", "not_a_metric"], ["hrv", "hrv"], [], ["__proto__"]]) expect(await saveDashboard(store, { keys })).toMatchObject({ ok: false });
  expect(await store.settings.dashboardKeys()).toEqual(["hrv"]);
  expect(h.changed).not.toHaveBeenCalled();
});

it("the default list is stored as no rows: phone metrics until heart rate syncs, then the reference app's rows", async () => {
  await saveDashboard(store, { keys: ["steps"] });
  await saveDashboard(store, { keys: ["steps", "distance", "calories", "active_minutes", "active_calories", "floors"] });
  expect(await store.settings.dashboardKeys()).toEqual([]);
  await store.samples.writeSamples("hr", [{ ts: 60, v: 60 }]);
  await saveDashboard(store, { keys: ["hrv", "sleep", "consistency", "hours", "stress", "rhr", "vo2max", "steps"] });
  expect(await store.settings.dashboardKeys()).toEqual([]);
});
