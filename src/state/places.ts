// A timeline write's follow-up (Settings › Places, the place editor, the stay editor): refresh the screens, and make
// the fences and the fix task match the saved places and mode. The tracking module is native; tests never import this
// file, they call the actions directly.
import { syncPlaceTracking, type TrackingStatus } from "@/background/places";
import { dataChanged } from "./app";

export function placesChanged(): Promise<TrackingStatus> {
  dataChanged("places");
  return syncPlaceTracking();
}

/** An edit to a day's stays: the screens only, tracking is unchanged. */
export function timelineChanged(): void {
  dataChanged("places");
}
