import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "./locale";
import { agoShort, DAY, FORMATS, dayLabel, dayPhrase, pillLabel, dialAriaLabel, durationWords, formatDay, formatValue, rangeLabel, unitLabel } from "./format";

describe("format", () => {
  it("shortens sync ages for the header", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    expect(agoShort(now - 30_000, now)).toBe("Now");
    expect(agoShort(now - 12 * 60_000, now)).toBe("12m");
    expect(agoShort(now - 3 * 3600_000, now)).toBe("3h");
    expect(agoShort(now - 50 * 3600_000, now)).toBe("2d");
  });
  it("uses the real minus sign and signs deltas", () => {
    expect(formatValue("signed1", -0.6)).toBe("−0.6");
    expect(formatValue("signed1", 0.4)).toBe("+0.4");
    expect(formatValue("signed1", -0.01)).toBe("0.0");
    expect(formatValue("signedInt", -3)).toBe("−3");
  });
  it("formats durations, groups and missing values", () => {
    expect(formatValue("duration", 389)).toBe("6:29");
    expect(formatValue("durationHMS", 1360)).toBe("0:22:40");
    expect(formatValue("pace", 332.4)).toBe("5:32");
    expect(formatValue("pace", 599.6)).toBe("10:00");
    expect(formatValue("grouped", 12459)).toBe("12,459");
    expect(formatValue("int", null)).toBe("--");
    expect(formatValue("int", Number.NaN)).toBe("--");
    expect(durationWords(72)).toBe("1\u00a0hour 12\u00a0minutes");
  });
  it("labels days and ranges", () => {
    expect(dayLabel("2026-10-02", "2026-10-02")).toBe("Today");
    expect(dayLabel("2026-10-01", "2026-10-02")).toBe("Yesterday");
    expect(dayLabel("2026-09-28", "2026-10-02")).toBe("Mon, Sep 28");
    expect(dayPhrase("2026-10-02", "2026-10-02")).toBe("today");
    expect(dayPhrase("2026-10-01", "2026-10-02")).toBe("yesterday");
    expect(dayPhrase("2026-09-28", "2026-10-02")).toBe("on Mon, Sep 28");
    expect(pillLabel("2026-09-28", "2026-10-02")).toBe("Mon., Sep. 28");
    expect(pillLabel("2026-05-04", "2026-10-02")).toBe("Mon., May 4");
    expect(pillLabel("2026-10-01", "2026-10-02")).toBe("Yesterday");
    expect(rangeLabel("2026-09-22", "2026-09-28")).toBe("Sep 22 - Sep 28");
    expect(dayLabel("2026-03-01", "2026-03-02")).toBe("Yesterday");
    expect(formatDay("2026-09-28", DAY.long)).toBe("Monday, September 28");
    expect(formatDay("2026-09", DAY.monthYear)).toBe("September 2026");
    expect(formatDay("1990-01-05", DAY.full)).toBe("Jan 5, 1990");
  });
  it("builds dial labels", () => {
    expect(dialAriaLabel({ variant: "recovery", label: "Recovery", value: 72, valueText: "72", unit: "%", bandWord: "Green" })).toBe(
      "Recovery 72 percent, green",
    );
    expect(dialAriaLabel({ variant: "strain", label: "Strain", value: 42, valueText: "42", unit: "%", target: [46, 79], soFar: true })).toBe(
      "Strain 42 percent so far, target 46 to 79 percent",
    );
    expect(dialAriaLabel({ variant: "recovery", label: "Recovery", value: null, reasonText: "Calibrating: 4 nights left" })).toBe(
      "Recovery unavailable: calibrating, 4 nights left",
    );
  });
});

describe("in another locale", () => {
  afterEach(() => setLocale("en-US"));
  it("uses the locale's decimal mark and grouping", () => {
    setLocale("de-DE");
    expect(FORMATS.decimal1(5.8)).toBe("5,8");
    expect(FORMATS.grouped(1234)).toBe("1.234");
    expect(formatDay("2026-10-21", { month: "short", day: "numeric" })).toMatch(/21\.\s?Okt/);
  });
});

describe("unitLabel", () => {
  it("localises min and h and leaves other units alone", async () => {
    const { i18n } = await import("@/i18n/config");
    expect([unitLabel("min"), unitLabel("h"), unitLabel("bpm"), unitLabel("%")]).toEqual(["min", "h", "bpm", "%"]);
    await i18n.changeLanguage("ru");
    expect([unitLabel("min"), unitLabel("h"), unitLabel("ms")]).toEqual(["мин", "ч", "ms"]);
    await i18n.changeLanguage("en");
  });
});
