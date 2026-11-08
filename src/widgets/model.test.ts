import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import type { Profile } from "@/data/types";
import { getHome } from "@/queries/home";
import { buildWidgetSnapshot, heartRateMetric, widgetMetric, WIDGET_KEYS } from "./model";

const profile: Profile = { birthDate: "1990-01-01", sex: "male", maxHr: 183, heightCm: 178, timeZone: "Asia/Kolkata" };

describe("widget projection", () => {
  it("preserves a real zero and an above-100 strain, capping only the progress track", () => {
    expect(widgetMetric("steps", { value: 0, reason: null, provisional: false })).toMatchObject({ value: 0, display: "0", reason: null });
    expect(widgetMetric("strain", { value: 129, reason: null, provisional: true })).toMatchObject({ value: 129, display: "129", progress: 100, provisional: true });
  });
  it.each([[33, "#ff0026"], [34, "#e5c300"], [66, "#e5c300"], [67, "#12c805"]] as const)("matches the recovery dial color at %s", (value, color) => {
    expect(widgetMetric("recovery", { value, reason: null, provisional: false }).color).toBe(color);
  });
  it.each([null, NaN, Infinity, -Infinity])("does not fabricate a number for %s", (value) => {
    expect(widgetMetric("recovery", { value, reason: "calibrating", provisional: true, nightsLeft: 3 })).toMatchObject({ value: null, display: "--", progress: null, reason: "Calibrating", provisional: true });
  });
  it("projects the existing Home query, including its empty/calibration states", async () => {
    const store = new MemoryStore();
    await store.setProfile(profile);
    const sync = await store.getSyncState();
    const home = await getHome("2026-10-29", { store, profile, timeZone: profile.timeZone, today: "2026-10-29", now: 1793260800, sync });
    const snapshot = buildWidgetSnapshot(home, { generatedAt: 1793260800, lastSyncTs: null, source: "health_connect", timeZone: profile.timeZone });
    expect(snapshot.metrics.map((m) => m.key)).toEqual(WIDGET_KEYS);
    expect(snapshot.metrics.find((m) => m.key === "recovery")?.value).toBe(home.dials.recovery.value);
    expect(snapshot.metrics.find((m) => m.key === "hrv")?.value).toBeNull();
    expect(snapshot.metrics.find((m) => m.key === "stress")?.value).toBeNull();
    expect(snapshot.metrics.every((m) => m.value === null || Number.isFinite(m.value))).toBe(true);
    expect(snapshot).toMatchObject({ day: home.day, source: "health_connect", lastSyncTs: null });
    home.stress = { value: { value: 72, level: "high", at: 1793260800000, dayAverage: false }, reason: null, provisional: true };
    expect(buildWidgetSnapshot(home, { generatedAt: 1793260800, lastSyncTs: 1793260700, source: "demo", timeZone: profile.timeZone }).metrics.find((m) => m.key === "stress")).toMatchObject({ value: 72, provisional: true });
  });
});


describe("stored heart rate", () => {
  const now = 1793260800;
  it("keeps the sample time separate from sync time, and leaves missing minutes as gaps", () => {
    const latest = { ts: now - 8 * 60, bpm: 84 };
    const metric = heartRateMetric({ latest, samples: [{ ts: latest.ts - 29 * 60, bpm: 70 }, latest] }, now);
    expect(metric).toMatchObject({ value: 84, display: "84", unit: "bpm", observedAt: latest.ts, href: "pulse://health/heart-rate" });
    expect(metric.trend).toHaveLength(30);
    expect(metric.trend?.at(-1)).toBe(84);
    expect(metric.trend?.[10]).toBeNull();
    expect(metric.progress).toBeNull();
  });
  it.each([0, NaN, Infinity, -10])("rejects an unusable heart rate %s", (bpm) => {
    expect(heartRateMetric({ latest: { ts: now - 60, bpm }, samples: [] }, now)).toMatchObject({ value: null, observedAt: null, trend: [] });
  });
  it("does not publish a future reading or invent data when no samples exist", () => {
    expect(heartRateMetric({ latest: { ts: now + 1, bpm: 75 }, samples: [] }, now).value).toBeNull();
    expect(heartRateMetric(undefined, now)).toMatchObject({ value: null, trend: [], observedAt: null });
  });
  it("excludes invalid and post-reading points without synthesizing a line", () => {
    const latest = { ts: now - 60, bpm: 84 };
    const metric = heartRateMetric({ latest, samples: [latest, { ts: now, bpm: 999 }, { ts: now - 120, bpm: 0 }] }, now);
    expect(metric.trend?.filter((v) => v !== null)).toEqual([84]);
  });
});
