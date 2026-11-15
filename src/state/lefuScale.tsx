// The scale for the screens: the controller's connection state (src/health/lefuBle.ts), the newest weigh-in and its body
// composition, the save state, and the stored-history backfill. Raw frames land in a ref and React hears about each one;
// a scale sends only a handful per weigh-in, so no throttling is needed.
//
// Saving goes through the app's action path (`logEntry`, kind "weight"), never SQLite directly: a live weighing waits
// for the person's Save tap, while stored history frames are written automatically at the time the scale recorded them.
// Composition is computed here from the profile and the scale-only athlete switch; a missing height leaves the reading
// as weight only rather than inventing a number.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as React from "react";
import { logEntry } from "@/actions/log";
import type { Profile } from "@/data/types";
import {
  DEFAULT_V3_PROFILE,
  hasImpedance,
  isFinalLeFuFrame,
  leFuBodyComposition,
  timestampWall,
  validateLeFuBodyInput,
  type LeFuBodyError,
  type LeFuComposition,
  type LeFuFrame,
  type LeFuProfile,
} from "@/health/lefu";
import { availability, askWritePermissions, writePermissionState } from "@/health/connect";
import { scaleClientRecordId, type ScaleWeighIn } from "@/health/healthRecord";
import { writeScaleWeighIn } from "@/health/healthWrite";
import { attempt } from "@/lib/attempt";
import {
  leFuScale,
  type LeFuReading,
  type LeFuSnapshot,
} from "@/health/lefuBle";
import { i18n } from "@/i18n/config";
import { fromWall, localDay, wall, wholeYears } from "@/lib/time";
import { actionCtx, dataChanged, useApp } from "./app";

export const LE_FU_ATHLETE_KEY = "pulse.lefu.athlete";

export type { FoundScale, LeFuReading, LeFuSnapshot, RememberedScale } from "@/health/lefuBle";

export type ScaleSave = "idle" | "saving" | "saved" | "failed";

/** The last Health Connect write state for the scale's weigh-ins. */
export type HealthSync = "unknown" | "ready" | "saved" | "permission" | "unavailable" | "failed";

/** The last stored-history transfer, or null before one. */
export type ScaleHistory = { received: number; saved: number; skipped: number; failed: number };

export type ScaleData = {
  /** The newest live frame (settling or final), or null. History frames never land here. */
  reading: LeFuReading | null;
  /** False while the scale is still settling. */
  final: boolean;
  /** The vendor composition for a final body frame with usable inputs, or null. */
  composition: LeFuComposition | null;
  /** Why there is no composition (height missing, impedance or weight out of range), or null. */
  bodyError: LeFuBodyError | null;
  saveState: ScaleSave;
  saveError: string | null;
  savedAt: number | null;
  /** The last history transfer's counts. */
  history: ScaleHistory | null;
  athlete: boolean;
  /** Whether the scale's saved weigh-ins reach Health Connect. */
  health: HealthSync;
  /** Weigh-ins waiting for a Health Connect write (permission missing, unavailable, or a failed write). */
  healthPending: number;
};

export type ScaleControl = LeFuSnapshot & {
  /** Looks for LeFu-family scales for 15 s (asks for the permission / Bluetooth first when needed). */
  scan(): Promise<void>;
  stopScan(): void;
  /** Connects to a found scale (or the remembered one), remembers it, and runs profile/clock/history. */
  connect(id: string, profile?: LeFuProfile | null): Promise<void>;
  disconnect(): Promise<void>;
  /** Disconnects and forgets the remembered scale. */
  forget(): Promise<void>;
  /** The Nearby devices dialog, or Android settings once it has been refused for good. */
  requestPermission(): Promise<LeFuSnapshot["permission"]>;
  /** Android's "turn on Bluetooth?" dialog (or its Bluetooth settings). False when neither could open. */
  turnOnBluetooth(): Promise<boolean>;
  openSettings(): Promise<void>;
  /** Saves the current final live reading through `logEntry`. A no-op while the scale is settling. */
  save(): Promise<void>;
  /** Shows Health Connect's write-permission sheet and flushes anything waiting. */
  allowHealthWrite(): Promise<void>;
  /** Retries the Health Connect writes that are waiting. */
  retryHealthWrite(): Promise<void>;
  /** The scale-only athlete flag ("pulse.lefu.athlete"), default off. */
  athlete: boolean;
  setAthlete(on: boolean): Promise<void>;
};

const EMPTY: ScaleData = {
  reading: null,
  final: false,
  composition: null,
  bodyError: null,
  saveState: "idle",
  saveError: null,
  savedAt: null,
  history: null,
  athlete: false,
  health: "unknown",
  healthPending: 0,
};

const ACTIONS = {
  scan: leFuScale.scan,
  stopScan: leFuScale.stopScan,
  disconnect: leFuScale.disconnect,
  forget: leFuScale.forget,
  requestPermission: leFuScale.requestPermission,
  turnOnBluetooth: leFuScale.turnOnBluetooth,
  openSettings: leFuScale.openSettings,
};

/** The profile and the athlete switch as the scale's command and composition model need them. */
function userOf(profile: Profile | null, athlete: boolean) {
  return {
    male: profile?.sex === "male",
    age: profile ? wholeYears(profile.birthDate, localDay(Math.floor(Date.now() / 1000), profile.timeZone)) : null,
    heightCm: profile?.heightCm ?? null,
    athlete,
  };
}

/** A moment as the `YYYY-MM-DDTHH:mm` wall time `logEntry` takes, in the profile's zone. */
function wallMinute(ms: number, tz: string): string {
  const w = wall(Math.floor(ms / 1000), tz);
  return `${w.day}T${w.time.slice(0, 5)}`;
}

/** The composition a frame can support, and why not when it can't. */
function compositionOf(frame: LeFuFrame, profile: Profile | null, athlete: boolean): { composition: LeFuComposition | null; error: LeFuBodyError | null } {
  // Only a final body frame (status 0x00) carries usable bioimpedance; a weight-only frame has none.
  if (frame.status !== 0x00 || !hasImpedance(frame)) return { composition: null, error: null };
  if (!profile || profile.heightCm === null) return { composition: null, error: "height" };
  const input = {
    weightKg: frame.weightKg,
    heightCm: profile.heightCm,
    age: wholeYears(profile.birthDate, localDay(Math.floor(Date.now() / 1000), profile.timeZone)),
    male: profile.sex === "male",
    athlete,
    impedanceOhm: frame.impedanceOhm ?? 0,
  };
  const error = validateLeFuBodyInput(input);
  if (error) return { composition: null, error };
  return { composition: leFuBodyComposition(input), error: null };
}

const ControlCtx = React.createContext<ScaleControl | null>(null);
const DataCtx = React.createContext<ScaleData>(EMPTY);

/** Starts the controller and keeps the scale slice. Mounted once, in AppProviders (src/ui/providers.tsx). */
export function LeFuScaleProvider({ children }: { children: React.ReactNode }) {
  // Off the first frame: reading the remembered scale and creating a BleManager is not needed to paint Home.
  React.useEffect(() => {
    const timer = setTimeout(() => leFuScale.start(), 1500);
    return () => clearTimeout(timer);
  }, []);
  const snap = React.useSyncExternalStore(leFuScale.subscribe, leFuScale.getSnapshot, leFuScale.getSnapshot);
  const profile = useApp((s) => s.profile);
  const [athlete, setAthleteState] = React.useState(false);
  const [reading, setReading] = React.useState<LeFuReading | null>(null);
  const [save, setSave] = React.useState<ScaleSave>("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [history, setHistory] = React.useState<ScaleHistory | null>(null);
  const [health, setHealth] = React.useState<HealthSync>("unknown");
  const [healthPending, setHealthPending] = React.useState(0);

  const readingRef = React.useRef<LeFuReading | null>(null);
  const profileRef = React.useRef<Profile | null>(profile);
  const athleteRef = React.useRef(false);
  const savingRef = React.useRef(false);
  const finalKeyRef = React.useRef<string | null>(null);
  const lastFinalAtRef = React.useRef(0);
  const historyKeys = React.useRef(new Set<string>());
  const historyChain = React.useRef<Promise<void>>(Promise.resolve());
  const historyStats = React.useRef<ScaleHistory>({ received: 0, saved: 0, skipped: 0, failed: 0 });
  const dataTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Weigh-ins waiting for a Health Connect write, keyed by their deterministic client record id. */
  const pendingHealth = React.useRef(new Map<string, ScaleWeighIn>());
  /** Serialises Health Connect writes so a history burst cannot interleave. */
  const healthChain = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  React.useEffect(() => {
    AsyncStorage.getItem(LE_FU_ATHLETE_KEY)
      .then((v) => {
        const on = v === "1";
        athleteRef.current = on;
        setAthleteState(on);
      })
      .catch(() => {});
  }, []);

  // The controller needs the profile fields for FD 37; the effect runs whenever the profile or the switch changes.
  React.useEffect(() => {
    leFuScale.setUser(userOf(profile, athlete));
  }, [profile, athlete]);

  const publishHistory = React.useCallback(() => {
    const h = historyStats.current;
    setHistory(h.received > 0 || h.saved > 0 || h.failed > 0 ? { ...h } : null);
  }, []);

  const scheduleDataChanged = React.useCallback(() => {
    if (dataTimer.current) return;
    dataTimer.current = setTimeout(() => {
      dataTimer.current = null;
      dataChanged("logs");
    }, 800);
  }, []);

  /** Writes everything waiting, stopping at the first permission/unavailable/error so the screen can explain it. */
  const flushHealth = React.useCallback(async (prompt = false) => {
    await attempt(async () => {
      if ((await availability()) !== "available") {
        setHealth("unavailable");
        return;
      }
      let first = true;
      for (const [id, weighIn] of pendingHealth.current) {
        const result = await writeScaleWeighIn(weighIn, { prompt: prompt && first });
        first = false;
        if (!result.ok) {
          setHealth(result.reason === "permission" ? "permission" : result.reason === "unavailable" ? "unavailable" : "failed");
          return;
        }
        pendingHealth.current.delete(id);
        setHealth("saved");
      }
    }, {
      catch: () => setHealth("failed"),
      finally: () => setHealthPending(pendingHealth.current.size),
    });
  }, []);

  /** Queue a saved weigh-in for Health Connect; `prompt` is for an explicit Save tap, never a history burst. */
  const queueHealth = React.useCallback((weighIn: ScaleWeighIn, prompt = false) => {
    pendingHealth.current.set(scaleClientRecordId(weighIn), weighIn);
    setHealthPending(pendingHealth.current.size);
    healthChain.current = healthChain.current.then(() => flushHealth(prompt)).catch(() => {});
  }, [flushHealth]);

  const refreshHealth = React.useCallback(async () => {
    await attempt(async () => {
      if ((await availability()) !== "available") {
        setHealth("unavailable");
        return;
      }
      const permission = await writePermissionState();
      setHealth(permission.missing.length > 0 ? "permission" : "ready");
    }, { catch: () => setHealth("unknown") });
  }, []);

  React.useEffect(() => {
    // Outside the effect body: the read is native and async, and its state belongs to the next tick.
    const timer = setTimeout(() => void refreshHealth(), 0);
    return () => clearTimeout(timer);
  }, [refreshHealth]);

  const allowHealthWrite = React.useCallback(async () => {
    healthChain.current = healthChain.current
      .then(async () => {
        try {
          await askWritePermissions();
        } catch {
          setHealth("failed");
          return;
        }
        await flushHealth(false);
      })
      .catch(() => {});
    await healthChain.current;
  }, [flushHealth]);

  const retryHealthWrite = React.useCallback(async () => {
    healthChain.current = healthChain.current.then(() => flushHealth(false)).catch(() => {});
    await healthChain.current;
  }, [flushHealth]);

  /** One stored frame, at the scale's own timestamp, unless Pulse already has that weigh-in. */
  const backfill = React.useCallback(async (r: LeFuReading) => {
    const frame = r.frame;
    const p = profileRef.current;
    const t = frame.timestamp;
    if (!p || !t) {
      historyStats.current.skipped++;
      publishHistory();
      return;
    }
    const at = timestampWall(t);
    const c = actionCtx();
    const ts = fromWall(at, c.timeZone);
    const now = Math.floor(Date.now() / 1000);
    // logEntry accepts the last 366 days; a scale's clock can be far off, and a bad stamp is worth skipping.
    if (ts > now + 60 || ts < now - 366 * 86_400) {
      historyStats.current.skipped++;
      publishHistory();
      return;
    }
    const { composition } = compositionOf(frame, p, athleteRef.current);
    const kg = frame.weightKg;
    const fatPct = composition?.bodyFatPercent ?? null;
    const key = `${at}|${Math.round(kg * 10)}|${fatPct === null ? "w" : Math.round(fatPct * 10)}`;
    if (historyKeys.current.has(key)) {
      historyStats.current.skipped++;
      publishHistory();
      return;
    }
    // The same weigh-in may already be in Pulse: the scale is cleared after a read, but a failed clear can replay it.
    const rounded = Math.round(kg * 10) / 10;
    const rows = await c.store.loggedEntries(ts - 90, 30).catch(() => []);
    const duplicate = rows.some((row) => {
      if (row.type !== "weight" || row.source !== "pulse" || Math.abs(row.ts - ts) > 90) return false;
      const stored = (row.data as { kg?: unknown } | null)?.kg;
      return typeof stored === "number" && Math.abs(stored - rounded) < 0.05;
    });
    if (duplicate) {
      historyKeys.current.add(key);
      historyStats.current.skipped++;
      publishHistory();
      return;
    }
    const result = await logEntry(c, { kind: "weight", kg, fatPct, at });
    if (result.ok) {
      historyKeys.current.add(key);
      historyStats.current.saved++;
      scheduleDataChanged();
      queueHealth({ atMs: ts * 1000, kg, fatPct }, false);
    } else {
      historyStats.current.failed++;
      console.warn("[scale] history entry not saved:", result.error);
    }
    publishHistory();
  }, [publishHistory, queueHealth, scheduleDataChanged]);

  React.useEffect(() => {
    const offReading = leFuScale.onReading((r) => {
      if (r.frame.isHistory) {
        historyStats.current.received++;
        publishHistory();
        historyChain.current = historyChain.current
          .then(() => backfill(r))
          .catch(() => {
            historyStats.current.failed++;
            publishHistory();
          });
        return;
      }
      readingRef.current = r;
      setReading(r);
      if (!isFinalLeFuFrame(r.frame, r.profile ?? DEFAULT_V3_PROFILE)) return;
      const key = `${r.frame.weightRaw}|${r.frame.impedanceOhm ?? 0}|${r.frame.status}|${r.frame.timestamp ? timestampWall(r.frame.timestamp) : ""}`;
      // The scale repeats a settled frame; the same reading inside 10 s is that repeat, not a new weigh-in. The same
      // numbers later are a new weigh-in and get a fresh save state.
      const repeat = key === finalKeyRef.current && r.at - lastFinalAtRef.current < 10_000;
      if (!repeat) {
        finalKeyRef.current = key;
        setSave("idle");
        setSaveError(null);
        setSavedAt(null);
      }
      lastFinalAtRef.current = r.at;
    });
    const offHistory = leFuScale.onHistoryEnd((count) => {
      if (count > 0) {
        historyStats.current.received = Math.max(historyStats.current.received, count);
        publishHistory();
      }
      if (historyStats.current.saved > 0) scheduleDataChanged();
    });
    return () => {
      offReading();
      offHistory();
      if (dataTimer.current) clearTimeout(dataTimer.current);
      dataTimer.current = null;
    };
  }, [backfill, publishHistory, scheduleDataChanged]);

  // A new connection starts a new weigh-in; the previous reading and save state belong to the old one.
  const statusRef = React.useRef(snap.status);
  React.useEffect(() => {
    if (snap.status === "connecting" && statusRef.current !== "connecting") {
      readingRef.current = null;
      setReading(null);
      setSave("idle");
      setSaveError(null);
      setSavedAt(null);
      finalKeyRef.current = null;
      lastFinalAtRef.current = 0;
      historyStats.current = { received: 0, saved: 0, skipped: 0, failed: 0 };
      historyKeys.current.clear();
      setHistory(null);
    }
    statusRef.current = snap.status;
  }, [snap.status]);

  const setAthlete = React.useCallback(async (on: boolean) => {
    athleteRef.current = on;
    setAthleteState(on);
    await AsyncStorage.setItem(LE_FU_ATHLETE_KEY, on ? "1" : "0").catch(() => {});
  }, []);

  const saveReading = React.useCallback(async () => {
    const r = readingRef.current;
    const p = profileRef.current;
    if (!r || !p || savingRef.current) return;
    const final = isFinalLeFuFrame(r.frame, r.profile ?? DEFAULT_V3_PROFILE);
    if (!final) return;
    savingRef.current = true;
    setSave("saving");
    setSaveError(null);
    await attempt(async () => {
      const { composition } = compositionOf(r.frame, p, athleteRef.current);
      const fatPct = composition?.bodyFatPercent ?? null;
      const c = actionCtx();
      // Save at the weigh-in's arrival, not at the tap: the person may study the numbers before saving.
      const at = wallMinute(r.at, c.timeZone);
      const result = await logEntry(c, { kind: "weight", kg: r.frame.weightKg, fatPct, at });
      if (result.ok) {
        dataChanged("logs");
        setSave("saved");
        setSavedAt(Date.now());
        queueHealth({ atMs: fromWall(at, c.timeZone) * 1000, kg: r.frame.weightKg, fatPct }, true);
      } else {
        setSave("failed");
        setSaveError(result.error);
      }
    }, {
      catch: (e) => {
        setSave("failed");
        setSaveError(e instanceof Error ? e.message : i18n.t("scale:error.saveFailed"));
      },
      finally: () => {
        savingRef.current = false;
      },
    });
  }, [queueHealth]);

  const control = React.useMemo<ScaleControl>(() => {
    const connect = async (id: string, profileOverride?: LeFuProfile | null) => {
      historyStats.current = { received: 0, saved: 0, skipped: 0, failed: 0 };
      historyKeys.current.clear();
      setHistory(null);
      await leFuScale.connect(id, profileOverride);
    };
    return { ...snap, ...ACTIONS, connect, save: saveReading, allowHealthWrite, retryHealthWrite, athlete, setAthlete };
  }, [snap, athlete, setAthlete, saveReading, allowHealthWrite, retryHealthWrite]);

  const data = React.useMemo<ScaleData>(() => {
    const final = reading ? isFinalLeFuFrame(reading.frame, reading.profile ?? DEFAULT_V3_PROFILE) : false;
    const derived = reading ? compositionOf(reading.frame, profile, athlete) : { composition: null, error: null };
    return {
      reading,
      final,
      composition: derived.composition,
      bodyError: derived.error,
      saveState: save,
      saveError,
      savedAt,
      history,
      athlete,
      health,
      healthPending,
    };
  }, [reading, profile, athlete, save, saveError, savedAt, history, health, healthPending]);

  return (
    <ControlCtx.Provider value={control}>
      <DataCtx.Provider value={data}>{children}</DataCtx.Provider>
    </ControlCtx.Provider>
  );
}

/** The controller's state and actions, without the per-weigh-in data. */
export function useLeFuScaleControl(): ScaleControl {
  const value = React.useContext(ControlCtx);
  if (!value) throw new Error("useLeFuScaleControl outside LeFuScaleProvider");
  return value;
}

/** Everything: status, device, reading, composition and the save state. */
export function useLeFuScale(): ScaleControl & ScaleData {
  const control = useLeFuScaleControl();
  const data = React.useContext(DataCtx);
  return React.useMemo(() => ({ ...control, ...data }), [control, data]);
}
