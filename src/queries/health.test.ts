import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import type { BloodPressureReading } from "@/data/types";
import { getMonitor } from "./health";
import type { QueryCtx } from "./ctx";

const TZ = "UTC";

async function makeCtx(store: MemoryStore, today = "2026-05-15"): Promise<QueryCtx> {
  return {
    store,
    timeZone: TZ,
    profile: { birthDate: "1990-01-01", sex: "male", maxHr: 185, heightCm: 175, timeZone: TZ },
    today,
    now: Date.parse(`${today}T12:00:00Z`) / 1000,
    sync: await store.getSyncState(),
  };
}

function makeReading(
  id: string,
  day: string,
  timeStr: string,
  sys: number,
  dia: number,
): BloodPressureReading {
  return {
    id,
    day,
    ts: Date.parse(`${day}T${timeStr}Z`) / 1000,
    systolicMmhg: sys,
    diastolicMmhg: dia,
    bodyPosition: "sitting",
    measurementLocation: "left_upper_arm",
    quality: "direct",
    importedAt: Date.now() / 1000,
  };
}

describe("getMonitor with blood pressure", () => {
  it("includes blood pressure as 6th vital and attaches bloodPressure summary", async () => {
    const store = new MemoryStore();
    const reading = makeReading("bp-1", "2026-05-15", "08:15:00", 118, 76);
    await store.insertBloodPressure([reading]);

    const ctx = await makeCtx(store, "2026-05-15");
    const vm = await getMonitor("2026-05-15", ctx);

    // 6 vitals: resp, spo2, restingHr, hrv, skinTempDev, bp
    expect(vm.vitals).toHaveLength(6);
    const bpVital = vm.vitals.find((v) => v.key === "bp");
    expect(bpVital).toBeDefined();
    expect(bpVital?.label).toBe("Blood pressure");
    expect(bpVital?.short).toBe("BP");
    expect(bpVital?.unit).toBe("mmHg");
    expect(bpVital?.customValue).toBe("118/76");
    expect(bpVital?.status).toBe("in_range");
    expect(bpVital?.chip).toEqual({ tone: "optimal", text: "Normal" });
    expect(bpVital?.bp).toEqual({
      systolic: 118,
      diastolic: 76,
      category: "normal",
    });

    // Summary attached to monitor
    expect(vm.bloodPressure).toBeDefined();
    expect(vm.bloodPressure.latest.value).toMatchObject({
      id: "bp-1",
      systolic: 118,
      diastolic: 76,
      category: "normal",
      time: "08:15",
    });
  });

  it("handles elevated or hypertension stages with appropriate chips and status", async () => {
    const store = new MemoryStore();
    const reading = makeReading("bp-stage2", "2026-05-15", "14:00:00", 145, 92);
    await store.insertBloodPressure([reading]);

    const ctx = await makeCtx(store, "2026-05-15");
    const vm = await getMonitor("2026-05-15", ctx);

    const bpVital = vm.vitals.find((v) => v.key === "bp");
    expect(bpVital?.status).toBe("high");
    expect(bpVital?.chip).toEqual({ tone: "alert", text: "Stage 2" });
    expect(bpVital?.bp?.category).toBe("stage2");
  });

  it("shows prior reading chip when current day has no reading but prior exists", async () => {
    const store = new MemoryStore();
    const reading = makeReading("bp-prior", "2026-05-10", "11:00:00", 124, 78);
    await store.insertBloodPressure([reading]);

    const ctx = await makeCtx(store, "2026-05-15");
    const vm = await getMonitor("2026-05-15", ctx);

    const bpVital = vm.vitals.find((v) => v.key === "bp");
    expect(bpVital?.status).toBe("no_data");
    expect(bpVital?.customValue).toBeUndefined();
    expect(bpVital?.chip).toEqual({ tone: "neutral", text: "Prior: 124/78" });
    expect(bpVital?.bp).toBeNull();
  });
});
