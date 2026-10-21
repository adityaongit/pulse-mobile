import { describe, expect, it } from "vitest";
import { trainingGuidance, type CoachingSignals } from "./coaching";
import { suggestionsFor, type SuggestionSignals } from "./coachSuggestions";

const ready: CoachingSignals = { recovery: 80, provisional: false, sleepPerformance: 90, strain: 4, targetHigh: 14, loadStatus: "optimal" };
const signals: SuggestionSignals = { recovery: 80, provisional: false, reason: null, hrv: 60, hrvBaseline: 60, asleepMinutes: 480, strain: 4, targetHigh: 14 };

describe("readiness-based coaching", () => {
  it.each([
    [33, "rest_or_easy"], [34, "controlled"], [66, "controlled"], [67, "build_within_target"],
  ] as const)("Recovery %s gives %s", (recovery, training) => {
    expect(trainingGuidance({ ...ready, recovery }).training).toBe(training);
  });
  it("green readiness never overrides poor sleep, elevated load or an already-reached target", () => {
    expect(trainingGuidance({ ...ready, sleepPerformance: 60 })).toMatchObject({ training: "controlled", constraints: ["poor_sleep"] });
    expect(trainingGuidance({ ...ready, loadStatus: "pushing" }).training).toBe("controlled");
    expect(trainingGuidance({ ...ready, loadStatus: "high_risk" }).training).toBe("rest_or_easy");
    expect(trainingGuidance({ ...ready, strain: 14 }).training).toBe("no_extra_load");
  });
  it("missing or provisional readiness cannot give a green-light prescription", () => {
    expect(trainingGuidance({ ...ready, recovery: null }).training).toBe("ask_and_go_cautiously");
    expect(trainingGuidance({ ...ready, provisional: true }).readiness).toBe("uncertain");
  });
});

describe("contextual questions", () => {
  it("keeps the brief and exactly four distinct questions", () => {
    const result = suggestionsFor(signals);
    expect(result[0]).toEqual({ key: "brief", code: "brief" });
    expect(result).toHaveLength(4);
    expect(new Set(result.map((s) => s.key)).size).toBe(4);
  });
  it("uses the prior HRV baseline and poor sleep without promising a multi-day decline", () => {
    const result = suggestionsFor({ ...signals, hrv: 50, asleepMinutes: 350 });
    expect(result.map((s) => s.key)).toEqual(["brief", "training", "hrv", "sleep"]);
    expect(result.find((s) => s.key === "hrv")?.code).toBe("hrv");
  });
  it("uses the personal strain target before the generic fallback", () => {
    expect(suggestionsFor({ ...signals, strain: 10, targetHigh: 9 }).map((s) => s.key)).toContain("strain");
    expect(suggestionsFor({ ...signals, strain: 14, targetHigh: 17 }).map((s) => s.key)).not.toContain("strain");
  });
  it("missing sync and provisional readiness do not suggest pushing", () => {
    expect(suggestionsFor({ ...signals, recovery: null, reason: "awaiting_sleep_sync" })[1].key).toBe("sync");
    expect(suggestionsFor({ ...signals, provisional: true })[1].key).toBe("recovery");
  });
});
