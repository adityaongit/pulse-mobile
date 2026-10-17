// Pulse's releases on GitHub (docs/releases.md), read for the in-app update notice (src/state/update.ts): the latest
// release's version and its APKs, one per CPU architecture, and which one a phone takes. Pure, so it is tested in Node.

/** Each CPU architecture Android reports (Build.SUPPORTED_ABIS) and the suffix of its APK in a release. */
export const ABI_ASSET: Record<string, string> = {
  "arm64-v8a": "arm64",
  "armeabi-v7a": "armv7",
  x86_64: "x86_64",
};

export type Release = { version: string; page: string; apks: Record<string, string> };

type GithubRelease = { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
type GithubAsset = { name?: unknown; browser_download_url?: unknown };

/** GitHub's "latest release" answer → the version and its APKs by suffix, or null for anything else. */
export function parseRelease(json: unknown): Release | null {
  const r = json as GithubRelease | null;
  if (!r || typeof r.tag_name !== "string" || typeof r.html_url !== "string" || r.draft === true || r.prerelease === true) return null;
  const version = r.tag_name.startsWith("v") ? r.tag_name.slice(1) : r.tag_name;
  if (!parseVersion(version)) return null;
  const apks: Record<string, string> = {};
  for (const a of Array.isArray(r.assets) ? (r.assets as GithubAsset[]) : []) {
    if (typeof a.name !== "string" || typeof a.browser_download_url !== "string") continue;
    // pulse-mobile-<version>-<suffix>.apk (scripts/github-release.sh).
    const prefix = `pulse-mobile-${version}-`;
    if (a.name.startsWith(prefix) && a.name.endsWith(".apk")) apks[a.name.slice(prefix.length, -".apk".length)] = a.browser_download_url;
  }
  return { version, page: r.html_url, apks };
}

/** "0.4.1" → [0, 4, 1]; null for anything that is not three whole numbers. */
function parseVersion(v: string): [number, number, number] | null {
  const parts = v.split(".");
  if (parts.length !== 3) return null;
  const digits = (p: string) => p.length > 0 && [...p].every((ch) => ch >= "0" && ch <= "9");
  return parts.every(digits) ? (parts.map(Number) as [number, number, number]) : null;
}

/** Whether `latest` is a later version than `current` (both "major.minor.patch"). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The APK for a phone: its first supported architecture (Android lists the preferred one first) that the release has. */
export function apkFor(release: Release, abis: readonly string[]): string | null {
  for (const abi of abis) {
    const url = ABI_ASSET[abi] && release.apks[ABI_ASSET[abi]];
    if (url) return url;
  }
  return null;
}
