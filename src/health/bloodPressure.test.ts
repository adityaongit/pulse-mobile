import { describe, expect, it } from "vitest";

import { MemoryStore } from "@/data/memory";
import type { BloodPressureReading } from "@/data/types";
import { BloodPressureBodyPosition, BloodPressureMeasurementLocation, createBloodPressureDiagnostics, mapBloodPressure, mapBloodPressureRecords, mapRecords } from "./import";
import { DEVICE_TYPE, RECORDING_METHOD } from "./origins";

const TZ = "America/New_York";
const at = (day: string, time: string) => `${day}T${time}-04:00`;

describe("BloodPressure Ingestion & Validation", () => {
  it("ingests standard and decimal readings preserving precision without rounding", () => {
    const diag = createBloodPressureDiagnostics();
    const records = [
      {
        metadata: { id: "bp-1", dataOrigin: "com.omronhealthcare.omronconnect" },
        time: at("2026-04-10", "08:30:00"),
        systolic: { inMillimetersOfMercury: 120.4 },
        diastolic: { inMillimetersOfMercury: 79.8 },
      },
      {
        metadata: { id: "bp-2", dataOrigin: "com.withings.wiscale2" },
        time: at("2026-04-10", "12:15:00"),
        systolic: 118,
        diastolic: 76,
      },
    ];

    const result = mapBloodPressure(records, TZ, 1775824200, diag);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "bp-1",
      day: "2026-04-10",
      systolicMmhg: 120.4,
      diastolicMmhg: 79.8,
      sourceApplication: "com.omronhealthcare.omronconnect",
      sourcePlatform: "health_connect",
      importedAt: 1775824200,
    });
    expect(result[1]).toMatchObject({
      id: "bp-2",
      day: "2026-04-10",
      systolicMmhg: 118,
      diastolicMmhg: 76,
      sourceApplication: "com.withings.wiscale2",
    });
    expect(diag.total).toBe(2);
    expect(diag.accepted).toBe(2);
    expect(diag.rejected).toBe(0);
  });

  it("rejects non-finite values cleanly without throwing", () => {
    const diag = createBloodPressureDiagnostics();
    const records = [
      {
        metadata: { id: "nan-sys" },
        time: at("2026-04-10", "08:00:00"),
        systolic: { inMillimetersOfMercury: NaN },
        diastolic: { inMillimetersOfMercury: 80 },
      },
      {
        metadata: { id: "inf-dia" },
        time: at("2026-04-10", "08:01:00"),
        systolic: { inMillimetersOfMercury: 120 },
        diastolic: { inMillimetersOfMercury: Infinity },
      },
      {
        metadata: { id: "neg-inf" },
        time: at("2026-04-10", "08:02:00"),
        systolic: { inMillimetersOfMercury: -Infinity },
        diastolic: { inMillimetersOfMercury: 80 },
      },
      {
        metadata: { id: "missing-dia" },
        time: at("2026-04-10", "08:03:00"),
        systolic: { inMillimetersOfMercury: 120 },
      },
    ];

    const result = mapBloodPressure(records, TZ, undefined, diag);
    expect(result).toHaveLength(0);
    expect(diag.total).toBe(4);
    expect(diag.accepted).toBe(0);
    expect(diag.rejected).toBe(4);
    expect(diag.rejectedReasons.non_finite).toBe(3);
    expect(diag.rejectedReasons.missing_values).toBe(1);
  });

  it("rejects invalid or missing timestamps cleanly", () => {
    const diag = createBloodPressureDiagnostics();
    const records = [
      {
        metadata: { id: "no-time" },
        systolic: { inMillimetersOfMercury: 120 },
        diastolic: { inMillimetersOfMercury: 80 },
      },
      {
        metadata: { id: "bad-time" },
        time: "not-a-valid-timestamp",
        systolic: { inMillimetersOfMercury: 120 },
        diastolic: { inMillimetersOfMercury: 80 },
      },
    ];

    const result = mapBloodPressure(records, TZ, undefined, diag);
    expect(result).toHaveLength(0);
    expect(diag.rejectedReasons.invalid_timestamp).toBe(2);
  });

  it("rejects inverted pressures and equal pressures without swapping", () => {
    const diag = createBloodPressureDiagnostics();
    const records = [
      {
        metadata: { id: "inverted" },
        time: at("2026-04-10", "08:00:00"),
        systolic: { inMillimetersOfMercury: 80 },
        diastolic: { inMillimetersOfMercury: 120 },
      },
      {
        metadata: { id: "equal" },
        time: at("2026-04-10", "08:01:00"),
        systolic: { inMillimetersOfMercury: 100 },
        diastolic: { inMillimetersOfMercury: 100 },
      },
    ];

    const result = mapBloodPressure(records, TZ, undefined, diag);
    expect(result).toHaveLength(0);
    expect(diag.rejectedReasons.inverted_pressures).toBe(2);
  });

  it("validates broad physiological boundary envelope (40-300 systolic, 20-200 diastolic)", () => {
    const diag = createBloodPressureDiagnostics();
    const records = [
      // Valid boundaries
      { metadata: { id: "min-bound" }, time: at("2026-04-10", "08:00:00"), systolic: 40, diastolic: 20 },
      { metadata: { id: "max-bound" }, time: at("2026-04-10", "08:01:00"), systolic: 300, diastolic: 200 },
      { metadata: { id: "wide-bound" }, time: at("2026-04-10", "08:02:00"), systolic: 300, diastolic: 40 },
      // Out of bounds
      { metadata: { id: "sys-too-low" }, time: at("2026-04-10", "08:03:00"), systolic: 39.9, diastolic: 20 },
      { metadata: { id: "sys-too-high" }, time: at("2026-04-10", "08:04:00"), systolic: 301, diastolic: 80 },
      { metadata: { id: "dia-too-low" }, time: at("2026-04-10", "08:05:00"), systolic: 120, diastolic: 19.9 },
      { metadata: { id: "dia-too-high" }, time: at("2026-04-10", "08:06:00"), systolic: 250, diastolic: 201 },
    ];

    const result = mapBloodPressure(records, TZ, undefined, diag);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(["min-bound", "max-bound", "wide-bound"]);
    expect(diag.rejectedReasons.out_of_range).toBe(4);
  });

  it("maps bodyPosition and measurementLocation enumerations correctly, preserving unknown raw codes", () => {
    const records = [
      {
        metadata: { id: "enum-1" },
        time: at("2026-04-10", "08:00:00"),
        systolic: 120,
        diastolic: 80,
        bodyPosition: BloodPressureBodyPosition.SITTING_DOWN,
        measurementLocation: BloodPressureMeasurementLocation.LEFT_UPPER_ARM,
      },
      {
        metadata: { id: "enum-2" },
        time: at("2026-04-10", "08:01:00"),
        systolic: 118,
        diastolic: 78,
        bodyPosition: BloodPressureBodyPosition.STANDING_UP,
        measurementLocation: BloodPressureMeasurementLocation.RIGHT_WRIST,
      },
      {
        metadata: { id: "enum-unknown-code" },
        time: at("2026-04-10", "08:02:00"),
        systolic: 122,
        diastolic: 82,
        bodyPosition: 99,
        measurementLocation: 99,
      },
      {
        metadata: { id: "enum-null" },
        time: at("2026-04-10", "08:03:00"),
        systolic: 120,
        diastolic: 80,
        bodyPosition: null,
        measurementLocation: null,
      },
    ];

    const result = mapBloodPressure(records, TZ);
    expect(result[0].bodyPosition).toBe("sitting_down");
    expect(result[0].measurementLocation).toBe("left_upper_arm");

    expect(result[1].bodyPosition).toBe("standing_up");
    expect(result[1].measurementLocation).toBe("right_wrist");

    expect(result[2].bodyPosition).toBe("99");
    expect(result[2].measurementLocation).toBe("99");

    expect(result[3].bodyPosition).toBeNull();
    expect(result[3].measurementLocation).toBeNull();
  });

  it("determines quality flags accurately without mislabeling unknown as direct", () => {
    const records = [
      // Manual entry
      {
        metadata: { id: "manual-rec", recordingMethod: RECORDING_METHOD.RECORDING_METHOD_MANUAL_ENTRY },
        time: at("2026-04-10", "08:00:00"),
        systolic: 120,
        diastolic: 80,
      },
      // Wearable estimate (optical watch/ring)
      {
        metadata: {
          id: "watch-rec",
          recordingMethod: RECORDING_METHOD.RECORDING_METHOD_ACTIVELY_RECORDED,
          device: { type: DEVICE_TYPE.TYPE_WATCH, manufacturer: "Samsung", model: "Galaxy Watch" },
        },
        time: at("2026-04-10", "08:01:00"),
        systolic: 122,
        diastolic: 82,
      },
      // Direct cuff reading
      {
        metadata: {
          id: "cuff-rec",
          recordingMethod: RECORDING_METHOD.RECORDING_METHOD_ACTIVELY_RECORDED,
          device: { type: DEVICE_TYPE.TYPE_UNKNOWN, manufacturer: "Omron", model: "Evolv" },
        },
        time: at("2026-04-10", "08:02:00"),
        systolic: 119,
        diastolic: 79,
      },
      // Unknown measurement (must not be labeled direct)
      {
        metadata: { id: "unknown-rec" },
        time: at("2026-04-10", "08:03:00"),
        systolic: 121,
        diastolic: 81,
      },
    ];

    const result = mapBloodPressure(records, TZ);
    expect(result[0].quality).toBe("manual");
    expect(result[0].recordingMethod).toBe("manual");

    expect(result[1].quality).toBe("derived");
    expect(result[1].sourceDevice).toBe("Samsung Galaxy Watch");

    expect(result[2].quality).toBe("direct");
    expect(result[2].sourceDevice).toBe("Omron Evolv");

    expect(result[3].quality).toBe("unknown");
  });

  it("generates stable composite fallback id when metadata id is missing", () => {
    const records = [
      {
        time: at("2026-04-10", "08:00:00"),
        systolic: 120,
        diastolic: 80,
      },
      {
        time: at("2026-04-10", "08:00:00"),
        systolic: 120,
        diastolic: 80,
      },
    ];

    const result = mapBloodPressure(records, TZ);
    expect(result).toHaveLength(2);
    expect(result[0].id).toMatch(/^bp_1775822400_/);
    expect(result[0].id).toBe(result[1].id);
  });

  it("handles mapRecords with BloodPressure in HealthInput", () => {
    const input = {
      BloodPressure: [
        {
          metadata: { id: "bp-mapped" },
          time: at("2026-04-10", "08:00:00"),
          systolic: 120,
          diastolic: 80,
        },
      ],
    };
    const mapped = mapRecords(input, TZ);
    expect(mapped.bloodPressure).toHaveLength(1);
    expect(mapped.bloodPressure[0].id).toBe("bp-mapped");
  });

  it("keeps duplicate readings in the same minute with different IDs, overwrites same ID without averaging", async () => {
    const records = [
      {
        metadata: { id: "reading-1", dataOrigin: "com.omron" },
        time: at("2026-04-10", "08:00:00"),
        systolic: 120,
        diastolic: 80,
      },
      // Second reading at same minute, same values, but distinct ID
      {
        metadata: { id: "reading-2", dataOrigin: "com.omron" },
        time: at("2026-04-10", "08:00:00"),
        systolic: 120,
        diastolic: 80,
      },
      // Replacement for reading-1
      {
        metadata: { id: "reading-1", dataOrigin: "com.omron" },
        time: at("2026-04-10", "08:00:00"),
        systolic: 125,
        diastolic: 85,
      },
    ];

    const mapped = mapBloodPressure(records, TZ);
    expect(mapped).toHaveLength(3);

    const store = new MemoryStore();
    await store.upsertBloodPressure(mapped);

    const stored = await store.allBloodPressure();
    // reading-1 was replaced with 125/85, reading-2 remains 120/80
    expect(stored).toHaveLength(2);
    const r1 = stored.find((r) => r.id === "reading-1");
    const r2 = stored.find((r) => r.id === "reading-2");
    expect(r1?.systolicMmhg).toBe(125);
    expect(r2?.systolicMmhg).toBe(120);
  });
});

describe("BloodPressure Store Operations", () => {
  it("supports upsert, query by day, query by day range, and timestamp range", async () => {
    const store = new MemoryStore();
    const r1: BloodPressureReading = {
      id: "r1",
      ts: 1775800000,
      day: "2026-04-10",
      systolicMmhg: 120,
      diastolicMmhg: 80,
      quality: "direct",
      importedAt: 1775800000,
    };
    const r2: BloodPressureReading = {
      id: "r2",
      ts: 1775810000,
      day: "2026-04-10",
      systolicMmhg: 124,
      diastolicMmhg: 82,
      quality: "manual",
      importedAt: 1775810000,
    };
    const r3: BloodPressureReading = {
      id: "r3",
      ts: 1775900000,
      day: "2026-04-11",
      systolicMmhg: 118,
      diastolicMmhg: 78,
      quality: "derived",
      importedAt: 1775900000,
    };

    await store.upsertBloodPressure([r1, r2, r3]);

    // allBloodPressure (ordered newest first)
    const all = await store.allBloodPressure();
    expect(all.map((r) => r.id)).toEqual(["r3", "r2", "r1"]);

    // getBloodPressure for specific day
    const day10 = await store.getBloodPressure("2026-04-10");
    expect(day10.map((r) => r.id)).toEqual(["r2", "r1"]);

    // bloodPressureIn range
    const range = await store.bloodPressureIn({ from: "2026-04-11", to: "2026-04-12" });
    expect(range.map((r) => r.id)).toEqual(["r3"]);

    // readBloodPressure by ts [fromTs, toTs) ascending
    const between = await store.readBloodPressure(1775800000, 1775850000);
    expect(between.map((r) => r.id)).toEqual(["r1", "r2"]);

    // clearImported removes records within cleared day range
    await store.clearImported({ from: "2026-04-10", to: "2026-04-10" }, 1775700000, 1776000000);
    const remaining = await store.allBloodPressure();
    expect(remaining.map((r) => r.id)).toEqual(["r3"]);

    // getBloodPressure without day returns all remaining
    const withoutDay = await store.getBloodPressure();
    expect(withoutDay.map((r) => r.id)).toEqual(["r3"]);

    // readBloodPressure outside range
    const empty = await store.readBloodPressure(1775000000, 1775100000);
    expect(empty).toEqual([]);

    // clearAll removes everything
    await store.clearAll();
    expect(await store.allBloodPressure()).toEqual([]);
  });

  it("maps Health Connect records to BloodPressureReadingRow with strict 60-260 / 30-160 bounds", () => {
    const rows = mapBloodPressureRecords(
      [
        {
          metadata: { id: "cuff-ok" },
          time: at("2026-04-10", "08:00:00"),
          systolic: { inMillimetersOfMercury: 121 },
          diastolic: { inMillimetersOfMercury: 79 },
          bodyPosition: BloodPressureBodyPosition.SITTING_DOWN,
        },
        {
          metadata: { id: "cuff-low" },
          time: at("2026-04-10", "08:01:00"),
          systolic: { inMillimetersOfMercury: 55 },
          diastolic: { inMillimetersOfMercury: 35 },
        },
        {
          metadata: { id: "cuff-high" },
          time: at("2026-04-10", "08:02:00"),
          systolic: { inMillimetersOfMercury: 265 },
          diastolic: { inMillimetersOfMercury: 120 },
        },
        {
          metadata: { id: "cuff-inverted" },
          time: at("2026-04-10", "08:03:00"),
          systolic: { inMillimetersOfMercury: 80 },
          diastolic: { inMillimetersOfMercury: 90 },
        },
      ],
      TZ,
    );

    expect(rows).toEqual([
      {
        id: "cuff-ok",
        timestampMs: Date.parse(at("2026-04-10", "08:00:00")),
        date: "2026-04-10",
        systolicMmHg: 121,
        diastolicMmHg: 79,
        pulseBpm: null,
        posture: "sitting",
        source: "health_connect",
      },
    ]);
  });
});
