// The person's display choices (Settings › App): metric or imperial units, and a 24- or 12-hour clock. Pulse stores
// every value in metric (kg, km, cm, °C, ml, m) and converts only where a view model reads a stored value, so averages,
// changes, chart scales and sentences are all worked out in the shown units. The choice comes from the profile at boot
// and on every change (src/state/app.ts); a profile without one takes the phone's (deviceDisplayPrefs).

export type UnitSystem = "metric" | "imperial";
export type ClockHours = 12 | 24;
export type DisplayPrefs = { units: UnitSystem; hours: ClockHours };

export const DEFAULT_DISPLAY: DisplayPrefs = { units: "metric", hours: 24 };
let prefs: DisplayPrefs = DEFAULT_DISPLAY;

/** The choices every formatter and view model reads. */
export const displayPrefs = (): DisplayPrefs => prefs;
export function setDisplayPrefs(p: DisplayPrefs) {
  prefs = p;
}

type Conversion = { unit: string; factor: number; offset?: number };

/** Each metric unit Pulse stores and its imperial counterpart: shown = stored × factor + offset. */
const IMPERIAL: Record<string, Conversion> = {
  kg: { unit: "lb", factor: 2.2046226218 },
  km: { unit: "mi", factor: 0.6213711922 },
  // A pace, seconds per km: a mile takes 1.609344 times as long.
  "/km": { unit: "/mi", factor: 1.609344 },
  m: { unit: "ft", factor: 3.280839895 },
  cm: { unit: "in", factor: 0.3937007874 },
  ml: { unit: "fl oz", factor: 0.0338140227 },
  "°C": { unit: "°F", factor: 1.8, offset: 32 },
};

export type Quantity = {
  /** The unit to show beside the value. */
  unit: string | undefined;
  /** A stored reading as shown. */
  value: (v: number) => number;
  /** A stored difference (a change, a deviation from a baseline, a spread) as shown: scaled, never offset. */
  change: (v: number) => number;
  /** A shown value (what the person types) back in the stored unit. */
  stored: (v: number) => number;
};

const same = (v: number) => v;

/** How a value stored in `unit` shows in the person's units. Units without an imperial form (bpm, %, kcal) pass through. */
export function quantity(unit: string, units?: UnitSystem): Quantity & { unit: string };
export function quantity(unit: string | undefined, units?: UnitSystem): Quantity;
export function quantity(unit: string | undefined, units: UnitSystem = prefs.units): Quantity {
  const c = units === "imperial" && unit ? IMPERIAL[unit] : undefined;
  if (!c) return { unit, value: same, change: same, stored: same };
  const offset = c.offset ?? 0;
  return { unit: c.unit, value: (v) => v * c.factor + offset, change: (v) => v * c.factor, stored: (v) => (v - offset) / c.factor };
}

/** A value stored in `unit` as shown; a deviation from a baseline scales without the offset (see inUnits). */
export function shownValue(unit: string | undefined, v: number, deviation = false) {
  const q = quantity(unit);
  return deviation ? q.change(v) : q.value(v);
}

type Num = number | null | undefined;
const map = (v: Num, f: (v: number) => number) => (v === null || v === undefined || !Number.isFinite(v) ? v : f(v));

/**
 * A metric spec (a `unit` and a `pick` reading a stored value) in the person's units: the shown unit, and a pick that
 * converts. `deviation` marks a value that is a difference from a baseline (skin temperature), which scales without
 * the offset: +0.5 °C is +0.9 °F, not 32.9 °F.
 */
export function inUnits<T extends { unit?: string; deviation?: boolean; pick?: (...args: never[]) => Num }>(spec: T): T {
  const q = quantity(spec.unit);
  if (q.unit === spec.unit) return spec;
  const f = spec.deviation ? q.change : q.value;
  const read = spec.pick as ((...args: unknown[]) => Num) | undefined;
  return { ...spec, unit: q.unit, ...(read && { pick: (...args: unknown[]) => map(read(...args), f) }) };
}

/** Centimetres as whole feet and inches (5 ft 10 in), rounded to the inch. */
export function feetInches(cm: number) {
  const total = Math.round(quantity("cm", "imperial").value(cm));
  return { feet: Math.floor(total / 12), inches: total % 12 };
}

/** Feet and inches back to centimetres. */
export const fromFeetInches = (feet: number, inches: number) => quantity("cm", "imperial").stored(feet * 12 + inches);
