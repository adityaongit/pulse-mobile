// Live heart rate for the screens: the Bluetooth controller's state (src/health/ble.ts) and its samples, turned into
// what the screens draw — the bpm, the last 60 s of RR intervals and their RMSSD, the 2-minute trace. Raw samples
// land in refs (a band notifies about once a second); React hears about them at most 4 times a second.
//
// Display-only: nothing here writes to SQLite. Health Connect stays the scoring source (no double counting).
import * as React from "react";
import { liveBle, type BlePermission, type BleSnapshot, type LiveSample } from "@/health/ble";
import { rmssd as rmssdOf, RR_WINDOW_MS, since, stampRr, TRACE_MS, type RrBeat } from "@/health/bleHr";

export type { BleDevice, BlePermission, BleRadio, BleSnapshot, FoundDevice, LiveStatus } from "@/health/ble";

/** React hears about new samples at most this often (≤ 4 renders a second). */
const FLUSH_MS = 250;

export type LiveData = {
  /** The newest bpm the band sent; null before the first or once the link ends. */
  bpm: number | null;
  /** RR intervals (ms) of the last 60 s, oldest first. */
  rrMs: number[];
  /** RMSSD (ms) over `rrMs` after artifact rejection; null without RR or with too few clean beats. */
  rmssd: number | null;
  /** Epoch ms of the newest bpm. */
  lastBeatAt: number | null;
  /** The last 2 minutes of bpm, ascending. */
  history: { t: number; bpm: number }[];
  /** Skin contact as the band reports it; null when it does not. */
  contact: boolean | null;
};

export type LiveControl = BleSnapshot & {
  /** Looks for bands sharing heart rate (asks for the permission / Bluetooth first when needed). */
  scan(): Promise<void>;
  stopScan(): void;
  /** Connects to a found band (or the remembered one) and remembers it. */
  connect(id: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Disconnects and forgets the remembered band. */
  forget(): Promise<void>;
  setAutoConnect(on: boolean): Promise<void>;
  /** The Nearby devices dialog, or Android settings once it has been refused for good. */
  requestPermission(): Promise<BlePermission>;
  /** Android's "turn on Bluetooth?" dialog (or its Bluetooth settings). False when neither could open. */
  turnOnBluetooth(): Promise<boolean>;
  openSettings(): Promise<void>;
};

const EMPTY: LiveData = { bpm: null, rrMs: [], rmssd: null, lastBeatAt: null, history: [], contact: null };

const ACTIONS = {
  scan: liveBle.scan,
  stopScan: liveBle.stopScan,
  connect: liveBle.connect,
  disconnect: liveBle.disconnect,
  forget: liveBle.forget,
  setAutoConnect: liveBle.setAutoConnect,
  requestPermission: liveBle.requestPermission,
  turnOnBluetooth: liveBle.turnOnBluetooth,
  openSettings: liveBle.openSettings,
};

/** The raw samples behind LiveData, kept in a ref between flushes. */
const emptyRaw = () => ({ history: [] as { t: number; bpm: number }[], beats: [] as RrBeat[], bpm: null as number | null, lastBeatAt: null as number | null, contact: null as boolean | null });

const ControlCtx = React.createContext<LiveControl | null>(null);
const DataCtx = React.createContext<LiveData>(EMPTY);

/** Starts the controller and keeps the live slice. Mounted once, in AppProviders (src/ui/providers.tsx). */
export function LiveBleProvider({ children }: { children: React.ReactNode }) {
  // Off the first frame: the controller reads storage, asks for the Bluetooth permission and creates a BleManager.
  // A screen that opens sooner starts it from its own scan/connect (src/health/ble.ts prepare).
  React.useEffect(() => {
    const timer = setTimeout(() => liveBle.start(), 1500);
    return () => clearTimeout(timer);
  }, []);
  const snap = React.useSyncExternalStore(liveBle.subscribe, liveBle.getSnapshot, liveBle.getSnapshot);
  const [data, setData] = React.useState<LiveData>(EMPTY);
  const raw = React.useRef(emptyRaw());

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let flushedAt = 0;
    const flush = () => {
      timer = null;
      flushedAt = Date.now();
      const r = raw.current;
      r.history = since(r.history, flushedAt - TRACE_MS);
      r.beats = since(r.beats, flushedAt - RR_WINDOW_MS);
      const rrMs = r.beats.map((b) => b.rr);
      setData({ bpm: r.bpm, rrMs, rmssd: rmssdOf(rrMs), lastBeatAt: r.lastBeatAt, history: r.history.slice(), contact: r.contact });
    };
    // A link that ended (idle, off, scanning for another band) leaves nothing to show; "lost" keeps the last trace on
    // screen while it reconnects, "connecting" keeps it for a band coming straight back.
    const offStatus = liveBle.subscribe(() => {
      const st = liveBle.getSnapshot().status;
      if (st === "live" || st === "lost" || st === "connecting") return;
      const r = raw.current;
      if (r.bpm === null && !r.history.length && !r.beats.length) return;
      raw.current = emptyRaw();
      if (timer) clearTimeout(timer);
      timer = null;
      setData(EMPTY);
    });
    const off = liveBle.onSample((s: LiveSample) => {
      const r = raw.current;
      if (s.bpm > 0) {
        r.history.push({ t: s.t, bpm: s.bpm });
        r.bpm = s.bpm;
        r.lastBeatAt = s.t;
      }
      if (s.rrMs.length) r.beats.push(...stampRr(s.rrMs, s.t));
      r.contact = s.contact;
      timer = timer ?? setTimeout(flush, Math.max(0, FLUSH_MS - (Date.now() - flushedAt)));
    });
    return () => {
      off();
      offStatus();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const control = React.useMemo<LiveControl>(() => ({ ...snap, ...ACTIONS }), [snap]);
  return (
    <ControlCtx.Provider value={control}>
      <DataCtx.Provider value={data}>{children}</DataCtx.Provider>
    </ControlCtx.Provider>
  );
}

/** The controller's state and actions, without the per-beat data: re-renders only when the status or scan changes. */
export function useLiveBleControl(): LiveControl {
  const v = React.useContext(ControlCtx);
  if (!v) throw new Error("useLiveBleControl outside LiveBleProvider");
  return v;
}

/** Everything: status, device, bpm, rrMs (60 s), rmssd, lastBeatAt, history (2 min) and the actions. ≤ 4 renders/s while live. */
export function useLiveBle(): LiveControl & LiveData {
  const control = useLiveBleControl();
  const data = React.useContext(DataCtx);
  return React.useMemo(() => ({ ...control, ...data }), [control, data]);
}

/** Live readings to show: the link is live, or reconnecting with a recent trace still on screen. */
export const showsLive = (l: Pick<LiveControl, "status"> & Pick<LiveData, "bpm">) => l.status === "live" || (l.status === "lost" && l.bpm !== null);
