// The log sheets' pure logic, from pulse's (app)/journal/Log.test.tsx (the form half): what a sheet sends, and the
// default time. The component cases (tiles, quick add, the reconnect screen) are the owner's check on the phone.
import { describe, expect, it } from "vitest";
import { dateToDay, dateToWall, defaultAt, EMPTY, num, toInput, wallNow, wallToDate } from "./form";

const AT = "2026-10-02T11:30";

describe("wallNow / defaultAt", () => {
  it("reads the clock in the person's zone", () => {
    const t = Date.parse("2026-10-02T06:00:00Z") / 1000;
    expect(wallNow("Asia/Kolkata", t)).toBe("2026-10-02T11:30");
    expect(wallNow("America/Los_Angeles", t)).toBe("2026-10-01T23:00");
  });

  it("logging on a past day defaults the time to that day's noon; today, to now", () => {
    expect(defaultAt({ day: "2026-09-30", today: "2026-10-02", timeZone: "Asia/Kolkata" })).toBe("2026-09-30T12:00");
    expect(defaultAt({ day: "2026-10-02", today: "2026-10-02", timeZone: "Asia/Kolkata" })).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("num", () => {
  it("blank is null, a decimal comma is a point, anything else is NaN", () => {
    expect(num("  ")).toBeNull();
    expect(num("72,4")).toBe(72.4);
    expect(num("330")).toBe(330);
    expect(num("1e3")).toBeNaN();
    expect(num("-5")).toBeNaN();
  });
});

describe("toInput", () => {
  it("water needs a whole number of millilitres", () => {
    expect(toInput("water", { ml: "330" }, AT)).toEqual({ kind: "water", ml: 330, at: AT });
    expect(toInput("water", EMPTY.water, AT)).toBe("Enter the amount in millilitres.");
    expect(toInput("water", { ml: "33.5" }, AT)).toBe("Enter the amount in millilitres.");
  });

  it("food: a meal, whole calories, macros as numbers or blank", () => {
    const f = { name: "Dal", meal: "LUNCH", kcal: "640", protein: "22,5", carbs: "", fat: "18" };
    expect(toInput("food", f, AT)).toEqual({ kind: "food", name: "Dal", meal: "LUNCH", kcal: 640, protein: 22.5, carbs: null, fat: 18, at: AT });
    expect(toInput("food", { ...f, meal: "" }, AT)).toBe("Choose a meal.");
    expect(toInput("food", { ...f, kcal: "6.4" }, AT)).toBe("Enter calories as a whole number.");
    expect(toInput("food", { ...f, fat: "x" }, AT)).toBe("Macros are grams, as numbers.");
  });

  it("weight: kilograms, optional body fat", () => {
    expect(toInput("weight", { kg: "72,4", fat: "" }, AT)).toEqual({ kind: "weight", kg: 72.4, fatPct: null, at: AT });
    expect(toInput("weight", { kg: "", fat: "" }, AT)).toBe("Enter your weight in kilograms.");
    expect(toInput("weight", { kg: "72", fat: "abc" }, AT)).toBe("Body fat is a percentage, as a number.");
  });

  it("mood, symptoms, period and ovulation need their choice; a period has no time", () => {
    expect(toInput("mood", { valence: "", moods: ["CALM"] }, AT)).toEqual({ kind: "mood", moods: ["CALM"], valence: null, at: AT });
    expect(toInput("mood", EMPTY.mood, AT)).toBe("Choose how you feel.");
    expect(toInput("symptoms", EMPTY.symptoms, AT)).toBe("Choose a symptom.");
    expect(toInput("ovulation", EMPTY.ovulation, AT)).toBe("Choose the result.");
    expect(toInput("period", { start: "2026-09-29", end: "", flow: "" }, AT)).toBe("Choose the first and last day.");
    expect(toInput("period", { start: "2026-09-29", end: "2026-10-01", flow: "LIGHT" }, AT)).toEqual({ kind: "period", start: "2026-09-29", end: "2026-10-01", flow: "LIGHT" });
  });
});

describe("wall strings and the device's pickers", () => {
  it("round-trip through a Date with the same digits", () => {
    expect(dateToWall(wallToDate("2026-10-02T11:30"))).toBe("2026-10-02T11:30");
    expect(dateToDay(wallToDate("2026-12-31"))).toBe("2026-12-31");
  });
});
