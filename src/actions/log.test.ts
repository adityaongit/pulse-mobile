// Ported from pulse src/server/actions/log.test.ts: validation, the entries built, the not-connected answer, the
// reconnect check and the delete. "Signed out" and "demo mode" have no counterpart; what replaces demo is the answer a
// phone with no Google token source gives (RECONNECT, nothing stored).
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testStore } from "../data/testing";
import type { Store } from "../data/repos";
import type { LogWriter } from "../google/log";
import { GoogleError } from "../google/oauth";
import { LOG_MESSAGE } from "../google/logging";
import { LOG_TYPES, RECONNECT, scopeUrl } from "@/lib/log";
import { saveProfile } from "../profile";
import { deleteLogEntry, logEntry } from "./log";

const h = vi.hoisted(() => ({ changed: vi.fn(), uuid: vi.fn() }));
vi.mock("../screens/useScreen", () => ({ dataChanged: h.changed }));
vi.mock("expo-crypto", () => ({ randomUUID: h.uuid }));

const NOW = Date.parse("2026-10-02T06:00:00Z") / 1000; // 11:30 in Kolkata
const NAME = "users/1/dataTypes/x/dataPoints/1";
let store: Store;
const fake = (o: Partial<LogWriter> = {}) => ({ create: vi.fn(async () => NAME), batchDelete: vi.fn(async () => {}), exists: vi.fn(async () => true), ...o }) satisfies LogWriter;
const rows = async () => (await Promise.all(LOG_TYPES.map((t) => store.log.heldEntries(t, 0, 2 ** 40)))).flat();
const sex = (s: "male" | "female") => saveProfile(store, { birthDate: "1990-01-01", sex: s, maxHr: null, heightCm: null, timeZone: "Asia/Kolkata" });
const grant = (scopes: string[]) => store.settings.set("google.grant", { scope: scopes.join(" "), revokedAt: null, updatedAt: NOW });
const log = (input: Parameters<typeof logEntry>[1], writer = fake()) => logEntry(store, input, { writer, now: NOW });

beforeEach(async () => {
  store = testStore();
  await sex("male");
  h.changed.mockClear();
  h.uuid.mockReset().mockImplementation(() => randomUUID());
});

describe("logEntry", () => {
  it("with no Google token source it answers not connected, stores nothing and writes nothing", async () => {
    expect(await logEntry(store, { kind: "water", ml: 250 }, { now: NOW })).toEqual({ ok: false, error: RECONNECT });
    expect(await rows()).toEqual([]);
    expect(h.changed).not.toHaveBeenCalled();
  });

  it("a profile is needed first", async () => {
    expect(await logEntry(testStore(), { kind: "water", ml: 250 }, { now: NOW })).toEqual({ ok: false, error: "Finish setting up your profile first" });
  });

  it("validates before anything else, even when not connected", async () => {
    expect(await logEntry(store, { kind: "water", ml: 0 }, { now: NOW })).toEqual({ ok: false, error: "At least 10 ml" });
    expect(await logEntry(store, { kind: "mood", moods: [], valence: null }, { now: NOW })).toEqual({ ok: false, error: "Choose how you feel" });
    expect(await logEntry(store, { kind: "weight", kg: 19, fatPct: null }, { now: NOW })).toEqual({ ok: false, error: "Between 20 and 300 kg" });
    expect(await logEntry(store, { kind: "food", name: "", meal: "LUNCH", kcal: 10_001, protein: null, carbs: null, fat: null }, { now: NOW })).toEqual({ ok: false, error: "At most 10,000 kcal" });
  });

  it("checks the time, and writes weight and body fat as two points a moment-equal ts", async () => {
    await grant([scopeUrl("weight")]);
    expect(await log({ kind: "weight", kg: 72.44, fatPct: null, at: "2026-10-02T12:00" })).toEqual({ ok: false, error: "Can’t log the future" });
    expect(await log({ kind: "weight", kg: 72.44, fatPct: null, at: "2025-09-01T12:00" })).toEqual({ ok: false, error: "Can’t log more than a year back" });
    expect(await log({ kind: "weight", kg: 72.44, fatPct: 18.26, at: "2026-10-02T08:00" })).toEqual({ ok: true, data: { needsSync: true } });
    expect((await rows()).map((r) => [r.type, r.data, r.ts]).sort()).toEqual([
      ["body-fat", { pct: 18.3 }, Date.parse("2026-10-02T02:30:00Z") / 1000],
      ["weight", { kg: 72.4 }, Date.parse("2026-10-02T02:30:00Z") / 1000],
    ]);
    expect(h.changed).toHaveBeenCalledTimes(1);
  });

  it("refuses cycle logging and cycle symptoms on a male profile, allows them on a female one", async () => {
    await grant([scopeUrl("menstrual-period"), scopeUrl("symptoms")]);
    const period = { kind: "period", start: "2026-09-29", end: "2026-10-01", flow: "LIGHT" } as const;
    expect(await log(period)).toEqual({ ok: false, error: "Not available for this profile" });
    expect(await log({ kind: "ovulation", result: "POSITIVE" })).toMatchObject({ ok: false });
    expect(await log({ kind: "symptoms", symptoms: ["CRAMPS"] })).toMatchObject({ ok: false });
    expect(await rows()).toEqual([]);
    await sex("female");
    expect(await log(period)).toMatchObject({ ok: true });
    expect(await log({ kind: "period", start: "2026-10-01", end: "2026-09-30", flow: null })).toEqual({ ok: false, error: "The last day is before the first" });
    expect(await log({ kind: "period", start: "2026-10-01", end: "2026-10-03", flow: null })).toEqual({ ok: false, error: "Can’t log a future day" });
    expect(await log({ kind: "period", start: "2026-09-01", end: "2026-09-20", flow: null })).toEqual({ ok: false, error: "A period is 15 days at most" });
    expect((await rows()).map((r) => r.type)).toEqual(["menstrual-period"]);
  });

  it("a grant without the write scope asks for a reconnect before calling Google; water needs only nutrition's", async () => {
    await grant([scopeUrl("hydration-log")]);
    const w = fake();
    expect(await log({ kind: "mood", moods: ["CALM"], valence: null }, w)).toEqual({ ok: false, error: RECONNECT });
    expect(w.create).not.toHaveBeenCalled();
    expect(await log({ kind: "water", ml: 500 }, w)).toEqual({ ok: true, data: { needsSync: true } });
    expect(w.create).toHaveBeenCalledWith("hydration-log", expect.objectContaining({ hydrationLog: expect.anything() }));
    expect((await rows())[0]).toMatchObject({ googleName: NAME, day: "2026-10-02", data: { ml: 500 }, source: "pulse" });
  });

  it("ids come from expo-crypto's randomUUID", async () => {
    await grant([scopeUrl("hydration-log")]);
    h.uuid.mockReturnValueOnce("11111111-1111-4111-8111-111111111111");
    await log({ kind: "water", ml: 250 });
    expect((await rows()).map((r) => r.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("water, food and weight rewind their sync cursor to the entry's day so the sync brings the total home; a mood does not need a sync", async () => {
    await grant([scopeUrl("hydration-log"), scopeUrl("moods")]);
    await store.settings.setSyncState("hydration-log", { syncedThrough: NOW });
    await log({ kind: "water", ml: 250, at: "2026-09-30T08:00" });
    expect((await store.settings.getSyncState("hydration-log"))?.syncedThrough).toBe(Date.parse("2026-09-29T18:30:00Z") / 1000);
    expect(await log({ kind: "mood", moods: ["CALM"], valence: null })).toEqual({ ok: true, data: { needsSync: false } });
  });

  it("Google refusing the write says so and keeps nothing for it", async () => {
    await grant([scopeUrl("hydration-log")]);
    const w = fake({ create: vi.fn(async () => Promise.reject(new GoogleError("http_500", 500))) });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await log({ kind: "water", ml: 250 }, w)).toEqual({ ok: false, error: LOG_MESSAGE.failed });
    expect(await rows()).toEqual([]);
  });
});

describe("deleteLogEntry", () => {
  const add = (o: { googleName: string | null; source?: "pulse" | "google" }) => {
    const id = randomUUID();
    return store.log.insertEntry({ id, type: "hydration-log", ts: NOW, day: "2026-10-02", data: { ml: 250 }, googleName: o.googleName, source: o.source ?? "pulse", createdAt: NOW }).then(() => id);
  };

  it("needs a valid id, then deletes an entry that never left the phone, with no token source", async () => {
    const id = await add({ googleName: null });
    expect(await deleteLogEntry(store, { id: "nope" })).toMatchObject({ ok: false });
    expect(await deleteLogEntry(store, { id })).toEqual({ ok: true, data: { needsSync: true } });
    expect(await rows()).toEqual([]);
    expect(h.changed).toHaveBeenCalledTimes(1);
  });

  it("an entry Google holds is not deleted here without a way to delete it there", async () => {
    const id = await add({ googleName: NAME });
    expect(await deleteLogEntry(store, { id })).toEqual({ ok: false, error: RECONNECT });
    expect(await rows()).toHaveLength(1);
  });

  it("deletes at Google, then here, and has the sync re-read the day", async () => {
    await grant([scopeUrl("hydration-log")]);
    const id = await add({ googleName: NAME });
    await store.settings.setSyncState("hydration-log", { syncedThrough: NOW });
    const w = fake();
    expect(await deleteLogEntry(store, { id }, { writer: w })).toEqual({ ok: true, data: { needsSync: true } });
    expect(w.batchDelete).toHaveBeenCalledWith("hydration-log", [NAME]);
    expect(await rows()).toEqual([]);
    expect((await store.settings.getSyncState("hydration-log"))?.syncedThrough).toBe(Date.parse("2026-10-01T18:30:00Z") / 1000);
  });

  it("another app's entry that Google will not delete stays, with the web's message", async () => {
    await grant([scopeUrl("hydration-log")]);
    const id = await add({ googleName: NAME, source: "google" });
    const w = fake({ batchDelete: vi.fn(async () => Promise.reject(new GoogleError("http_403", 403))) });
    expect(await deleteLogEntry(store, { id }, { writer: w })).toEqual({ ok: false, error: LOG_MESSAGE.foreign });
    expect(await rows()).toHaveLength(1);
  });
});
