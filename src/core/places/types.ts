// The location timeline (Pulse-only, docs/timeline.md): saved places, the geofence events and GPS fixes the background
// tasks write, and the stays and trips the screens read. Pure types and constants; no words (the screens own the copy).

/** What a place's icon shows. Codes, not copy: the screens name them. */
export const PLACE_ICONS = ["home", "work", "gym", "school", "shop", "food", "park", "other"] as const;
export type PlaceIcon = (typeof PLACE_ICONS)[number];

/** The fence sizes a place can have, in metres. 150 m keeps a home and a gym 400 m away apart and absorbs indoor drift. */
export const PLACE_RADII = [100, 150, 200, 300] as const;
export const DEFAULT_RADIUS_M = 150;

/** A saved place: the fence's centre and size. Coordinates never leave the phone. */
export type Place = {
  id: string;
  name: string;
  icon: PlaceIcon;
  latitude: number;
  longitude: number;
  radiusM: number;
  createdAt: number;
};

/** One geofence event the task writes (src/background/places.ts). `day` is the local civil day. */
export type PlaceEvent = { id: string; placeId: string; kind: "enter" | "exit"; ts: number; day: string };

/** One raw GPS fix. Kept RAW_FIX_DAYS, then only the frozen stays and movement remain. */
export type Fix = { ts: number; latitude: number; longitude: number; accuracyM: number | null };

/**
 * How Pulse follows the phone. `saver`: geofences only, saved places and nothing else. `balanced`: geofences plus the
 * few background fixes an hour Android allows without a notification, enough for unknown stops of 10 min or more.
 * `precise`: a fix every 90 s from a foreground service, with its permanent notification. `off`: nothing runs.
 */
export const TRACKING_MODES = ["off", "saver", "balanced", "precise"] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];
export const DEFAULT_MODE: TrackingMode = "balanced";

/**
 * One stay on the timeline: at a saved place (`placeId`), or an unknown stop (`placeId` null, at its centre). `open`:
 * still there, `end` is now. `capped`: an arrival with no departure, closed at MAX_VISIT_H instead of trusted.
 * `overrideId`: the owner's own edit (TimelineOverride) that made it; null for a detected one.
 */
export type Stay = {
  start: number;
  end: number;
  open: boolean;
  capped: boolean;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  overrideId: string | null;
};

/**
 * An edit to the timeline. Applied in order of `createdAt`: each wipes [start, end) of what is there, and a `stay`
 * then puts its own stay in the hole. Changing a stay's times is a `clear` of the old span plus a `stay` of the new one;
 * deleting it is a `clear`. Detected stays are never rewritten, so a later fix cannot undo an edit.
 */
export type TimelineOverride = {
  id: string;
  kind: "stay" | "clear";
  start: number;
  end: number;
  placeId: string | null;
  label: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: number;
};

/** A day's stays as frozen once its fixes are old enough (store's timeline_stays), clipped to the local day. */
export type FrozenStay = {
  day: string;
  start: number;
  end: number;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  capped: boolean;
};

/** Metres moved in one MOVE_BUCKET_S slot, from the fixes. Kept forever, so trips keep their distance after pruning. */
export type MoveBucket = { bucket: number; metres: number };
export const MOVE_BUCKET_S = 300;

/** Raw fixes are kept this many days (docs/timeline.md); days are frozen well before that. */
export const RAW_FIX_DAYS = 30;
/** A day is frozen once it is this many days old: late fixes from a deferred batch have arrived by then. */
export const FREEZE_AFTER_DAYS = 2;

/** The timeline's saved state: the mode the owner chose and the last day frozen into stored stays. */
export type TimelineState = { mode: TrackingMode; frozenThrough: string | null };
