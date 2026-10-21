export type BloodPressureCategory =
  | "normal"
  | "elevated"
  | "stage1"
  | "stage2"
  | "crisis";

export const BP_CATEGORY_LABELS = {
  normal: "Normal",
  elevated: "Elevated",
  stage1: "Stage 1",
  stage2: "Stage 2",
  crisis: "Crisis",
} as const satisfies Record<BloodPressureCategory, string>;

/**
 * Categorizes resting blood pressure readings according to AHA/ACC guidelines.
 * When systolic and diastolic readings fall into different categories, the higher
 * category is assigned.
 *
 * - Crisis: Systolic > 180 and/or Diastolic > 120
 * - Stage 2: Systolic >= 140 or Diastolic >= 90
 * - Stage 1: Systolic 130-139 or Diastolic 80-89
 * - Elevated: Systolic 120-129 and Diastolic < 80
 * - Normal: Systolic < 120 and Diastolic < 80
 */
export function classifyBloodPressure(
  systolic: number,
  diastolic: number,
): BloodPressureCategory {
  if (systolic > 180 || diastolic > 120) {
    return "crisis";
  }
  if (systolic >= 140 || diastolic >= 90) {
    return "stage2";
  }
  if (systolic >= 130 || diastolic >= 80) {
    return "stage1";
  }
  if (systolic >= 120 && diastolic < 80) {
    return "elevated";
  }
  return "normal";
}

/** Formats systolic and diastolic as standard clinical string "120/80" or "--/--" */
export function formatBloodPressure(
  systolic: number | null | undefined,
  diastolic: number | null | undefined,
): string {
  if (systolic == null || diastolic == null || !Number.isFinite(systolic) || !Number.isFinite(diastolic)) {
    return "--/--";
  }
  return `${Math.round(systolic)}/${Math.round(diastolic)}`;
}
