import { describe, expect, it } from "vitest";
import { addDays, localDay, localMidnight, localMinutes, wall } from "./time";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("localMinutes", () => {
  it("is the clock's minutes after midnight on an ordinary day", () => {
    expect(localMinutes(at("2026-10-02T07:39:00+05:30"), "Asia/Kolkata")).toBe(459);
    expect(localMinutes(at("2026-10-02T23:30:00+05:30"), "Asia/Kolkata")).toBe(1410);
    expect(localMinutes(localMidnight("2026-10-02", "Asia/Kolkata"), "Asia/Kolkata")).toBe(0);
  });

  it("reads the clock, not the time elapsed, on a fall-back day (25 hours)", () => {
    // New York falls back at 02:00 EDT on 2025-11-02: 07:39 EST is 8 h 39 min after midnight, but the clock says 07:39.
    const wake = at("2025-11-02T07:39:00-05:00");
    expect(localDay(wake, "America/New_York")).toBe("2025-11-02");
    expect(localMinutes(wake, "America/New_York")).toBe(459);
    // The repeated hour reads the same both times.
    expect(localMinutes(at("2025-11-02T01:30:00-04:00"), "America/New_York")).toBe(90);
    expect(localMinutes(at("2025-11-02T01:30:00-05:00"), "America/New_York")).toBe(90);
  });

  it("reads the clock on a spring-forward day (23 hours)", () => {
    // New York springs forward at 02:00 EST on 2026-03-08: 08:54 EDT is 7 h 54 min after midnight.
    expect(localMinutes(at("2026-03-08T08:54:00-04:00"), "America/New_York")).toBe(534);
    expect(localMinutes(at("2026-03-08T17:00:00-04:00"), "America/New_York")).toBe(17 * 60);
  });

  it("reads the clock where the change skips midnight itself (Santiago)", () => {
    // Chile's clocks go from 00:00 to 01:00 on 2026-09-06, so the day opens at 01:00; 07:00 is still 420.
    const tz = "America/Santiago";
    const seven = at("2026-09-06T07:00:00-03:00");
    expect(localDay(seven, tz)).toBe("2026-09-06");
    expect(localMinutes(seven, tz)).toBe(420);
  });
});

describe("wall", () => {
  /** wall() as it read every instant from Intl before the per-hour offsets (the reference). */
  const formats = new Map<string, Intl.DateTimeFormat>();
  const viaIntl = (s: number, tz: string) => {
    let f = formats.get(tz);
    if (!f) formats.set(tz, (f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })));
    const p = Object.fromEntries(f.formatToParts(new Date(s * 1000)).map((x) => [x.type, x.value]));
    return {
      day: `${p.year}-${p.month}-${p.day}`,
      time: `${String(+p.hour % 24).padStart(2, "0")}:${p.minute}:${p.second}`,
      asUtc: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) / 1000,
    };
  };
  // Half- and quarter-hour offsets, a 30-minute DST (Lord Howe), a change at midnight (Santiago), Ramadan switches
  // (Casablanca), a 2-hour DST (Troll), a skipped day (Apia, 2011), and the plain ones.
  const zones = ["UTC", "Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Lord_Howe", "America/Santiago", "Asia/Kathmandu", "Pacific/Chatham", "America/St_Johns", "Africa/Casablanca", "Antarctica/Troll", "Pacific/Apia"];

  it("reads every instant as Intl does, across offset changes", () => {
    for (const tz of zones) {
      const offset = (s: number) => viaIntl(s, tz).asUtc - s;
      const checked: number[] = [];
      // Around every change from 2024 to 2027: every 17 s for the six hours it falls in.
      for (let s = Date.UTC(2024, 0, 1) / 1000; s < Date.UTC(2028, 0, 1) / 1000; s += 6 * 3600) {
        if (offset(s) === offset(s + 6 * 3600)) continue;
        for (let t = s; t <= s + 6 * 3600; t += 17) checked.push(t);
      }
      // (Samoa dropped DST in 2021.)
      if (!["UTC", "Asia/Kolkata", "Asia/Kathmandu", "Pacific/Apia"].includes(tz)) expect(checked.length, `${tz} has offset changes`).toBeGreaterThan(0);
      // And instants anywhere from 1970 to 2040, some with fractions of a second.
      let seed = 12345;
      const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
      for (let i = 0; i < 3000; i++) checked.push(Math.floor(next() * (Date.UTC(2040, 0, 1) / 1000)) + (i % 3 === 0 ? next() : 0));
      for (const s of checked) expect(wall(s, tz), `${tz} ${s}`).toEqual(viaIntl(s, tz));
    }
  });

  it("reads the Apia day that never happened as Intl does", () => {
    // Samoa skipped 2011-12-30: 23:59:59 on the 29th was followed by 00:00 on the 31st.
    const tz = "Pacific/Apia";
    for (let s = Date.UTC(2011, 11, 30, 0) / 1000; s < Date.UTC(2011, 11, 31, 0) / 1000; s += 61) expect(wall(s, tz)).toEqual(viaIntl(s, tz));
  });

  it("keeps Intl's answer outside the years it shortcuts, and its error for a bad instant", () => {
    for (const s of [-1, -86_400 * 365.25 * 30, Date.UTC(9999, 5, 1) / 1000]) expect(wall(s, "Asia/Kolkata")).toEqual(viaIntl(s, "Asia/Kolkata"));
    expect(() => wall(Number.NaN, "Asia/Kolkata")).toThrow(RangeError);
    expect(() => wall(0, "Not/AZone")).toThrow(RangeError);
  });
});

describe("addDays", () => {
  /** addDays as Date.parse did it before the arithmetic (the reference). */
  const viaParse = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  it("moves every day of 1990 to 2049 as Date.parse does, across months, leap days and years", () => {
    for (let t = Date.UTC(1990, 0, 1); t < Date.UTC(2050, 0, 1); t += 86_400_000) {
      const day = new Date(t).toISOString().slice(0, 10);
      for (const n of [-400, -60, -14, -1, 0, 1, 2, 31, 366]) expect(addDays(day, n), `${day} ${n}`).toBe(viaParse(day, n));
    }
  });

  it("leaves what is not a plain day to Date.parse: the same day back, or the same error", () => {
    // What Date.parse accepts differs between engines (Hermes takes "2026-1-05", V8 does not), so compare, don't assume.
    const cases: [string, number][] = [
      ["2026-02-30", 1], ["2026-11-31", 0], ["2026-11-14", 0.5], ["2026-11-14", -0.5], ["0999-12-31", 1], ["9999-12-31", 0], ["9999-12-31", 1],
      ["2026-11-14", Number.POSITIVE_INFINITY], ["2026-11-14", Number.NaN], ["latest", 1], ["2026-13-01", 1], ["2026-1-05", 1], ["2026- 1-05", 1], ["", 1],
    ];
    for (const [day, n] of cases) {
      let expected: string | Error;
      try {
        expected = viaParse(day, n);
      } catch (e) {
        expected = e as Error;
      }
      if (expected instanceof Error) expect(() => addDays(day, n), `${day} ${n}`).toThrow(expected.constructor as ErrorConstructor);
      else expect(addDays(day, n), `${day} ${n}`).toBe(expected);
    }
  });
});
