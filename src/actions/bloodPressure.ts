import { z } from "zod";
import type { BloodPressurePosture, BloodPressureReadingRow } from "@/data/types";
import { localDay } from "@/lib/time";
import { runPipeline } from "@/pipeline";
import type { ActionCtx } from "./journal";

export const BloodPressureCalibrationSchema = z
  .object({
    systolicMmHg: z.number().int().min(60).max(260),
    diastolicMmHg: z.number().int().min(30).max(160),
    pulseBpm: z.number().int().min(30).max(220).nullable().optional(),
    posture: z.enum(["sitting", "supine", "standing"]).nullable().optional(),
    timestampMs: z.number().int().positive().optional(),
  })
  .refine((data) => data.systolicMmHg > data.diastolicMmHg, {
    message: "Systolic pressure must exceed diastolic pressure.",
    path: ["systolicMmHg"],
  });

export type BloodPressureCalibrationInput = z.infer<typeof BloodPressureCalibrationSchema>;

export type BloodPressureActionDeps = Pick<ActionCtx, "store" | "profile"> & {
  onChanged?: () => void;
};

export async function logBloodPressureCalibration(
  input: BloodPressureCalibrationInput,
  deps: BloodPressureActionDeps,
): Promise<BloodPressureReadingRow> {
  const parsed = BloodPressureCalibrationSchema.parse(input);
  const { store, profile, onChanged } = deps;
  const timestampMs = parsed.timestampMs ?? Date.now();
  const date = localDay(Math.floor(timestampMs / 1000), profile.timeZone);
  const id = `manual-bp-${timestampMs}-${parsed.systolicMmHg}-${parsed.diastolicMmHg}`;
  const row: BloodPressureReadingRow = {
    id,
    timestampMs,
    date,
    systolicMmHg: parsed.systolicMmHg,
    diastolicMmHg: parsed.diastolicMmHg,
    pulseBpm: parsed.pulseBpm ?? null,
    posture: (parsed.posture as BloodPressurePosture | null | undefined) ?? null,
    source: "manual",
  };
  await store.upsertBloodPressureReadings([row]);
  await store.markIntradayDirty([date]);
  await runPipeline(store, profile);
  onChanged?.();
  return row;
}

export async function deleteBloodPressureCalibration(
  id: string,
  deps: BloodPressureActionDeps,
): Promise<void> {
  const { store, profile, onChanged } = deps;
  const existing = (await store.getBloodPressureReadings()).find((r) => r.id === id);
  await store.deleteBloodPressureReading(id);
  if (existing) await store.markIntradayDirty([existing.date]);
  await runPipeline(store, profile);
  onChanged?.();
}
