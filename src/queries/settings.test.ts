// Ported from pulse src/server/queries/settings.test.ts onto the F2 database (`seededCtx`): the sync rows and the grant
// are `settings` repository rows instead of oauth_tokens, and there is no demo mode.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SCOPES } from "../google/oauth";
import type { SyncStateRow } from "../data/repos/settings";
import { type QueryCtx, todayOf } from "./common";
import { getAppPrefs, getMore, getSettings, getShellStatus, getWearStreak, getYourData, hasCoachChats, syncErrorText } from "./settings";
import { getBehaviours } from "./journal";
import { seededCtx } from "./testing";

let ctx: QueryCtx;
beforeAll(async () => {
  ctx = await seededCtx();
}, 120_000);

const grant = (scope = SCOPES.join(" "), revokedAt: number | null = null) => ctx.store.settings.set("google.grant", { scope, revokedAt, updatedAt: 1 });
const put = async (rows: (Partial<SyncStateRow> & { type: string })[]) => {
  for (const { type, ...patch } of rows) await ctx.store.settings.setSyncState(type, patch);
};
// A connected account with no sync rows yet; every test starts from there.
beforeEach(async () => {
  await ctx.store.settings.clearSynced();
  await grant();
});

describe("sync errors", () => {
  it("read as a person would say them, keeping unknown codes", () => {
    expect(syncErrorText("[google] heart-rate: ACCOUNT_NOT_LINKED (HTTP 400)")).toBe("No Google Health profile");
    expect(syncErrorText("[google] steps dailyRollUp: RESOURCE_EXHAUSTED (HTTP 429)")).toBe("Rate limited, retrying");
    expect(syncErrorText("[google] sleep: http_503 (HTTP 503)")).toBe("Google is having trouble, retrying");
    expect(syncErrorText("[google] sleep: auth_revoked")).toBe("Access revoked");
    expect(syncErrorText("[google] sleep: INVALID_ARGUMENT (HTTP 400)")).toBe("Failed (INVALID_ARGUMENT)");
  });

  it("an account without Google Health is one problem: not_linked, no import progress, no per-row errors", async () => {
    await put(["heart-rate", "sleep"].map((type) => ({ type, backfillDaysDone: 0, backfillDaysTotal: 180, lastError: `[google] ${type}: ACCOUNT_NOT_LINKED (HTTP 400)` })));
    expect(await getShellStatus(ctx)).toMatchObject({ connection: "not_linked" });
    expect((await getShellStatus(ctx)).importProgress).toBeUndefined();
    const vm = await getSettings(ctx);
    expect(vm.source.status).toBe("not_linked");
    expect(vm.import).toBeNull();
    expect(vm.sync.every((r) => r.error === null)).toBe(true);
  });

  it("a retired job's leftover error row and an optional type's failure never turn the sync dot red or hold the import", async () => {
    await put([{ type: "heart-rate", backfillDaysDone: 180, backfillDaysTotal: 180, lastSuccessAt: ctx.now }]);
    await put([{ type: "rhr-personal-range", backfillDaysDone: 0, backfillDaysTotal: 180, lastError: "[google] daily-resting-heart-rate dailyRollUp: UNSUPPORTED_DATA_TYPE_ACTION" }]);
    await put([{ type: "electrocardiogram", backfillDaysDone: 0, backfillDaysTotal: 180, lastError: "[google] electrocardiogram: INVALID_DATA_POINT_FILTER" }]);
    const shell = await getShellStatus(ctx);
    expect(shell.sync.state).toBe("ok");
    expect(shell.importProgress).toBeUndefined();
    expect((await getSettings(ctx)).import).toBeNull();
  });

  it("a Google Health account with no paired device is one problem: no_device, no import progress, no sync error", async () => {
    await put([{ type: "heart-rate", backfillDaysDone: 30, backfillDaysTotal: 180, lastSuccessAt: ctx.now }]);
    await put([{ type: "paired-devices", lastSuccessAt: ctx.now, lastError: "[google] paired-devices: NO_PAIRED_DEVICE" }]);
    const shell = await getShellStatus(ctx);
    expect(shell).toMatchObject({ connection: "no_device", sync: { state: "ok" } });
    expect(shell.importProgress).toBeUndefined();
    const vm = await getSettings(ctx);
    expect(vm.source.status).toBe("no_device");
    expect(vm.import).toBeNull();
    expect(vm.sync.every((r) => r.error === null)).toBe(true);

    await ctx.store.settings.setSyncState("paired-devices", { lastError: null });
    expect((await getShellStatus(ctx)).connection).toBe("importing");
  });

  it("a working grant mid-import shows progress and readable row errors", async () => {
    await put([{ type: "heart-rate", backfillDaysDone: 30, backfillDaysTotal: 180, lastError: "[google] heart-rate: http_503 (HTTP 503)" }]);
    expect(await getShellStatus(ctx)).toMatchObject({ connection: "importing", importProgress: { done: 30, total: 180 } });
    expect((await getSettings(ctx)).sync.find((r) => r.key === "heart-rate")?.error).toBe("Google is having trouble, retrying");
  });
});

describe("the data source's state comes from the stored grant", () => {
  it("no grant is not_connected; a revoked one is revoked (and the sync dot says auth_revoked)", async () => {
    await ctx.store.settings.remove("google.grant");
    expect((await getSettings(ctx)).source).toEqual({ label: "Google Health", status: "not_connected", needsPermissions: false });
    expect((await getShellStatus(ctx)).connection).toBe("not_connected");
    await grant(SCOPES.join(" "), 1_700_000_000);
    expect((await getSettings(ctx)).source.status).toBe("revoked");
    expect((await getShellStatus(ctx)).connection).toBe("auth_revoked");
  });

  it("a grant from before the write scopes keeps syncing and asks for new permissions", async () => {
    await grant(SCOPES.filter((s) => s.endsWith("readonly")).join(" "));
    expect((await getSettings(ctx)).source).toEqual({ label: "Google Health", status: "connected", needsPermissions: true });
    await grant();
    expect((await getSettings(ctx)).source.needsPermissions).toBe(false);
  });

  it("lists every data type with its last success, stale after two hours and failing with a readable error", async () => {
    await put([
      { type: "heart-rate", lastSuccessAt: ctx.now - 600 },
      { type: "sleep", lastSuccessAt: ctx.now - 3 * 3600 },
      { type: "steps", lastError: "[google] steps: RESOURCE_EXHAUSTED (HTTP 429)" },
    ]);
    const by = Object.fromEntries((await getSettings(ctx)).sync.map((r) => [r.key, r]));
    expect(by["heart-rate"]).toMatchObject({ status: "ok", lastSuccessAt: (ctx.now - 600) * 1000, error: null });
    expect(by.sleep.status).toBe("stale");
    expect(by.steps).toMatchObject({ status: "error", error: "Rate limited, retrying" });
    expect(by.hrv).toMatchObject({ status: "never", lastSuccessAt: null });
  });

  it("the profile is the saved one, with its age", async () => {
    const { profile } = await getSettings(ctx);
    expect(profile).toMatchObject({ birthDate: ctx.profile.birthDate, sex: ctx.profile.sex, maxHr: ctx.profile.maxHr, timeZone: ctx.timeZone });
    expect(profile.age).toBeGreaterThan(12);
  });
});

describe("More, Your data and Behaviours", () => {
  beforeAll(async () => {
    // The seeded database holds F2's nine default tags (alcohol first); show only alcohol.
    await ctx.store.journal.showOnly(["alcohol"]);
  });

  it("More counts the behaviours and finds the latest finished week and month", async () => {
    const vm = await getMore(ctx);
    expect(vm.behaviours).toEqual({ total: 9, shown: 1 });
    expect(vm.reportCount).toBeGreaterThan(0);
    expect(vm.latestWeek?.period).toMatch(/^\d{4}-W\d{2}$/);
    expect(vm.latestMonth?.period).toMatch(/^\d{4}-\d{2}$/);
    expect(vm.scoringVersion).toBeGreaterThan(0);
  });

  it("Your data counts the scored days and the journal answers", async () => {
    const before = (await getYourData(ctx)).answers;
    await ctx.store.journal.saveEntry({ day: "2026-10-01", tag: "alcohol", value: 1, detail: null });
    await ctx.store.journal.saveEntry({ day: "2026-10-01", tag: "sauna", value: 0, detail: null });
    const vm = await getYourData(ctx);
    expect(vm.first).toBe(await ctx.store.scores.firstDay());
    expect(vm.days).toBe(await ctx.store.scores.countDays(todayOf(ctx)));
    expect(vm.days).toBeGreaterThan(100);
    expect(vm.answers).toBeGreaterThanOrEqual(before);
  });

  it("Behaviours lists every tag, hidden ones included, with the catalogue's question and section", async () => {
    const { tags } = await getBehaviours(ctx);
    expect(tags).toHaveLength(9);
    expect([tags[0].tag, tags[0].hidden, tags[0].section]).toEqual(["alcohol", false, "nighttime"]);
    expect(tags.slice(1).every((t) => t.hidden)).toBe(true);
    expect(tags.find((t) => t.tag === "sauna")?.section).toEqual(expect.any(String));
    expect(tags[0].question).toMatch(/\?$/);
  });

  it("the wear streak counts worn days back from today to the first day without heart rate (the seed has none on 2026-09-09)", async () => {
    // Today has 840 minutes of heart rate, so it counts: 2026-10-02 back to 2026-09-10, 23 days.
    expect(await getWearStreak(ctx)).toEqual({ days: 23, asOf: "2026-10-02" });
  });
});

describe("app preferences and coach chats", () => {
  it("default to the system theme with every notification off, then follow what is stored", async () => {
    await ctx.store.settings.remove("theme");
    expect(await getAppPrefs(ctx)).toEqual({ theme: "system", notifyRecovery: false, notifySyncProblem: false });
    await ctx.store.settings.set("theme", "dark");
    await ctx.store.settings.set("notify.recovery", true);
    expect(await getAppPrefs(ctx)).toEqual({ theme: "dark", notifyRecovery: true, notifySyncProblem: false });
  });

  it("the coach card of Your data shows once a chat is saved", async () => {
    expect(await hasCoachChats(ctx)).toBe(false);
    await ctx.store.coach.saveChat("c9", "Hello", [], ctx.now);
    expect(await hasCoachChats(ctx)).toBe(true);
  });
});
