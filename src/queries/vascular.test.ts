import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/data/memory";
import { seedDemo } from "@/data/seed";
import { runPipeline } from "@/pipeline";
import { addDays } from "@/lib/time";
import { getVascularViewModel } from "./vascular";

describe("getVascularViewModel query", () => {
  it("builds calibrated VascularViewModel with 7d/30d/90d series and cuff history over seeded demo data", async () => {
    const store = new MemoryStore();
    const today = "2026-06-30";
    const profile = await seedDemo(store, { today, timeZone: "UTC", days: 100 });
    await runPipeline(store, profile);

    const vm = await getVascularViewModel(store, today, "UTC");
    expect(vm.available).toBe(true);
    expect(vm.day).toBe(today);
    expect(vm.mode).toBe("calibrated");
    expect(vm.systolic.value).not.toBeNull();
    expect(vm.systolic.lower).toBeLessThan(vm.systolic.value!);
    expect(vm.systolic.upper).toBeGreaterThan(vm.systolic.value!);
    expect(vm.diastolic.value).not.toBeNull();
    expect(vm.pulsePressure.value).toBe(vm.systolic.value! - vm.diastolic.value!);
    expect(vm.meanArterialPressure.value).not.toBeNull();
    expect(vm.calibration.status).toBe("fresh");
    expect(vm.calibration.daysSinceCalibration).toBe(5);
    expect(vm.cuffHistory.length).toBe(3);
    expect(vm.series7d.length).toBe(7);
    expect(vm.series30d.length).toBe(30);
    expect(vm.series90d.length).toBe(90);
    expect(vm.contributors.map((c) => c.key)).toEqual(["rhr", "hrv", "sleepDebt", "acwr", "bmi"]);

    // Early day before the first cuff anchor (today - 60) is uncalibrated
    const earlyDay = addDays(today, -75);
    const earlyVm = await getVascularViewModel(store, earlyDay, "UTC");
    expect(earlyVm.available).toBe(true);
    expect(earlyVm.mode).toBe("uncalibrated");
    expect(earlyVm.systolic.value).toBeNull();
    expect(earlyVm.systolic.reason).toBe("calibration_required");
    expect(earlyVm.systolic.reasonText).toBeTruthy();
  });
});
