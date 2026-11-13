// Local-time helpers shared by the sources, the pipeline and the queries. Instants are unix seconds;
// days are local `YYYY-MM-DD` in the configured IANA zone.

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Local wall-clock reading of instant `s`: the day, `HH:mm:ss`, and that wall time read as if it were UTC. */
export function wall(s: number, tz: string): { day: string; time: string; asUtc: number } {
  const offset = s >= FAST_FROM && s < FAST_TO ? offsetIn(Math.floor(s / HOUR), tz) : null;
  if (offset === null) return intlWall(s, tz);
  const asUtc = Math.floor(s) + offset;
  const iso = new Date(asUtc * 1000).toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 19), asUtc };
}

// wall() runs for every step minute, interval record and nightly reading a sync maps, and for both ends of every sleep
// stage in stage 2's sleep consistency: hundreds of thousands of times on a first import. Intl's formatToParts is slow (under Hermes most of all), so the zone's offset is read from Intl
// once per UTC hour and the wall time is worked out from it. An hour whose first and last second have the same offset
// has it throughout (a zone changes its offset at most once in an hour); an hour with a change in it is read from Intl
// instant by instant, so every result is the one Intl gives.
const HOUR = 3600;
/** The instants the shortcut covers, 1970 to 9998: toISOString prints their days as Intl's en-CA does. */
const FAST_FROM = 0;
const FAST_TO = Date.UTC(9999, 0, 1) / 1000;
const offsets = new Map<string, Map<number, number | null>>();

/** `tz`'s offset in seconds throughout UTC hour `hour`, or null when it changes within it. */
function offsetIn(hour: number, tz: string): number | null {
  let byHour = offsets.get(tz);
  if (!byHour) offsets.set(tz, (byHour = new Map()));
  let offset = byHour.get(hour);
  if (offset === undefined) {
    const first = hour * HOUR;
    const last = first + HOUR - 1;
    const a = intlWall(first, tz).asUtc - first;
    offset = intlWall(last, tz).asUtc - last === a ? a : null;
    // About five years of hours per zone, then start again.
    if (byHour.size >= 50_000) byHour.clear();
    byHour.set(hour, offset);
  }
  return offset;
}

/** wall() read from Intl: exact for every instant, and slow. */
function intlWall(s: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(s * 1000)).map((x) => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    time: `${String(+p.hour % 24).padStart(2, "0")}:${p.minute}:${p.second}`,
    // `% 24`: some Intl engines print midnight as hour "24" even with hourCycle h23.
    asUtc: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) / 1000,
  };
}

/** The local day containing instant `s`. */
export const localDay = (s: number, tz: string) => wall(s, tz).day;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad2 = (x: number) => (x < 10 ? `0${x}` : `${x}`);

/**
 * `day` moved by `n` days. Stage 1's day keys move along whole baseline windows for every day of the history on each run,
 * so a real calendar day and a whole `n` (every caller) are done in arithmetic; anything else takes the Date.parse path
 * it always did, so it gives what the running engine's Date.parse gives.
 */
export function addDays(day: string, n: number): string {
  if (Number.isInteger(n) && DAY_RE.test(day)) {
    const y = +day.slice(0, 4);
    const m = +day.slice(5, 7);
    const d = +day.slice(8, 10);
    if (y >= 1000 && m >= 1 && m <= 12 && d >= 1 && d <= (m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1])) {
      const t = new Date(Date.UTC(y, m - 1, d + n));
      const ty = t.getUTCFullYear();
      if (ty >= 1000 && ty <= 9999) return `${ty}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
    }
  }
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

const midnights = new Map<string, number>();

/**
 * The first instant of local `day`. Midnight is tried under each offset in force within a day of it, and the
 * earliest candidate that falls on `day` wins: the first of a repeated midnight (fall-back to 00:00), or the
 * transition itself when a spring-forward at 00:00 skips midnight (Santiago, Havana, Azores...).
 */
export function localMidnight(day: string, tz: string): number {
  // Memoised: it is a pure function of the day and the zone, and costs six Intl calls, which are slow under Hermes. The
  // import spreads every interval record over the days it touches with it, so a few days of per-minute calorie
  // records asked for the same handful of midnights tens of thousands of times.
  const key = `${tz} ${day}`;
  const known = midnights.get(key);
  if (known !== undefined) return known;
  const utc = Date.parse(`${day}T00:00:00Z`) / 1000;
  const offset = (s: number) => wall(s, tz).asUtc - s;
  const out = Math.min(...[-86_400, 0, 86_400].map((d) => utc - offset(utc + d)).filter((s) => localDay(s, tz) === day));
  if (midnights.size >= 4096) midnights.clear();
  midnights.set(key, out);
  return out;
}

/** The instant a local wall time (`YYYY-MM-DDTHH:mm[:ss]`) names in `tz`; in a DST gap, the same offset trick as localMidnight. */
export function fromWall(civil: string, tz: string): number {
  const utc = Date.parse(`${civil.length === 16 ? `${civil}:00` : civil}Z`) / 1000;
  const offset = (s: number) => wall(s, tz).asUtc - Math.floor(s);
  return utc - offset(utc - offset(utc));
}

/** Seconds `tz` is ahead of UTC at instant `s`. */
export const utcOffsetS = (s: number, tz: string) => wall(s, tz).asUtc - Math.floor(s);

/**
 * Minutes after local midnight of instant `s` as the clock reads them (07:39 → 459), DST days included. Its callers want
 * a time of day (wake and bed times, the 17:00 review switch), so this is not the time elapsed since midnight: that ran
 * an hour ahead after a fall-back change (07:39 read as 08:39) and an hour behind after a spring-forward one.
 */
export const localMinutes = (s: number, tz: string) => {
  const w = wall(s, tz);
  return Math.round((w.asUtc - Date.parse(`${w.day}T00:00:00Z`) / 1000) / 60);
};

// Age from a `YYYY-MM-DD` birth date on a `YYYY-MM-DD` day. Both agree on every day: fractionalYears floors
// to wholeYears and equals it on a birthday. A Feb 29 birthday falls on Mar 1 in common years.

/** Completed years on `day`; the birthday itself counts. Sleep need and the max-HR estimate use this. */
export function wholeYears(birthDate: string, day: string) {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Completed years plus the elapsed share of the current birthday year. Healthspan and fitness use this. */
export function fractionalYears(birthDate: string, day: string) {
  const whole = wholeYears(birthDate, day);
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const birthday = (n: number) => Date.UTC(by + n, bm - 1, bd); // Feb 29 in a common year rolls to Mar 1
  return whole + (Date.parse(day) - birthday(whole)) / (birthday(whole + 1) - birthday(whole));
}
