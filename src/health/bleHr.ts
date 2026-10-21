import { i18n } from "@/i18n/config";
// Live heart rate over Bluetooth, the pure half: decoding the standard Heart Rate Measurement characteristic (0x2A37)
// a band sends while it shares heart rate, artifact-filtered RMSSD over the beat-to-beat (RR) intervals, the
// 2-minute trace the screens draw, and the small policies the controller (ble.ts) uses: which scanned devices look
// like the band, how long to wait between reconnects. Nothing here touches React Native, so it runs under vitest.
//
// Live readings are display-only: nothing here or in ble.ts writes to SQLite. Health Connect stays the scoring
// source, so a beat never counts twice.

/** Heart Rate Service and its Heart Rate Measurement characteristic (Bluetooth SIG assigned numbers), 128-bit form. */
export const HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";
export const HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb";

/** True when two UUIDs name the same thing (16-bit "2a37" vs the 128-bit form, any case). */
export function sameUuid(a: string, b: string): boolean {
  const full = (u: string) => {
    const s = u.toLowerCase();
    return /^[0-9a-f]{4}$/.test(s) ? `0000${s}-0000-1000-8000-00805f9b34fb` : /^[0-9a-f]{8}$/.test(s) ? `${s}-0000-1000-8000-00805f9b34fb` : s;
  };
  return full(a) === full(b);
}

// ── Base64 ──────────────────────────────────────────────────────────────────

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[ALPHABET.charCodeAt(i)] = i;
  // URL-safe spellings, in case a platform ever hands those over.
  t["-".charCodeAt(0)] = 62;
  t["_".charCodeAt(0)] = 63;
  return t;
})();

/**
 * Base64 → bytes. Hermes has no Buffer, so react-native-ble-plx's base64 values are decoded here. Padding ends the
 * value; characters outside the alphabet (whitespace) are skipped.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < b64.length; i++) {
    const code = b64.charCodeAt(i);
    if (code === 61 /* = */) break;
    const v = code < 128 ? LOOKUP[code] : -1;
    if (v < 0) continue;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// ── Heart Rate Measurement (0x2A37) ─────────────────────────────────────────

export type HrMeasurement = {
  /** Beats per minute as the band sends it; 0 means it has no reading (some sensors send that off the skin). */
  bpm: number;
  /** Beat-to-beat intervals in this notification, oldest first, in ms (the wire unit is 1/1024 s). */
  rrMs: number[];
  /** Skin contact: null when the sensor does not report it. */
  contact: boolean | null;
};

/**
 * One Heart Rate Measurement value. Flags (byte 0): bit 0 = bpm is uint16 (else uint8); bits 1–2 = sensor contact
 * (0/1 not supported, 2 no contact, 3 contact); bit 3 = 2 bytes of energy expended follow (skipped); bit 4 = uint16
 * RR intervals fill the rest. Little-endian. Null when the value is too short to hold a bpm.
 */
export function parseHrMeasurement(bytes: ArrayLike<number>): HrMeasurement | null {
  if (bytes.length < 2) return null;
  const flags = bytes[0];
  let i: number;
  let bpm: number;
  if (flags & 0x01) {
    if (bytes.length < 3) return null;
    bpm = bytes[1] | (bytes[2] << 8);
    i = 3;
  } else {
    bpm = bytes[1];
    i = 2;
  }
  const status = (flags >> 1) & 0x03;
  const contact = status === 3 ? true : status === 2 ? false : null;
  if (flags & 0x08) i += 2;
  const rrMs: number[] = [];
  if (flags & 0x10) for (; i + 1 < bytes.length; i += 2) rrMs.push(Math.round(((bytes[i] | (bytes[i + 1] << 8)) * 1000) / 1024));
  return { bpm, rrMs, contact };
}

/** parseHrMeasurement on a characteristic's base64 value (react-native-ble-plx's `Characteristic.value`). */
export const parseHrMeasurementBase64 = (b64: string): HrMeasurement | null => parseHrMeasurement(base64ToBytes(b64));

// ── RR intervals and RMSSD ──────────────────────────────────────────────────

/** Physiological RR bounds (200 → 30 bpm) and the largest beat-to-beat change kept. */
export const RR_MIN_MS = 300;
export const RR_MAX_MS = 2000;
export const RR_MAX_JUMP = 0.2;
/** After this many rejected beats in a row the reference moves to the new rhythm (a real change of pace, not noise). */
const REANCHOR_AFTER = 3;
/** RMSSD needs this many successive clean pairs before it means anything. */
export const RMSSD_MIN_PAIRS = 10;
/** The live RMSSD window. */
export const RR_WINDOW_MS = 60_000;

/**
 * Basic artifact rejection, beat by beat: an interval outside 300–2000 ms, or more than 20 % away from the last
 * accepted one, becomes null (a missed or extra beat). Three rejections in a row re-anchor on the newest in-range
 * beat, so a genuine change of rate is not rejected forever.
 */
export function cleanRr(rrMs: readonly number[]): (number | null)[] {
  const out: (number | null)[] = [];
  let ref: number | null = null;
  let rejected = 0;
  for (const rr of rrMs) {
    if (!(rr >= RR_MIN_MS && rr <= RR_MAX_MS)) {
      out.push(null);
      continue;
    }
    if (ref !== null && Math.abs(rr - ref) / ref > RR_MAX_JUMP) {
      rejected++;
      if (rejected >= REANCHOR_AFTER) {
        ref = rr;
        rejected = 0;
      }
      out.push(null);
      continue;
    }
    ref = rr;
    rejected = 0;
    out.push(rr);
  }
  return out;
}

/**
 * Root mean square of successive differences (ms) over the intervals given (the caller keeps the rolling window).
 * Only pairs of clean beats that were next to each other count: a rejected beat breaks the chain rather than
 * bridging it. Null with fewer than `minPairs` pairs.
 */
export function rmssd(rrMs: readonly number[], minPairs = RMSSD_MIN_PAIRS): number | null {
  const clean = cleanRr(rrMs);
  let sum = 0;
  let n = 0;
  for (let k = 1; k < clean.length; k++) {
    const a = clean[k - 1];
    const b = clean[k];
    if (a === null || b === null) continue;
    sum += (b - a) ** 2;
    n++;
  }
  return n >= Math.max(1, minPairs) ? Math.sqrt(sum / n) : null;
}

export type RrBeat = { /** Epoch ms the interval ended. */ t: number; rr: number };

/** One notification's intervals with the time each ended: the last at `at` (arrival), each earlier one before it. */
export function stampRr(rrMs: readonly number[], at: number): RrBeat[] {
  const out: RrBeat[] = new Array(rrMs.length);
  let t = at;
  for (let k = rrMs.length - 1; k >= 0; k--) {
    out[k] = { t, rr: rrMs[k] };
    t -= rrMs[k];
  }
  return out;
}

/** The tail of an ascending-by-`t` list from `from` on (a rolling window). Returns the same array when nothing drops. */
export function since<T extends { t: number }>(xs: T[], from: number): T[] {
  let k = 0;
  while (k < xs.length && xs[k].t < from) k++;
  return k === 0 ? xs : xs.slice(k);
}

// ── The live trace ──────────────────────────────────────────────────────────

/** The trace's span and slot: 60 points over the last 2 minutes. */
export const TRACE_MS = 120_000;
export const TRACE_SLOT_MS = 2_000;

/**
 * Mean bpm per slot over the `windowMs` ending at `now`, oldest first; an empty slot is null (a gap, never a line
 * across it). Fixed slots keep the x axis in time whatever the notification rate.
 */
export function liveTrace(history: readonly { t: number; bpm: number }[], now: number, windowMs = TRACE_MS, slotMs = TRACE_SLOT_MS): (number | null)[] {
  const slots = Math.max(1, Math.round(windowMs / slotMs));
  const start = now - slots * slotMs;
  const sum = new Array<number>(slots).fill(0);
  const count = new Array<number>(slots).fill(0);
  for (const h of history) {
    if (h.t <= start || h.t > now || !(h.bpm > 0)) continue;
    const k = Math.min(slots - 1, Math.floor((h.t - start) / slotMs));
    sum[k] += h.bpm;
    count[k]++;
  }
  return sum.map((s, k) => (count[k] ? Math.round(s / count[k]) : null));
}

// ── Devices and reconnects ──────────────────────────────────────────────────

export type ScannedHr = { id: string; name: string | null; rssi: number | null };

/** A name the Fitbit Air (or another Fitbit) would advertise. */
export const looksLikeFitbit = (name: string | null | undefined): boolean => !!name && /fitbit|air/i.test(name);

/** Likely bands first, then the strongest signal, then by name; a device with no RSSI sorts last in its group. */
export function rankDevices<T extends ScannedHr>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => {
    const fa = looksLikeFitbit(a.name) ? 0 : 1;
    const fb = looksLikeFitbit(b.name) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ra = a.rssi ?? -999;
    const rb = b.rssi ?? -999;
    if (ra !== rb) return rb - ra;
    return (a.name ?? "~").localeCompare(b.name ?? "~");
  });
}

/** "Strong" / "Good" / "Weak" for an RSSI in dBm; null without one. */
export function signalWord(rssi: number | null | undefined): string | null {
  if (rssi === null || rssi === undefined) return null;
  return i18n.t(rssi >= -60 ? "errors:ble.signalStrong" : rssi >= -75 ? "errors:ble.signalGood" : "errors:ble.signalWeak");
}

/** Wait before reconnect attempt `attempt` (1-based): 2 s, 4 s, 8 s… capped at 30 s. */
export function backoffMs(attempt: number, baseMs = 2_000, capMs = 30_000): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(capMs, baseMs * 2 ** Math.min(n - 1, 20));
}
