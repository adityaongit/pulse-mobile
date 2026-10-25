// Decoupled additive blood pressure term for Pulse Age (pure TypeScript, zero I/O).
import { clamp } from "./math";
import type { BloodPressureProtocolResult } from "./bloodPressureProtocol";
import type { Sex } from "./sleep";
import manifestJson from "./models/pulseAgeBpManifest.json";

export type PulseAgeBpManifest = {
  model: string;
  modelVersion: number;
  bpFeatureVersion: number;
  outcome: string;
  approvedAt: string;
  coefficientArtifactHash: string;
  trainingCohort: string;
  externalValidationCohort: string;
  referenceSbp: number;
  minSbpBound: number;
  maxSbpBound: number;
  maxCreditYears: number;
  maxPenaltyYears: number;
  coefficients: {
    linearTerm: number;
    knots: readonly number[];
    splineWeights: readonly number[];
  };
};

export const PULSE_AGE_BP_MANIFEST: PulseAgeBpManifest = manifestJson;

/**
 * Evaluates the bounded monotonic spline delta years for a protocol-grade blood pressure input.
 * Returns 0.0 when `input` is ineligible.
 */
export function calculateBpYears(
  input: BloodPressureProtocolResult | null | undefined,
  manifest: PulseAgeBpManifest = PULSE_AGE_BP_MANIFEST,
  _age?: number,
  _sex?: Sex,
): number {
  if (!input || !input.eligible) return 0;
  const x = clamp(input.systolicMean, manifest.minSbpBound, manifest.maxSbpBound);
  const { linearTerm, knots, splineWeights } = manifest.coefficients;
  let years = linearTerm * (x - manifest.referenceSbp);
  for (let i = 0; i < Math.min(knots.length, splineWeights.length); i++) {
    if (x > knots[i]) years += splineWeights[i] * (x - knots[i]);
  }
  return clamp(years, manifest.maxCreditYears, manifest.maxPenaltyYears);
}
