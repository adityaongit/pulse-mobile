// Ported from pulse src/app/export/export.test.ts: the same files from the same seed, built by `buildExport` instead of a
// route (the share sheet is the only part left out: it needs the phone).
import { beforeAll, describe, expect, it } from "vitest";
import type { QueryCtx } from "../queries/common";
import { seededCtx } from "../queries/testing";
import { buildExport, toCsv } from "./export";

const SECRETS = ["at-SECRET-access", "rt-SECRET-refresh", "sk-SECRET-coachkey"];
let ctx: QueryCtx;

beforeAll(async () => {
  ctx = await seededCtx();
  const { store } = ctx;
  // Tokens and the coach key live in the secure store, never in SQLite: what is stored near them is the non-secret grant
  // and the key's last four characters. The exports must carry none of it.
  await store.settings.set("google.grant", { scope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly", revokedAt: null, updatedAt: 1 });
  await store.coach.saveProvider("openai", "gpt", "oKey", 1);
  // The F2 seed has no Google extras (the demo generator made them in pulse): one day of distance, two decimals.
  await store.daily.upsertDailyValues([{ day: "2026-10-01", key: "distance", value: 7.456 }]);
  await store.journal.addTag("=cmd", '=HYPERLINK("x")', 60);
  await store.journal.saveEntry({ day: "2026-10-01", tag: "=cmd", value: 1, detail: null });
  await store.journal.saveNote("2026-10-01", "Mine");
  await store.coach.saveChat("c1", "A chat", [{ id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] }], 5);
}, 120_000);

const noSecrets = (text: string) => {
  for (const s of SECRETS) expect(text).not.toContain(s);
  expect(text).not.toContain("oKey");
  expect(text).not.toContain("googlehealth");
};

describe("buildExport", () => {
  it("daily CSV: named by day, one row per day, the documented columns, no secrets", async () => {
    const f = await buildExport(ctx, "daily", "csv");
    expect(f).toMatchObject({ name: "pulse-daily-2026-10-02.csv", mime: "text/csv" });
    const lines = f.body.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "day,recovery_pct,strain,sleep_performance_pct,sleep_minutes,sleep_consistency_pct,hrv_ms,resting_hr_bpm,respiratory_rate_rpm,spo2_pct,skin_temperature_deviation_c,stress_avg,steps,weight_kg,body_fat_pct," +
        "distance_km,floors,elevation_m,active_minutes,light_minutes,azm_minutes,active_calories_kcal,sedentary_minutes,avg_hr_bpm," +
        "water_ml,calories_in_kcal,protein_g,carbs_g,fat_g,glucose_mg_dl,core_temp_c,swim_strokes",
    );
    const head = lines[0].split(",");
    const seededDay = lines.find((l) => l.startsWith("2026-10-01,"))!.split(",");
    expect(seededDay[head.indexOf("distance_km")]).toBe("7.46");
    expect(seededDay[head.indexOf("water_ml")]).toBe("");
    expect(lines.length).toBeGreaterThanOrEqual(181);
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},/);
    // Today accrues through the day: its Strain, steps and stress are blank, not a low number.
    const today = lines.find((l) => l.startsWith("2026-10-02,"))!.split(",");
    for (const c of ["strain", "steps", "stress_avg"]) expect(today[head.indexOf(c)]).toBe("");
    noSecrets(f.body);
  });

  it("daily JSON carries the time zone and an object per day", async () => {
    const f = await buildExport(ctx, "daily", "json");
    expect(f).toMatchObject({ name: "pulse-daily-2026-10-02.json", mime: "application/json" });
    const body = JSON.parse(f.body) as { timeZone: string; days: Record<string, unknown>[] };
    expect(body.timeZone).toBe("Asia/Kolkata");
    expect(Object.keys(body.days[0])).toContain("hrv_ms");
    noSecrets(f.body);
  });

  it("journal CSV defuses formulas in user labels; the JSON lists behaviours and notes", async () => {
    const csv = (await buildExport(ctx, "journal", "csv")).body;
    expect(csv.split("\r\n")[0]).toBe("day,behaviour,label,answer,follow_up");
    expect(csv).toContain(`2026-10-01,'=cmd,"'=HYPERLINK(""x"")",1,`);
    noSecrets(csv);
    const f = await buildExport(ctx, "journal", "json");
    const json = JSON.parse(f.body) as { behaviours: { tag: string; custom: boolean }[]; entries: unknown[]; notes: unknown[] };
    expect(json.notes).toEqual([{ day: "2026-10-01", text: "Mine" }]);
    expect(json.behaviours.find((b) => b.tag === "=cmd")).toMatchObject({ custom: true, hidden: false });
    expect(json.entries.length).toBeGreaterThan(100);
    noSecrets(f.body);
  });

  it("the coach export is every saved chat as JSON, never the provider or the key", async () => {
    const f = await buildExport(ctx, "coach", "csv");
    expect(f).toMatchObject({ name: "pulse-coach-2026-10-02.json", mime: "application/json" });
    const { chats } = JSON.parse(f.body) as { chats: { id: string; title: string; messages: unknown[] }[] };
    expect(chats.map((c) => [c.id, c.title, c.messages.length])).toEqual([["c1", "A chat", 1]]);
    noSecrets(f.body);
    expect(f.body).not.toContain("openai");
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and newlines, and leaves numbers and nulls plain", () => {
    expect(toCsv({ columns: ["a", "b"], rows: [["x,y", 'say "hi"'], [1.5, null], ["-1", "line\nbreak"]] })).toBe('a,b\r\n"x,y","say ""hi"""\r\n1.5,\r\n\'-1,"line\nbreak"\r\n');
  });
});
