// The in-app update notice. Once a day Pulse asks GitHub for its latest release, the one request it makes on its own,
// carrying nothing about the person (docs/releases.md). When a newer version is out, Home and More show it; Update
// downloads the APK for this phone's CPU into the app's cache and hands it to Android's installer, which asks the person
// to confirm (and, the first time, to let Pulse install apps). Installing over the old version keeps the data, as long
// as the APK is signed with the same key. Settings › App turns the check off.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { useSyncExternalStore } from "react";
import { apkFor, isNewer, parseRelease, type Release } from "@/lib/release";
import { APP_VERSION } from "@/queries/settings";

/** GitHub's latest-release endpoint for Pulse's repository. */
export const RELEASES_URL = "https://api.github.com/repos/adityaongit/pulse-mobile/releases/latest";

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
/** The last check: when, and the release it found ({ checkedAt, release }). */
const CACHE_KEY = "pulse.update";
/** The version the person chose "Later" for: its notice stays hidden until a newer one is out. */
const LATER_KEY = "pulse.update.later";
/** "off" when the person turned the check off. */
const CHECK_KEY = "pulse.update.check";
/** Android's FLAG_GRANT_READ_URI_PERMISSION: the installer may read the APK through Pulse's file provider. */
const GRANT_READ_URI = 1;

export type UpdateState = {
  /** Whether Pulse checks for updates. */
  enabled: boolean;
  /** A newer release with an APK for this phone, not put off with "Later"; null when there is none. */
  available: (Release & { apk: string }) | null;
  /** The download, while it runs: 0 to 1. */
  progress: number | null;
};

let state: UpdateState = { enabled: true, available: null, progress: null };
const listeners = new Set<() => void>();
const patch = (p: Partial<UpdateState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useUpdate = () => useSyncExternalStore(subscribe, () => state);
export const getUpdate = () => state;

/** The release's notice for this phone: a later version than this one, with an APK for its CPU, not put off. */
async function noticeFor(release: Release | null) {
  if (!release || !isNewer(release.version, APP_VERSION)) return null;
  const apk = apkFor(release, Device.supportedCpuArchitectures ?? []);
  const later = await AsyncStorage.getItem(LATER_KEY).catch(() => null);
  return apk && later !== release.version ? { ...release, apk } : null;
}

/** GitHub's latest release, or null when it cannot be read (offline, rate-limited): the next check tries again. */
async function fetchLatest(): Promise<Release | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" }, signal: ctl.signal });
    return res.ok ? parseRelease(await res.json()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Checks at most once a day (or now, `force`), unless the person turned it off. Called as the app opens. */
export async function checkForUpdate(force = false): Promise<void> {
  const enabled = (await AsyncStorage.getItem(CHECK_KEY).catch(() => null)) !== "off";
  patch({ enabled });
  if (!enabled) return patch({ available: null });
  const cached = JSON.parse((await AsyncStorage.getItem(CACHE_KEY).catch(() => null)) ?? "null") as { checkedAt: number; release: Release | null } | null;
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_EVERY_MS) return patch({ available: await noticeFor(cached.release) });
  const release = await fetchLatest();
  if (release) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), release })).catch(() => {});
  patch({ available: await noticeFor(release ?? cached?.release ?? null) });
}

export async function setUpdateCheck(on: boolean): Promise<void> {
  await AsyncStorage.setItem(CHECK_KEY, on ? "on" : "off");
  await checkForUpdate(on);
}

/** "Later": hides this version's notice; a newer release shows again. */
export async function putOffUpdate(): Promise<void> {
  if (state.available) await AsyncStorage.setItem(LATER_KEY, state.available.version);
  patch({ available: null });
}

/** Downloads the APK into the cache and opens Android's installer on it. Throws when the download or the hand-off fails. */
export async function installUpdate(): Promise<void> {
  const u = state.available;
  if (!u || state.progress !== null) return;
  const file = new File(Paths.cache, `pulse-${u.version}.apk`);
  if (file.exists) file.delete();
  patch({ progress: 0 });
  try {
    const task = File.createDownloadTask(u.apk, file, { onProgress: ({ bytesWritten, totalBytes }) => totalBytes > 0 && patch({ progress: bytesWritten / totalBytes }) });
    const done = await task.downloadAsync();
    if (!done) throw new Error("download_paused");
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", { data: done.contentUri, type: "application/vnd.android.package-archive", flags: GRANT_READ_URI });
  } finally {
    patch({ progress: null });
  }
}
