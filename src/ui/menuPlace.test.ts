import { describe, expect, it } from "vitest";
import { placeMenu } from "./menuPlace";

const frame = { x: 0, y: 0, w: 402, h: 874 };
const insets = { top: 62, bottom: 34 };

describe("placeMenu", () => {
  it("opens 8 px below the trigger, its width, when it fits", () => {
    expect(placeMenu({ x: 16, y: 130, w: 370, h: 56 }, frame, { w: 370, h: 348 }, insets, "stretch")).toEqual({ left: 16, top: 194, width: 370, maxHeight: 348 });
  });

  it("flips above a trigger near the bottom, never over it", () => {
    const p = placeMenu({ x: 16, y: 700, w: 370, h: 56 }, frame, { w: 370, h: 348 }, insets, "stretch");
    expect(p.top + 348).toBe(692);
  });

  it("stays below when neither side fits but below has more room", () => {
    expect(placeMenu({ x: 16, y: 200, w: 370, h: 56 }, frame, { w: 370, h: 900 }, insets, "stretch").top).toBe(264);
  });

  it("aligns to the trigger's end and keeps inside the screen", () => {
    expect(placeMenu({ x: 346, y: 62, w: 44, h: 44 }, frame, { w: 256, h: 108 }, insets, "end")).toEqual({ left: 134, top: 114, width: undefined, maxHeight: 108 });
    expect(placeMenu({ x: 380, y: 62, w: 44, h: 44 }, frame, { w: 256, h: 108 }, insets, "start").left).toBe(138);
  });

  it("subtracts the modal's own window offset (Android's status bar)", () => {
    expect(placeMenu({ x: 16, y: 106, w: 370, h: 56 }, { ...frame, y: -24 }, { w: 370, h: 348 }, insets, "stretch").top).toBe(194);
  });
});

describe("a panel taller than the room", () => {
  it("is limited to the room on its side so its content can scroll", () => {
    const place = placeMenu({ x: 0, y: 500, w: 100, h: 40 }, { x: 0, y: 0, w: 400, h: 800 }, { w: 200, h: 900 }, { top: 24, bottom: 24 }, "start");
    expect(place.maxHeight).toBeLessThan(900);
    expect(place.top + place.maxHeight).toBeLessThanOrEqual(800);
  });
});
