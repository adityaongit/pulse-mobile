import { describe, expect, it } from "vitest";
import { originBreakdown } from "./origins";

const FITBIT = "com.fitbit.FitbitMobile";
const rec = (id: string, origin: string, deviceType: number | null) => ({
  metadata: { id, dataOrigin: origin, ...(deviceType != null && { device: { type: deviceType } }) },
});

describe("originBreakdown", () => {
  it("counts records per app and device type, most first", () => {
    const xs = [rec("1", FITBIT, 1), rec("2", FITBIT, 1), rec("3", FITBIT, 2), rec("4", "com.sec.android.app.shealth", null)];
    expect(originBreakdown(xs)).toEqual([`${FITBIT}/watch: 2`, `${FITBIT}/phone: 1`, "com.sec.android.app.shealth/no device: 1"]);
  });
});
