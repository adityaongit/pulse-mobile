import { describe, expect, it } from "vitest";
import { DASHBOARD_GROUPS, DASHBOARD_LABEL, DASHBOARD_METRICS } from "./dashboard";
import { EXTRA_METRICS } from "./extraMetrics";
import { EXTRA_METRICS as QUERY_EXTRAS, DASHBOARD_LABEL as QUERY_LABEL } from "@/queries/_lib";

describe("metric labels", () => {
  it("every catalogue entry resolves to words, not a missing key", () => {
    for (const m of [...DASHBOARD_METRICS, ...EXTRA_METRICS, ...QUERY_EXTRAS, ...DASHBOARD_GROUPS]) expect(m.label, m.key).not.toMatch(/^(label|group)\./);
    expect(DASHBOARD_LABEL.hrv).toBe("Heart rate variability");
    expect(QUERY_LABEL.steps).toBe("Steps");
    expect(DASHBOARD_GROUPS[0].label).toBe("Recovery & sleep");
  });
});
