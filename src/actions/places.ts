// Writes for the location timeline (docs/timeline.md): saved places, the tracking mode, and the owner's edits to a
// day. Edits never rewrite detected stays; they are overrides applied on top (src/core/places/timeline.ts).
import { validCoordinate } from "@/core/places/geo";
import { PLACE_ICONS, PLACE_RADII, TRACKING_MODES, type Place, type PlaceIcon, type TimelineOverride, type TrackingMode } from "@/core/places/types";
import type { Store } from "@/data/store";
import { newId } from "@/lib/ids";
import { unfreezeRecent } from "@/background/timeline";

export type PlaceInput = { id?: string; name: string; icon: PlaceIcon; latitude: number; longitude: number; radiusM: number };
export type PlaceError = "name" | "location" | "radius" | "icon";

export const MAX_PLACE_NAME = 40;

export async function savePlace(store: Store, input: PlaceInput, timeZone: string, now: number): Promise<{ ok: true; place: Place } | { ok: false; error: PlaceError }> {
  const name = input.name.trim();
  if (!name || name.length > MAX_PLACE_NAME) return { ok: false, error: "name" };
  if (!validCoordinate(input.latitude, input.longitude)) return { ok: false, error: "location" };
  if (!(PLACE_RADII as readonly number[]).includes(input.radiusM)) return { ok: false, error: "radius" };
  if (!(PLACE_ICONS as readonly string[]).includes(input.icon)) return { ok: false, error: "icon" };
  const existing = input.id ? (await store.places()).find((p) => p.id === input.id) : undefined;
  const place: Place = { id: existing?.id ?? newId(), name, icon: input.icon, latitude: input.latitude, longitude: input.longitude, radiusM: input.radiusM, createdAt: existing?.createdAt ?? now };
  await store.putPlace(place);
  await unfreezeRecent(store, timeZone, now);
  return { ok: true, place };
}

export async function removePlace(store: Store, id: string, timeZone: string, now: number): Promise<void> {
  await store.deletePlace(id);
  await unfreezeRecent(store, timeZone, now);
}

export async function setTrackingMode(store: Store, mode: TrackingMode): Promise<boolean> {
  if (!(TRACKING_MODES as readonly string[]).includes(mode)) return false;
  await store.setTimelineState({ mode });
  return true;
}

/** A stay as the editor got it: its span (unix seconds) and the edit that made it, if one did. */
export type StayRef = { start: number; end: number; overrideId: string | null };
export type StayEdit = { start: number; end: number; placeId: string | null; label: string | null; latitude: number | null; longitude: number | null };
export type EditError = "times" | "future";

/** The longest stay an edit may set: two days, so a typo cannot paint a week. */
const MAX_EDIT_S = 48 * 3600;

/**
 * Replaces a stay: its old span is cleared and the new one written as the owner's. Editing an edit replaces it rather
 * than stacking another on top.
 */
export async function editStay(store: Store, original: StayRef, next: StayEdit, now: number): Promise<{ ok: true } | { ok: false; error: EditError }> {
  if (!(next.end > next.start) || next.end - next.start > MAX_EDIT_S) return { ok: false, error: "times" };
  if (next.end > now + 60) return { ok: false, error: "future" };
  if (original.overrideId) await store.deleteTimelineOverride(original.overrideId);
  const base = { placeId: null, label: null, latitude: null, longitude: null, createdAt: now };
  const clear: TimelineOverride = { ...base, id: newId(), kind: "clear", start: original.start, end: original.end };
  const stay: TimelineOverride = {
    id: newId(),
    kind: "stay",
    start: next.start,
    end: next.end,
    placeId: next.placeId,
    label: next.placeId ? null : next.label?.trim().slice(0, MAX_PLACE_NAME) || null,
    latitude: next.latitude,
    longitude: next.longitude,
    createdAt: now,
  };
  await store.putTimelineOverride(clear);
  await store.putTimelineOverride(stay);
  return { ok: true };
}

/** Removes a stay from the timeline: its span is cleared, and an edit that made it goes. */
export async function deleteStay(store: Store, original: StayRef, now: number): Promise<void> {
  if (original.overrideId) await store.deleteTimelineOverride(original.overrideId);
  await store.putTimelineOverride({ id: newId(), kind: "clear", start: original.start, end: original.end, placeId: null, label: null, latitude: null, longitude: null, createdAt: now });
}
