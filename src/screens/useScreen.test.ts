import { describe, expect, it, vi } from "vitest";
import { keepEqual } from "./keepEqual";

let version = 0;
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("../ui/shells/useScreenReady", () => ({ useScreenReady: () => true }));
vi.mock("@/state/app", () => ({ dataVersion: () => version, dataChanged: () => version++, queryCtx: () => ({}), useDataVersion: () => version }));
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
const { prefetch } = await import("./useScreen");

describe("keepEqual", () => {
  it("keeps the old object when the new one is equal", () => {
    const prev = { day: "2026-10-01", tiles: [{ k: "water", ml: 500 }], at: null };
    expect(keepEqual(prev, structuredClone(prev))).toBe(prev);
  });

  it("swaps in only the parts that changed", () => {
    const prev = { strip: [{ day: "a", done: true }], log: { water: { ml: 500 }, weight: { kg: 70 } } };
    const next = { strip: [{ day: "a", done: true }], log: { water: { ml: 750 }, weight: { kg: 70 } } };
    const out = keepEqual(prev, next);
    expect(out).toEqual(next);
    expect(out).not.toBe(prev);
    expect(out.strip).toBe(prev.strip);
    expect(out.log.weight).toBe(prev.log.weight);
    expect(out.log.water).not.toBe(prev.log.water);
  });

  it("sees added, removed and renamed keys and longer arrays", () => {
    expect(keepEqual({ a: 1 }, { a: 1, b: undefined })).toEqual({ a: 1, b: undefined });
    expect(keepEqual({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(keepEqual({ a: undefined }, { b: undefined })).toEqual({ b: undefined });
    expect(keepEqual([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(keepEqual([1, 2, 3], [1, 2])).toEqual([1, 2]);
  });

  it("treats NaN as equal and other kinds of object as changed", () => {
    const prev = { v: NaN, when: new Date(0) };
    const out = keepEqual(prev, { v: NaN, when: new Date(0) });
    expect(out).not.toBe(prev);
    expect(out.when).not.toBe(prev.when);
  });
});

describe("the screen cache", () => {
  const gate = () => {
    let open!: () => void;
    return { wait: new Promise<void>((r) => (open = r)), open };
  };

  it("does not let a load started before a data change stand in for one after it", async () => {
    const first = gate();
    const calls: number[] = [];
    const query = async () => {
      calls.push(version);
      if (calls.length === 1) await first.wait;
      return { v: calls.length };
    };
    const a = prefetch(query, ["stale-load"]);
    await Promise.resolve();
    version++; // a write lands while the first read runs
    const b = prefetch(query, ["stale-load"]);
    await b; // the newer read lands first
    first.open();
    await a; // the older one lands late and is dropped
    expect(calls).toEqual([0, 1]);
    await prefetch(query, ["stale-load"]); // the newer result is fresh: nothing reloads
    expect(calls).toEqual([0, 1]);
  });

  it("joins a load already running for the same data", async () => {
    let n = 0;
    const query = async () => ({ n: ++n });
    await Promise.all([prefetch(query, ["joined"]), prefetch(query, ["joined"])]);
    expect(n).toBe(1);
  });

  it("reads a screen again in a new language: a result written in another one is not fresh", async () => {
    const { i18n } = await import("@/i18n/config");
    let n = 0;
    const query = async () => ({ n: ++n, text: i18n.t("common:today") });
    await prefetch(query, ["language"]);
    await prefetch(query, ["language"]);
    expect(n).toBe(1);
    await i18n.changeLanguage("de");
    await prefetch(query, ["language"]);
    expect(n).toBe(2);
    await i18n.changeLanguage("en");
  });
});
