/** The classification the person picks (Settings › App): AHA/ACC 2017 (the default) or ESH 2023. */
export type BpGuideline = "aha" | "esh";

export type AhaCategory = "normal" | "elevated" | "stage1" | "stage2" | "crisis";
export type EshCategory = "optimal" | "normal" | "highNormal" | "grade1" | "grade2" | "grade3" | "isolatedSystolic";
export type BloodPressureCategory = AhaCategory | EshCategory;

/** Each guideline's categories, lowest first. */
export const BP_CATEGORIES = {
  aha: ["normal", "elevated", "stage1", "stage2", "crisis"],
  esh: ["optimal", "normal", "highNormal", "grade1", "isolatedSystolic", "grade2", "grade3"],
} as const satisfies Record<BpGuideline, readonly BloodPressureCategory[]>;

export const BP_CATEGORY_LABELS = {
  normal: "Normal",
  elevated: "Elevated",
  stage1: "Stage 1",
  stage2: "Stage 2",
  crisis: "Severe hypertension",
} as const satisfies Record<AhaCategory, string>;

/**
 * Categorizes resting blood pressure readings according to AHA/ACC guidelines (reference study,
 * `other-calculators.md` § Blood pressure categories). The top category is the study's ahaSevereHypertension; the
 * key stays "crisis" so stored rows keep their meaning.
 * When systolic and diastolic readings fall into different categories, the higher
 * category is assigned.
 *
 * - Severe hypertension: Systolic > 180 and/or Diastolic > 120
 * - Stage 2: Systolic >= 140 or Diastolic >= 90
 * - Stage 1: Systolic 130-139 or Diastolic 80-89
 * - Elevated: Systolic 120-129 and Diastolic < 80
 * - Normal: Systolic < 120 and Diastolic < 80
 */
export function classifyBloodPressure(
  systolic: number,
  diastolic: number,
  guideline: BpGuideline = "aha",
): BloodPressureCategory {
  if (guideline === "esh") return classifyEsh(systolic, diastolic);
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

/**
 * The 2023 ESH guideline's office blood pressure categories (Mancia et al., J Hypertens 2023;41:1874). The
 * higher of systolic and diastolic sets the category.
 *
 * - Grade 3: Systolic >= 180 and/or Diastolic >= 110
 * - Grade 2: Systolic 160-179 and/or Diastolic 100-109
 * - Isolated systolic hypertension: Systolic >= 140 and Diastolic < 90. ESH grades it by systolic, so from 160 it
 *   reads as grade 2 or 3 above, and here only 140-159.
 * - Grade 1: Systolic 140-159 and/or Diastolic 90-99
 * - High normal: Systolic 130-139 and/or Diastolic 85-89
 * - Normal: Systolic 120-129 and/or Diastolic 80-84
 * - Optimal: Systolic < 120 and Diastolic < 80
 */
function classifyEsh(systolic: number, diastolic: number): EshCategory {
  if (systolic >= 180 || diastolic >= 110) return "grade3";
  if (systolic >= 160 || diastolic >= 100) return "grade2";
  if (systolic >= 140 && diastolic < 90) return "isolatedSystolic";
  if (systolic >= 140 || diastolic >= 90) return "grade1";
  if (systolic >= 130 || diastolic >= 85) return "highNormal";
  if (systolic >= 120 || diastolic >= 80) return "normal";
  return "optimal";
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
