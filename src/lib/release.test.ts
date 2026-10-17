import { describe, expect, it } from "vitest";
import { apkFor, isNewer, parseRelease } from "./release";

const asset = (name: string) => ({ name, browser_download_url: `https://github.com/x/releases/download/v0.4.0/${name}` });
const LATEST = {
  tag_name: "v0.4.0",
  html_url: "https://github.com/adityaongit/pulse-mobile/releases/tag/v0.4.0",
  assets: [asset("pulse-mobile-0.4.0-arm64.apk"), asset("pulse-mobile-0.4.0-armv7.apk"), asset("pulse-mobile-0.4.0-x86_64.apk"), asset("notes.txt")],
};

describe("releases (release.ts)", () => {
  it("reads GitHub's latest release: its version, page and APKs by architecture", () => {
    const r = parseRelease(LATEST)!;
    expect(r.version).toBe("0.4.0");
    expect(r.page).toBe(LATEST.html_url);
    expect(Object.keys(r.apks).sort()).toEqual(["arm64", "armv7", "x86_64"]);
    expect(parseRelease({ ...LATEST, prerelease: true })).toBeNull();
    expect(parseRelease({ ...LATEST, tag_name: "nightly" })).toBeNull();
    expect(parseRelease({ message: "API rate limit exceeded" })).toBeNull();
  });

  it("compares versions part by part, never as text", () => {
    expect(isNewer("0.4.0", "0.3.0")).toBe(true);
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.3.0", "0.3.0")).toBe(false);
    expect(isNewer("0.2.9", "0.3.0")).toBe(false);
    expect(isNewer("1.0", "0.3.0")).toBe(false);
  });

  it("picks the phone's preferred architecture the release has", () => {
    const r = parseRelease(LATEST)!;
    expect(apkFor(r, ["arm64-v8a", "armeabi-v7a", "armeabi"])).toBe(r.apks.arm64);
    expect(apkFor(r, ["armeabi-v7a", "armeabi"])).toBe(r.apks.armv7);
    expect(apkFor({ ...r, apks: { armv7: r.apks.armv7 } }, ["arm64-v8a", "armeabi-v7a"])).toBe(r.apks.armv7);
    expect(apkFor(r, ["mips"])).toBeNull();
  });
});
