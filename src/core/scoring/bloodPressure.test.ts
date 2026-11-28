import { describe, expect, it } from "vitest";
import { classifyBloodPressure, formatBloodPressure } from "./bloodPressure";

describe("classifyBloodPressure", () => {
  it("classifies normal readings (<120 and <80)", () => {
    expect(classifyBloodPressure(110, 70)).toBe("normal");
    expect(classifyBloodPressure(119, 79)).toBe("normal");
    expect(classifyBloodPressure(90, 60)).toBe("normal");
  });

  it("classifies elevated readings (120-129 and <80)", () => {
    expect(classifyBloodPressure(120, 75)).toBe("elevated");
    expect(classifyBloodPressure(125, 79)).toBe("elevated");
    expect(classifyBloodPressure(129, 70)).toBe("elevated");
  });

  it("classifies stage 1 hypertension (130-139 or 80-89)", () => {
    expect(classifyBloodPressure(130, 75)).toBe("stage1");
    expect(classifyBloodPressure(135, 79)).toBe("stage1");
    expect(classifyBloodPressure(139, 70)).toBe("stage1");
    expect(classifyBloodPressure(115, 80)).toBe("stage1");
    expect(classifyBloodPressure(118, 85)).toBe("stage1");
    expect(classifyBloodPressure(125, 82)).toBe("stage1");
    expect(classifyBloodPressure(135, 85)).toBe("stage1");
  });

  it("classifies stage 2 hypertension (>=140 or >=90)", () => {
    expect(classifyBloodPressure(140, 70)).toBe("stage2");
    expect(classifyBloodPressure(150, 85)).toBe("stage2");
    expect(classifyBloodPressure(115, 90)).toBe("stage2");
    expect(classifyBloodPressure(115, 95)).toBe("stage2");
    expect(classifyBloodPressure(140, 90)).toBe("stage2");
    expect(classifyBloodPressure(170, 100)).toBe("stage2");
    // Boundary: exactly 180 and 120 is stage 2 (crisis is strictly >180 or >120)
    expect(classifyBloodPressure(180, 120)).toBe("stage2");
    expect(classifyBloodPressure(180, 80)).toBe("stage2");
    expect(classifyBloodPressure(130, 120)).toBe("stage2");
  });

  it("classifies hypertensive crisis (>180 or >120)", () => {
    expect(classifyBloodPressure(181, 80)).toBe("crisis");
    expect(classifyBloodPressure(120, 121)).toBe("crisis");
    expect(classifyBloodPressure(181, 121)).toBe("crisis");
    expect(classifyBloodPressure(200, 130)).toBe("crisis");
    expect(classifyBloodPressure(190, 70)).toBe("crisis");
  });

  it("assigns the higher category when systolic and diastolic are discordant", () => {
    // Normal systolic (<120), higher diastolic
    expect(classifyBloodPressure(110, 82)).toBe("stage1");
    expect(classifyBloodPressure(110, 92)).toBe("stage2");
    expect(classifyBloodPressure(110, 122)).toBe("crisis");

    // Elevated systolic (120-129), higher diastolic
    expect(classifyBloodPressure(125, 85)).toBe("stage1");
    expect(classifyBloodPressure(125, 95)).toBe("stage2");
    expect(classifyBloodPressure(125, 125)).toBe("crisis");

    // Stage 1 systolic (130-139), higher diastolic
    expect(classifyBloodPressure(135, 92)).toBe("stage2");
    expect(classifyBloodPressure(135, 125)).toBe("crisis");

    // Stage 2 systolic (>=140), higher diastolic
    expect(classifyBloodPressure(160, 125)).toBe("crisis");

    // Higher systolic than diastolic
    expect(classifyBloodPressure(135, 65)).toBe("stage1");
    expect(classifyBloodPressure(155, 75)).toBe("stage2");
    expect(classifyBloodPressure(185, 75)).toBe("crisis");
  });
});

describe("classifyBloodPressure at every boundary", () => {
  // [systolic, diastolic, category]: each threshold's last value below and first value on it, from either reading.
  const AHA: [number, number, string][] = [
    [119, 79, "normal"],
    [120, 79, "elevated"],
    [129, 79, "elevated"],
    [130, 79, "stage1"],
    [119, 80, "stage1"],
    [139, 89, "stage1"],
    [140, 70, "stage2"],
    [119, 90, "stage2"],
    [180, 120, "stage2"],
    [181, 70, "crisis"],
    [119, 121, "crisis"],
  ];
  const ESH: [number, number, string][] = [
    [119, 79, "optimal"],
    [120, 79, "normal"],
    [119, 80, "normal"],
    [129, 84, "normal"],
    [130, 84, "highNormal"],
    [129, 85, "highNormal"],
    [139, 89, "highNormal"],
    [140, 89, "isolatedSystolic"],
    [159, 60, "isolatedSystolic"],
    [139, 90, "grade1"],
    [140, 90, "grade1"],
    [159, 99, "grade1"],
    [160, 89, "grade2"],
    [159, 100, "grade2"],
    [179, 109, "grade2"],
    [180, 89, "grade3"],
    [179, 110, "grade3"],
    [180, 110, "grade3"],
  ];

  it.each(AHA)("AHA/ACC: %i/%i is %s, also by default", (sys, dia, category) => {
    expect(classifyBloodPressure(sys, dia, "aha")).toBe(category);
    expect(classifyBloodPressure(sys, dia)).toBe(category);
  });

  it.each(ESH)("ESH: %i/%i is %s", (sys, dia, category) => {
    expect(classifyBloodPressure(sys, dia, "esh")).toBe(category);
  });

  it("a reading the two disagree on: 125/82 is AHA stage 1 and ESH normal", () => {
    expect([classifyBloodPressure(125, 82, "aha"), classifyBloodPressure(125, 82, "esh")]).toEqual(["stage1", "normal"]);
  });
});

describe("formatBloodPressure", () => {
  it("formats valid systolic and diastolic values", () => {
    expect(formatBloodPressure(120, 80)).toBe("120/80");
    expect(formatBloodPressure(120.4, 79.6)).toBe("120/80");
  });

  it("returns placeholder when any value is missing or invalid", () => {
    expect(formatBloodPressure(null, 80)).toBe("--/--");
    expect(formatBloodPressure(120, null)).toBe("--/--");
    expect(formatBloodPressure(null, null)).toBe("--/--");
    expect(formatBloodPressure(undefined, undefined)).toBe("--/--");
    expect(formatBloodPressure(Number.NaN, 80)).toBe("--/--");
  });
});
