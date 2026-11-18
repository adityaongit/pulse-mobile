// Distances on the globe for the timeline. Haversine on a spherical Earth: off by under 0.5 %, far inside GPS error.

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const validCoordinate = (latitude: number, longitude: number) =>
  Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;

/**
 * "12.9716, 77.5946" (what a maps app copies), with optional spaces or a semicolon; null when it is not one pair in
 * range. A pasted Google Maps link's "@lat,lon" works too.
 */
export function parseCoordinates(text: string): { latitude: number; longitude: number } | null {
  const m = /(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(text.trim());
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  return validCoordinate(latitude, longitude) ? { latitude, longitude } : null;
}
