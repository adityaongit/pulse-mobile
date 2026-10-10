// The time zone list behind the picker. Ported from pulse src/components/profile/TimeZoneCombobox.tsx (the data half):
// the same names, offsets, order and search. Two differences, both forced by Hermes: the zone ids come from
// `Intl.supportedValuesOf` when the runtime has it and from the static list otherwise, and the offset is read with
// `utcOffsetS` (the formatter the scoring already uses) instead of `timeZoneName: "shortOffset"`.
import { isTimeZone } from "@/lib/timeZone";
import { utcOffsetS } from "../../time";
import { ZONE_IDS } from "./zones";

/** Old names some runtimes still report (ICU keeps them canonical), mapped to today's names. */
const RENAMED: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Enderbury": "Pacific/Kanton",
  "America/Godthab": "America/Nuuk",
};
/** Today's name for a zone. */
export const canonicalZone = (id: string) => RENAMED[id] ?? id;

/** The zone this device is in, or "" when the runtime does not say. */
export const deviceZone = () => canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");

export type Zone = { id: string; city: string; region: string; offset: string; minutes: number; search: string };

/** "GMT+5:30" and its minutes east of UTC, for one zone at `now` (unix seconds). */
export function offsetOf(id: string, now: number): { offset: string; minutes: number } {
  const minutes = Math.round(utcOffsetS(now, id) / 60);
  const abs = Math.abs(minutes);
  const mm = abs % 60;
  return { offset: `GMT${minutes < 0 ? "-" : "+"}${Math.floor(abs / 60)}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`, minutes };
}

let cached: Zone[] | undefined;
/** Every zone the runtime knows, by offset then city. Built once, on first open (about 420 formatters). */
export function zones(now = Math.floor(Date.now() / 1000)): Zone[] {
  if (cached) return cached;
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ZONE_IDS;
  const ids = [...new Set(supported.map(canonicalZone))].filter(isTimeZone);
  cached = ids
    .map((id) => {
      const parts = id.split("/");
      const city = parts.at(-1)!.replaceAll("_", " ");
      const region = parts.length > 1 ? parts.slice(0, -1).join(" / ").replaceAll("_", " ") : "Other";
      const o = offsetOf(id, now);
      return { id, city, region, ...o, search: `${city} ${region} ${id} ${o.offset}`.toLowerCase() };
    })
    .sort((a, b) => a.minutes - b.minutes || (a.city < b.city ? -1 : a.city > b.city ? 1 : 0));
  return cached;
}

/** "Kolkata, Asia (GMT+5:30)" for a zone id. */
export const describeZone = (id: string) => {
  const z = zones().find((x) => x.id === canonicalZone(id));
  return z ? `${z.city}, ${z.region} (${z.offset})` : id;
};

const MAX_SHOWN = 80;

/** The zones matching every word of `query` (at most 80), or all of them for an empty query. */
export function matchZones(query: string): Zone[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = zones();
  const hit = words.length ? all.filter((z) => words.every((w) => z.search.includes(w))) : all;
  // Unfiltered, every zone, so the list can open on the chosen one wherever it sorts.
  return words.length ? hit.slice(0, MAX_SHOWN) : hit;
}
