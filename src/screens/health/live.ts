// The live heart-rate pull. The web polls `/heart-rate?since=` every minute while the page is open (pulse
// src/app/heart-rate/route.ts, which runs the worker's throttled `pullHeartRate`); the app calls this function on
// the same schedule from the screen's focus effect (HeartRateScreen.tsx) and re-reads the day from the store.
//
// STUB: Google connect is not built yet, so there is nothing to pull from. When it lands, this becomes
// `createGoogleSource(deps).pullHeartRate()` (src/google/sync.ts: one heart-rate list from the newest stored sample to
// now, written to the store) and returns `{ connected: true, changed: true }`. It must never throw for "not connected":
// the caller treats a throw as a failed poll and backs off (60 s doubling to 10 minutes, as the web does).
export type LivePull = { connected: false } | { connected: true; changed: boolean };

export async function pullLiveHeartRate(): Promise<LivePull> {
  return { connected: false };
}
