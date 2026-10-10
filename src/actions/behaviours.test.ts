// Ported from the behaviours cases of pulse src/server/actions/journal.test.ts (`addCustomTag`, `saveBehaviors`,
// `loadBehaviours`, `ensureDefaultTags`) onto the SQLite repositories; no users, no revalidation (`dataChanged` instead).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Store } from "../data/repos";
import { testStore } from "../data/testing";
import { saveProfile } from "../profile";
import { loadBehaviours, saveBehaviors } from "./behaviours";
import { addCustomTag } from "./journal";
import { DEFAULT_JOURNAL_TAGS, MAX_TAGS, tagKey } from "../journalTags";

const h = vi.hoisted(() => ({ changed: vi.fn() }));
vi.mock("../screens/useScreen", () => ({ dataChanged: h.changed }));

let store: Store;
const tags = () => store.journal.tags();
const shown = async () => (await tags()).filter((t) => !t.hidden).map((t) => t.tag).sort();

beforeEach(async () => {
  h.changed.mockClear();
  store = testStore();
  await saveProfile(store, { birthDate: "1990-01-01", sex: "male", maxHr: null, heightCm: null, timeZone: "Asia/Kolkata" });
  await store.journal.ensureDefaultTags([...DEFAULT_JOURNAL_TAGS]);
});

describe("tagKey", () => {
  it("makes snake_case keys and refuses a label with no letter or digit", () => {
    expect(tagKey("  Late  Workout! ")).toBe("late_workout");
    expect(tagKey("Cold plunge")).toBe("cold_plunge");
    expect(tagKey("!!!")).toBe("");
  });
});

describe("addCustomTag", () => {
  it("stops at MAX_TAGS, so insights work per recompute stays bounded", async () => {
    const have = (await tags()).length;
    for (let i = have; i < MAX_TAGS; i++) expect((await addCustomTag(store, { label: `Cap ${i}` })).ok).toBe(true);
    expect(await addCustomTag(store, { label: "One more" })).toEqual({ ok: false, error: `Too many behaviours: the limit is ${MAX_TAGS}` });
  });

  it("validates the label and rejects duplicates", async () => {
    expect(await addCustomTag(store, { label: "  Late  Workout! " })).toEqual({ ok: true, data: { tag: "late_workout" } });
    expect(await addCustomTag(store, { label: "late workout" })).toEqual({ ok: false, error: "Tag already exists: late_workout" });
    expect(await addCustomTag(store, { label: "Alcohol" })).toMatchObject({ ok: false });
    expect((await addCustomTag(store, { label: "   " })).ok).toBe(false);
    expect((await addCustomTag(store, { label: "!!!" })).ok).toBe(false);
    expect((await addCustomTag(store, { label: "x".repeat(41) })).ok).toBe(false);
    expect(h.changed).toHaveBeenCalledTimes(1);
  });

  it("puts a new behaviour after every existing one, as a custom (not default) tag", async () => {
    await addCustomTag(store, { label: "Cold plunge" });
    await addCustomTag(store, { label: "Nap" });
    const all = await tags();
    expect(all.slice(-2).map((t) => [t.tag, t.label, t.isDefault, t.hidden])).toEqual([
      ["cold_plunge", "Cold plunge", false, false],
      ["nap", "Nap", false, false],
    ]);
  });
});

describe("saveBehaviors", () => {
  it("hides a behaviour left out without touching its answers, and shows it again", async () => {
    await store.journal.saveEntry({ day: "2026-10-01", tag: "sauna", value: 1, detail: null });
    const all = (await tags()).map((t) => t.tag);
    expect(await saveBehaviors(store, { tags: all.filter((t) => t !== "sauna") })).toEqual({ ok: true, data: undefined });
    expect((await tags()).find((t) => t.tag === "sauna")?.hidden).toBe(true);
    expect(await store.journal.entriesBetween("2026-10-01", "2026-10-01")).toEqual([{ day: "2026-10-01", tag: "sauna", value: 1, detail: null }]);
    expect(await saveBehaviors(store, { tags: all })).toMatchObject({ ok: true });
    expect((await tags()).find((t) => t.tag === "sauna")?.hidden).toBe(false);
    expect(h.changed).toHaveBeenCalledTimes(2);
  });

  it("asks exactly the chosen behaviours: adds catalogue ones, hides the rest, refuses unknown keys whole", async () => {
    expect(await saveBehaviors(store, { tags: ["mouth_tape", "illness", "electrolytes"] })).toEqual({ ok: true, data: undefined });
    expect(await shown()).toEqual(["electrolytes", "illness", "mouth_tape"]);
    expect((await tags()).find((t) => t.tag === "mouth_tape")).toMatchObject({ label: "Mouth tape", isDefault: false });
    h.changed.mockClear();
    expect(await saveBehaviors(store, { tags: ["illness", "not_a_behaviour"] })).toEqual({ ok: false, error: "Unknown behaviour" });
    expect(await shown()).toEqual(["electrolytes", "illness", "mouth_tape"]);
    expect(h.changed).not.toHaveBeenCalled();
    await saveBehaviors(store, { tags: DEFAULT_JOURNAL_TAGS.map((d) => d.tag) });
    const r = await loadBehaviours(store);
    expect(r.ok && r.data.tags.find((t) => t.tag === "mouth_tape")).toMatchObject({ hidden: true, section: "nighttime", question: "Wore mouth tape while sleeping?" });
  });

  it("refuses a selection past MAX_TAGS", async () => {
    const have = (await tags()).length;
    for (let i = have; i < MAX_TAGS; i++) await addCustomTag(store, { label: `Cap ${i}` });
    expect(await saveBehaviors(store, { tags: ["mouth_tape"] })).toEqual({ ok: false, error: `Too many behaviours: the limit is ${MAX_TAGS}` });
  });
});

describe("loadBehaviours and the defaults", () => {
  it("lists the nine defaults, and ensuring them again changes nothing", async () => {
    expect(await store.journal.ensureDefaultTags([...DEFAULT_JOURNAL_TAGS])).toBe(0);
    const r = await loadBehaviours(store);
    expect(r.ok && r.data.tags).toHaveLength(DEFAULT_JOURNAL_TAGS.length);
    expect(r.ok && r.data.tags.every((t) => t.isDefault && !t.hidden)).toBe(true);
  });
});
