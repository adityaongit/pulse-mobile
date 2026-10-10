import { describe, expect, it } from "vitest";
import { canonicalZone, describeZone, matchZones, offsetOf, zones } from "./timeZones";

describe("time zone list", () => {
  it("names offsets as the web does: GMT+5:30, GMT-8, GMT+0, GMT+5:45", () => {
    const winter = Date.parse("2026-01-15T12:00:00Z") / 1000;
    expect(offsetOf("Asia/Kolkata", winter)).toEqual({ offset: "GMT+5:30", minutes: 330 });
    expect(offsetOf("America/Los_Angeles", winter)).toEqual({ offset: "GMT-8", minutes: -480 });
    expect(offsetOf("UTC", winter)).toEqual({ offset: "GMT+0", minutes: 0 });
    expect(offsetOf("Asia/Kathmandu", winter)).toEqual({ offset: "GMT+5:45", minutes: 345 });
    expect(offsetOf("America/St_Johns", winter)).toEqual({ offset: "GMT-3:30", minutes: -210 });
  });

  it("lists today's names (no Asia/Calcutta), by offset then city, each zone once", () => {
    const all = zones();
    expect(all.length).toBeGreaterThan(380);
    expect(all.map((z) => z.id)).toContain("Asia/Kolkata");
    expect(all.map((z) => z.id)).not.toContain("Asia/Calcutta");
    expect(new Set(all.map((z) => z.id)).size).toBe(all.length);
    expect(all.every((z, i) => i === 0 || all[i - 1].minutes <= z.minutes)).toBe(true);
    expect(canonicalZone("Asia/Calcutta")).toBe("Asia/Kolkata");
  });

  it("describes a zone as city, region and offset, and leaves an unknown id as it is", () => {
    expect(describeZone("Asia/Kolkata")).toMatch(/^Kolkata, Asia \(GMT\+5:30\)$/);
    expect(describeZone("Asia/Calcutta")).toMatch(/^Kolkata, Asia/);
    expect(describeZone("Mars/Base")).toBe("Mars/Base");
  });

  it("searches by city, region or offset, every word, at most 80", () => {
    expect(matchZones("kolkata").map((z) => z.id)).toEqual(["Asia/Kolkata"]);
    expect(matchZones("asia  GMT+5:30").map((z) => z.id)).toContain("Asia/Kolkata");
    expect(matchZones("no such place")).toEqual([]);
    expect(matchZones("a").length).toBe(80);
    expect(matchZones("").length).toBe(zones().length);
  });
});
