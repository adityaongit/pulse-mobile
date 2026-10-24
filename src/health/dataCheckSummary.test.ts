import { describe, expect, it } from "vitest";
import { emptyMetrics } from "@/data/types";
import { formatReport, summarize, type RawRecord } from "./dataCheckSummary";

const TZ = "Asia/Kolkata";
const at = (day: string, t: string) => `${day}T${t}+05:30`;
const fitbit = (type?: number) => ({ dataOrigin: "com.fitbit.FitbitMobile", device: type == null ? null : { type } });

describe("data check summary", () => {
  it("splits a day's steps by app and device and shows what Pulse stored", () => {
    const steps: RawRecord[] = [
      { metadata: fitbit(1), startTime: at("2026-10-06", "08:00:00"), endTime: at("2026-10-06", "09:00:00"), count: 4000 },
      { metadata: fitbit(1), startTime: at("2026-10-06", "18:00:00"), endTime: at("2026-10-06", "19:00:00"), count: 2000 },
      { metadata: fitbit(2), startTime: at("2026-10-06", "08:00:00"), endTime: at("2026-10-06", "09:00:00"), count: 4500 },
    ];
    const spo2: RawRecord[] = [{ metadata: fitbit(1), time: at("2026-10-06", "06:30:00"), percentage: 96 }];
    const m = { ...emptyMetrics("2026-10-06"), steps: 6000, spo2Pct: 96 };
    const [day] = summarize({ Steps: steps, OxygenSaturation: spo2 }, [], [m], [], ["2026-10-06"], TZ);
    const st = day.metrics.find((x) => x.key === "steps")!;
    expect(st.pulse).toBe(6000);
    expect(st.sources.map((s) => [s.source, s.value])).toEqual([
      ["Fitbit app/watch", 6000],
      ["Fitbit app/phone", 4500],
    ]);
    const sp = day.metrics.find((x) => x.key === "spo2")!;
    expect(sp.sources[0].detail).toBe("06:30 96");
    const text = formatReport([day]);
    expect(text).toContain("Steps: Pulse 6000");
    expect(text).toContain("Fitbit app/watch: 6000");
  });
});
