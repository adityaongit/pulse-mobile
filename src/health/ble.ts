import { i18n } from "@/i18n/config";
// Live heart rate over Bluetooth: one controller for the app around react-native-ble-plx's BleManager. It owns the
// Android permissions (Nearby devices), the radio state, the scan for bands advertising the standard Heart Rate
// Service (0x180D), the connection and the 0x2A37 subscription, and emits each notification as a sample. The React
// side (src/state/liveBle.tsx) turns samples into what the screens draw; the parsing is src/health/bleHr.ts.
//
// The band (a Fitbit Air with Google Health › Fitbit Air › Connections › Share heart rate on) serves one connection
// at a time and sharing costs its battery, so Pulse only holds it while it is on screen: 30 s after Pulse leaves the
// foreground the link is let go, and it is picked up again on return. The chosen band is remembered
// ("pulse.ble.device"); with auto-connect on (off by default, for the band's battery) Pulse reconnects to it whenever it
// comes to the foreground. A dropped link retries with exponential backoff, then gives up and says why.
//
// Nothing here throws to the UI: no Bluetooth (the emulator), a refused permission or a radio that is off become a
// status. Samples are display-only and never written to SQLite (Health Connect stays the scoring source).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Linking, PermissionsAndroid, Platform, type AppStateStatus, type Permission } from "react-native";
import { BleErrorCode, BleManager, ScanMode, State, type BleError, type Device, type Subscription } from "react-native-ble-plx";
import { bondedDevices } from "../../modules/pulse-bt";
import { backoffMs, HR_MEASUREMENT_UUID, HR_SERVICE_UUID, looksLikeFitbit, parseHrMeasurementBase64, rankDevices, sameUuid } from "./bleHr";

export const DEVICE_KEY = "pulse.ble.device";
export const AUTO_CONNECT_KEY = "pulse.ble.autoConnect";
/** "1" once the person stopped live heart rate: no automatic connect, across restarts, until they go live again. */
export const STOPPED_KEY = "pulse.ble.stopped";

/** A scan the person starts runs this long. */
const SCAN_MS = 15_000;
/** Reconnecting looks for the remembered band this long before trying a direct connection anyway. */
const FIND_MS = 8_000;
const CONNECT_TIMEOUT_MS = 12_000;
/** Connected but silent this long after subscribing: the band is not sharing; the attempt fails. */
const FIRST_BEAT_MS = 20_000;
/** Live but silent this long: the stream stalled; the link is dropped and rebuilt. */
const STALL_MS = 15_000;
/** In the background this long, the band is let go for other equipment. */
export const BACKGROUND_GRACE_MS = 30_000;
/** Attempts per connect: one the person asked for or a dropped link; an automatic connect on opening tries less. */
const MAX_ATTEMPTS = 6;
const MAX_AUTO_ATTEMPTS = 2;
/** Scan results reach the UI at most this often (a scan reports each band about once a second). */
const FOUND_EMIT_MS = 400;
/** A scan asked for before Bluetooth was on still runs if Bluetooth comes on within this. */
const PENDING_SCAN_MS = 2 * 60_000;
/** A band seen advertising this recently is connected to directly, without looking for it first. */
const SEEN_FRESH_MS = 30_000;

export type LiveStatus = "off" | "unauthorized" | "idle" | "scanning" | "connecting" | "live" | "lost";
/** The radio: `unsupported` = no Bluetooth LE (the emulator); `unavailable` = no native module (Expo Go, iOS, web). */
export type BleRadio = "on" | "off" | "turning" | "unsupported" | "unavailable" | "unknown";
/** `needed` = not granted yet (asking shows the dialog); `blocked` = "Don't allow" twice: only Android settings can grant it. */
export type BlePermission = "granted" | "needed" | "blocked" | "unknown";
export type BleDevice = { id: string; name: string | null };
/** `paired`: a band paired with this phone (Google Health's), listed without being seen: a tap connects to it directly. */
export type FoundDevice = BleDevice & { rssi: number | null; likely: boolean; paired?: boolean };

export type BleSnapshot = {
  status: LiveStatus;
  radio: BleRadio;
  permission: BlePermission;
  /** The band the link is about while connecting, live or reconnecting; otherwise null. */
  device: BleDevice | null;
  /** The band chosen last ("pulse.ble.device"). */
  remembered: BleDevice | null;
  autoConnect: boolean;
  /** Bands seen by the current or last scan, likely Fitbits first, then by signal. */
  found: FoundDevice[];
  /** What went wrong last, worded for the person; cleared by the next success or action. */
  error: string | null;
  /** While reconnecting: when the next attempt starts (epoch ms). */
  retryAt: number | null;
  /** False until the saved settings and the permission have been read. */
  loaded: boolean;
};

/** One Heart Rate Measurement notification. */
export type LiveSample = { /** Arrival, epoch ms. */ t: number; bpm: number; rrMs: number[]; contact: boolean | null };

type Link = "idle" | "scanning" | "connecting" | "live" | "lost";

/** One line per step to logcat (tag ReactNativeJS), so a link that won't come up can be traced on the phone. */
const log = (...parts: unknown[]) => console.log("[PulseBLE]", ...parts);
type ScanEnd = "timeout" | "error" | "cancel";

// Errors are tagged rather than subclassed: `instanceof` on an Error subclass is unreliable under Babel's class
// transform. "live" = a sentence for the person; "superseded" = an attempt overtaken by a disconnect, the background
// or another connect, never shown.
type Tagged = Error & { pulse?: "live" | "superseded" };
const liveError = (message: string): Tagged => Object.assign(new Error(message), { pulse: "live" as const });
const superseded = (): Tagged => Object.assign(new Error("superseded"), { pulse: "superseded" as const });
const tagged = (e: unknown, tag: "live" | "superseded") => !!e && typeof e === "object" && (e as Tagged).pulse === tag;

const isForeground = (s: AppStateStatus | null | undefined) => s !== "background" && s !== "inactive";

const apiLevel = () => (typeof Platform.Version === "number" ? Platform.Version : parseInt(String(Platform.Version), 10) || 0);

const isBleError = (e: unknown): e is BleError => !!e && typeof e === "object" && "errorCode" in e;

/** A BleError or our own error as one sentence. */
function describe(e: unknown, device: string): string {
  if (tagged(e, "live")) return (e as Error).message;
  if (isBleError(e)) {
    // ATT / GATT status 5 and 15: insufficient authentication / encryption, the band wants to be paired first.
    const auth = [5, 15].includes(e.attErrorCode ?? -1) || [5, 15, 137].includes(e.androidErrorCode ?? -1);
    if (auth) return i18n.t("errors:ble.askedToPair", { device });
    switch (e.errorCode) {
      case BleErrorCode.OperationTimedOut:
      case BleErrorCode.DeviceConnectionFailed:
      case BleErrorCode.DeviceNotFound:
        return i18n.t("errors:ble.cantReach", { device });
      case BleErrorCode.DeviceDisconnected:
        return i18n.t("errors:ble.disconnected", { device });
      case BleErrorCode.CharacteristicNotifyChangeFailed:
      case BleErrorCode.DescriptorWriteFailed:
        return i18n.t("errors:ble.refusedStream", { device });
      case BleErrorCode.ServiceNotFound:
      case BleErrorCode.CharacteristicNotFound:
        return i18n.t("errors:ble.notSharing", { device });
      case BleErrorCode.BluetoothUnauthorized:
        return i18n.t("errors:ble.needsNearby");
      case BleErrorCode.BluetoothPoweredOff:
        return i18n.t("errors:ble.btOff");
      case BleErrorCode.ScanStartFailed:
        return i18n.t("errors:ble.scanPaused");
      case BleErrorCode.LocationServicesDisabled:
        return i18n.t("errors:ble.needsLocation");
      default:
        return e.reason || e.message || i18n.t("errors:ble.btError");
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** `p`, or a rejection after `ms`. The original promise's own rejection is swallowed so it never goes unhandled. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  p.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

class LiveHeartRate {
  private manager: BleManager | null = null;
  private started = false;
  private loaded = false;
  private radio: BleRadio = "unknown";
  private permission: BlePermission = "unknown";
  private link: Link = "idle";
  private device: BleDevice | null = null;
  private remembered: BleDevice | null = null;
  private autoConnect = true;
  private found = new Map<string, FoundDevice>();
  private error: string | null = null;
  private retryAt: number | null = null;
  /** Whether Pulse was in the foreground at the last AppState change (edge detection only; see foreground()). */
  private wasForeground = true;

  private snapshot: BleSnapshot;
  private listeners = new Set<() => void>();
  private sampleListeners = new Set<(s: LiveSample) => void>();
  private foundTimer: ReturnType<typeof setTimeout> | null = null;

  // The link. `want` is the band the controller is trying to stay connected to; `gen` bumps whenever a link is torn
  // down, so callbacks and awaits from an older one see they were overtaken.
  private want: BleDevice | null = null;
  private maxAttempts = MAX_ATTEMPTS;
  private attempts = 0;
  private gen = 0;
  private inFlight: number | null = null;
  private subs: Subscription[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private beatTimer: ReturnType<typeof setTimeout> | null = null;
  private bgTimer: ReturnType<typeof setTimeout> | null = null;
  private wasLive = false;
  /** The person disconnected: no automatic connect until they connect again or Pulse restarts. */
  private userStopped = false;
  /** The background grace let go of this band; coming back picks it up again. */
  private resume: BleDevice | null = null;
  /**
   * When a scan was asked for while the radio was off or the permission missing: it runs once both are fine, if that
   * happens within PENDING_SCAN_MS (the dialogs that grant them briefly put Pulse in the background).
   */
  private pendingScanAt: number | null = null;
  /** Bumped per scan the person starts, so an overtaken scan's end does not reset the state. */
  private userScan = 0;
  /** When each band was last seen advertising (epoch ms). */
  private seenAt = new Map<string, number>();

  // The scan in progress (the person's, or one looking for the band to reconnect).
  private scanToken = 0;
  private scanEnd: ((why: ScanEnd, err?: unknown) => void) | null = null;

  constructor() {
    this.snapshot = this.build();
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  getSnapshot = (): BleSnapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Every notification while live. Called synchronously from the BLE event: keep it cheap. */
  onSample = (fn: (s: LiveSample) => void): (() => void) => {
    this.sampleListeners.add(fn);
    return () => this.sampleListeners.delete(fn);
  };

  private build(): BleSnapshot {
    return {
      status: this.status(),
      radio: this.radio,
      permission: this.permission,
      device: this.link === "connecting" || this.link === "live" || this.link === "lost" ? this.device : null,
      remembered: this.remembered,
      autoConnect: this.autoConnect,
      found: rankDevices([...this.found.values()]),
      error: this.error,
      retryAt: this.retryAt,
      loaded: this.loaded,
    };
  }

  private status(): LiveStatus {
    if (this.radio === "unsupported" || this.radio === "unavailable") return "off";
    if (this.loaded && this.permission !== "granted") return "unauthorized";
    if (this.radio === "off" || this.radio === "turning") return "off";
    return this.link;
  }

  private emit() {
    if (this.foundTimer) {
      clearTimeout(this.foundTimer);
      this.foundTimer = null;
    }
    this.snapshot = this.build();
    this.listeners.forEach((fn) => fn());
  }

  /** emit(), at most every FOUND_EMIT_MS (scan results). */
  private emitSoon() {
    if (this.foundTimer) return;
    this.foundTimer = setTimeout(() => {
      this.foundTimer = null;
      this.emit();
    }, FOUND_EMIT_MS);
  }

  /**
   * React Native keeps AppState.currentState current from launch on (before this controller starts listening).
   * Unknown counts as the foreground; only a known background state holds the link back.
   */
  private foreground = () => isForeground(AppState.currentState);
  private ready = () => !!this.manager && this.radio === "on" && this.permission === "granted";

  // ── Start ─────────────────────────────────────────────────────────────────

  /** Reads the saved band and settings, the permission and the radio; then connects if it should. Idempotent. */
  start() {
    if (this.started) return;
    this.started = true;
    this.wasForeground = this.foreground();
    AppState.addEventListener("change", (s) => this.onAppState(s));
    void this.boot();
  }

  private async boot() {
    try {
      const [dev, auto, stopped] = await Promise.all([
        AsyncStorage.getItem(DEVICE_KEY).catch(() => null),
        AsyncStorage.getItem(AUTO_CONNECT_KEY).catch(() => null),
        AsyncStorage.getItem(STOPPED_KEY).catch(() => null),
      ]);
      if (dev) {
        try {
          const d = JSON.parse(dev) as Partial<BleDevice>;
          if (typeof d.id === "string") this.remembered = { id: d.id, name: typeof d.name === "string" ? d.name : null };
        } catch {
          // A corrupt entry is as good as none.
        }
      }
      // Off unless the person switched it on (Settings › Live heart rate › Connect automatically): sharing costs the
      // band's battery, so opening Pulse never connects to it on its own.
      this.autoConnect = auto === "1";
      // Stopped last time: stay off when the app opens again (no search, no "Connecting…") until Go live.
      this.userStopped = stopped === "1";
      this.permission = await this.checkPermission();
      this.manager = this.createManager();
      if (this.manager) {
        this.manager.onStateChange((s) => this.onRadio(s), false);
        await this.readRadio();
      }
    } catch (e) {
      this.error = describe(e, i18n.t("errors:ble.theBand"));
    } finally {
      this.loaded = true;
      this.emit();
      this.maybeConnect();
    }
  }

  private createManager(): BleManager | null {
    if (Platform.OS !== "android") {
      this.radio = "unavailable";
      return null;
    }
    try {
      return new BleManager();
    } catch (e) {
      // No native module in this build (Expo Go): live heart rate is simply not offered.
      console.warn("[ble] no BLE module:", e instanceof Error ? e.message : String(e));
      this.radio = "unavailable";
      return null;
    }
  }

  private async readRadio() {
    if (!this.manager) return;
    try {
      this.setRadio(await this.manager.state());
    } catch {
      this.radio = "unknown";
    }
  }

  private setRadio(s: State) {
    this.radio =
      s === State.PoweredOn ? "on" : s === State.PoweredOff ? "off" : s === State.Resetting ? "turning" : s === State.Unsupported ? "unsupported" : "unknown";
  }

  private onRadio(s: State) {
    const was = this.radio;
    this.setRadio(s);
    if (this.radio === was) return;
    if (this.radio !== "on") {
      // The radio went away: the link is gone with it. Keep what was wanted; it resumes when the radio is back.
      if (this.link === "scanning") this.endScan("cancel");
      if (this.link === "live" || this.link === "connecting" || this.link === "lost") {
        const keep = this.want;
        void this.teardown(this.device?.id).then(() => {
          this.want = keep;
          this.link = keep ? (this.wasLive ? "lost" : "connecting") : "idle";
          this.emit();
        });
      }
    }
    this.emit();
    if (this.radio === "on") this.maybeConnect();
  }

  // ── Permissions and the radio ─────────────────────────────────────────────

  private permissions(): Permission[] {
    return apiLevel() >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  }

  private async checkPermission(): Promise<BlePermission> {
    if (Platform.OS !== "android") return "unknown";
    try {
      const ok = await Promise.all(this.permissions().map((p) => PermissionsAndroid.check(p)));
      if (ok.every(Boolean)) return "granted";
      return this.permission === "blocked" ? "blocked" : "needed";
    } catch {
      return "unknown";
    }
  }

  /**
   * Shows Android's Nearby devices dialog. After "Don't allow" twice Android stops showing it ("never ask again"):
   * then this opens Pulse's page in Android settings instead. Connects afterwards if something was waiting for it.
   */
  requestPermission = async (): Promise<BlePermission> => {
    const p = await this.askPermission();
    this.maybeConnect();
    return p;
  };

  private async askPermission(): Promise<BlePermission> {
    if (Platform.OS !== "android") return this.permission;
    if (this.permission === "blocked") {
      // Re-check first: the person may have allowed it in Android settings since.
      this.permission = await this.checkPermission();
      if (this.permission !== "granted") {
        await this.openSettings();
        this.emit();
        return this.permission;
      }
    }
    try {
      const perms = this.permissions();
      const r = await PermissionsAndroid.requestMultiple(perms);
      const v = perms.map((p) => r[p]);
      this.permission = v.every((x) => x === PermissionsAndroid.RESULTS.GRANTED)
        ? "granted"
        : v.some((x) => x === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)
          ? "blocked"
          : "needed";
    } catch (e) {
      this.error = describe(e, i18n.t("errors:ble.theBand"));
    }
    if (this.permission === "granted") {
      this.error = null;
      await this.readRadio();
    }
    this.emit();
    return this.permission;
  }

  openSettings = async () => {
    await Linking.openSettings().catch(() => {});
  };

  /**
   * Asks Android to turn Bluetooth on: the system "Allow Pulse to turn on Bluetooth?" dialog, else (older Android)
   * the adapter directly, else the Bluetooth settings page. False when none of those could be shown.
   */
  turnOnBluetooth = async (): Promise<boolean> => {
    if (Platform.OS !== "android" || this.radio === "unsupported" || this.radio === "unavailable") return false;
    if (this.permission !== "granted" && (await this.askPermission()) !== "granted") return false;
    try {
      await Linking.sendIntent("android.bluetooth.adapter.action.REQUEST_ENABLE");
      return true;
    } catch {
      // No activity resolves the request on this phone (or package visibility hides it).
    }
    if (apiLevel() < 31 && this.manager) {
      try {
        await withTimeout(this.manager.enable(), 8_000);
        return true;
      } catch {
        // Fall through to the settings page.
      }
    }
    try {
      await Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS");
      return true;
    } catch {
      return false;
    }
  };

  /** Permission, then the radio: true when a scan or connection can start now. Prompts for whichever is missing. */
  private async prepare(): Promise<boolean> {
    if (!this.manager) {
      this.emit();
      return false;
    }
    if (this.permission !== "granted" && (await this.askPermission()) !== "granted") return false;
    if (this.radio !== "on") await this.readRadio();
    if (this.radio === "off") {
      this.emit();
      await this.turnOnBluetooth();
      return false;
    }
    return this.radio === "on";
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  /** Looks for bands sharing heart rate for 15 s; `found` fills as they appear. Turning Bluetooth on resumes it. */
  scan = async (): Promise<void> => {
    this.pendingScanAt = Date.now();
    if (!(await this.prepare())) return;
    this.pendingScanAt = null;
    if (this.link === "live" || this.link === "connecting" || this.link === "scanning") return;
    // Scanning again while reconnecting means the person is picking a band: stop chasing the old one.
    if (this.link === "lost") await this.dropWant();
    this.found.clear();
    this.error = null;
    // A Fitbit Air paired with this phone keeps its link to Google Health and may not advertise at all, so a scan alone
    // can miss it: list it up front, as just seen, so a tap connects to it directly.
    const paired = bondedDevices().filter((b) => /fitbit/i.test(b.name ?? ""));
    for (const b of paired) {
      this.found.set(b.id, { id: b.id, name: b.name, rssi: null, likely: true, paired: true });
      this.seenAt.set(b.id, Date.now());
    }
    log("scan start", { paired: paired.map((b) => b.name) });
    this.link = "scanning";
    this.emit();
    const mine = ++this.userScan;
    this.beginScan(
      SCAN_MS,
      (d) => this.noteFound(d),
      (why, err) => {
        if (mine !== this.userScan) return;
        if (this.link === "scanning") this.link = "idle";
        log("scan end", why, { found: [...this.found.values()].map((d) => `${d.name ?? "?"}${d.paired ? " (paired)" : ""}`) }, err ? String(err) : "");
        if (why === "error") this.error = describe(err, i18n.t("errors:ble.theBand"));
        else if (why === "timeout" && this.found.size === 0)
          this.error = i18n.t("errors:ble.noBandFound");
        this.emit();
      },
    );
  };

  stopScan = () => {
    this.pendingScanAt = null;
    if (this.link === "scanning") this.endScan("cancel");
  };

  private noteFound(d: Device) {
    const prev = this.found.get(d.id);
    const name = d.name ?? d.localName ?? prev?.name ?? null;
    if (!prev) log("seen", name, d.rssi);
    this.found.set(d.id, { id: d.id, name, rssi: d.rssi ?? prev?.rssi ?? null, likely: looksLikeFitbit(name), paired: prev?.paired });
    this.seenAt.set(d.id, Date.now());
    this.emitSoon();
  }

  /** Starts a scan for the Heart Rate Service; any scan already running ends ("cancel") first. */
  private beginScan(ms: number, onDevice: (d: Device) => void, onEnd: (why: ScanEnd, err?: unknown) => void) {
    this.endScan("cancel");
    const m = this.manager;
    if (!m) return onEnd("error", liveError(i18n.t("errors:ble.btUnavailable")));
    const token = ++this.scanToken;
    const timer = setTimeout(() => this.endScan("timeout"), ms);
    this.scanEnd = (why, err) => {
      clearTimeout(timer);
      this.scanEnd = null;
      m.stopDeviceScan().catch(() => {});
      onEnd(why, err);
    };
    m.startDeviceScan([HR_SERVICE_UUID], { scanMode: ScanMode.LowLatency }, (err, d) => {
      if (token !== this.scanToken || !this.scanEnd) return;
      if (err) return this.endScan("error", err);
      if (d) onDevice(d);
    }).catch((e: unknown) => {
      if (token === this.scanToken) this.endScan("error", e);
    });
  }

  private endScan(why: ScanEnd, err?: unknown) {
    this.scanEnd?.(why, err);
  }

  /** Scans until `id` shows up (true) or `ms` pass (false). Results also land in `found`. */
  private find(id: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      let seen = false;
      this.beginScan(
        ms,
        (d) => {
          this.noteFound(d);
          if (d.id === id && !seen) {
            seen = true;
            this.endScan("cancel");
          }
        },
        () => resolve(seen),
      );
    });
  }

  // ── Connecting ────────────────────────────────────────────────────────────

  /** Connects to a band from the scan (or the remembered one) and remembers it. */
  connect = async (id: string): Promise<void> => {
    const seen = this.found.get(id);
    const dev: BleDevice = { id, name: seen?.name ?? (this.remembered?.id === id ? this.remembered.name : null) };
    this.setStopped(false);
    this.pendingScanAt = null;
    this.resume = null;
    if (!(await this.prepare())) return;
    if ((this.link === "live" || this.link === "connecting") && this.device?.id === id) return;
    if (this.link === "scanning") this.endScan("cancel");
    await this.teardown(this.device?.id);
    await this.rememberDevice(dev);
    this.want = dev;
    this.maxAttempts = MAX_ATTEMPTS;
    this.attempts = 0;
    this.wasLive = false;
    void this.attempt(Date.now() - (this.seenAt.get(id) ?? 0) < SEEN_FRESH_MS);
  };

  /** Ends the link and stops reconnecting; no automatic connect, even after a restart, until the next connect. */
  disconnect = async (): Promise<void> => {
    this.setStopped(true);
    this.pendingScanAt = null;
    this.resume = null;
    if (this.link === "scanning") this.endScan("cancel");
    await this.dropWant();
    this.error = null;
    this.emit();
  };

  /** Disconnects and forgets the remembered band. */
  forget = async (): Promise<void> => {
    await this.disconnect();
    this.remembered = null;
    this.setStopped(false);
    await AsyncStorage.removeItem(DEVICE_KEY).catch(() => {});
    this.emit();
  };

  setAutoConnect = async (on: boolean): Promise<void> => {
    this.autoConnect = on;
    if (on) this.setStopped(false);
    this.emit();
    await AsyncStorage.setItem(AUTO_CONNECT_KEY, on ? "1" : "0").catch(() => {});
    if (on) this.maybeConnect();
  };

  /** The person's stop, kept on the phone so the next app start doesn't search or reconnect on its own. */
  private setStopped(on: boolean) {
    this.userStopped = on;
    (on ? AsyncStorage.setItem(STOPPED_KEY, "1") : AsyncStorage.removeItem(STOPPED_KEY)).catch(() => {});
  }

  private async rememberDevice(d: BleDevice) {
    // Keep a name learned earlier when this connect has none.
    const name = d.name ?? (this.remembered?.id === d.id ? this.remembered.name : null);
    this.remembered = { id: d.id, name };
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(this.remembered)).catch(() => {});
  }

  /** Stops chasing the wanted band and closes its link; the state goes idle. */
  private async dropWant() {
    const id = this.device?.id;
    this.want = null;
    this.wasLive = false;
    this.clearRetry();
    await this.teardown(id);
    this.link = "idle";
    this.device = null;
    this.emit();
  }

  /**
   * Connects when it should, called whenever something changes (boot, radio on, permission granted, foreground, a
   * setting): a scan that was waiting, a paused reconnect, the band the background let go, or — with auto-connect —
   * the remembered band.
   */
  private maybeConnect() {
    if (!this.loaded || !this.foreground() || !this.ready()) return;
    if (this.pendingScanAt !== null) {
      const fresh = Date.now() - this.pendingScanAt < PENDING_SCAN_MS;
      this.pendingScanAt = null;
      if (fresh && this.link === "idle") {
        void this.scan();
        return;
      }
    }
    if (this.link === "live" || this.link === "scanning") return;
    if (this.want) {
      if (this.inFlight === null && !this.retryTimer) {
        this.attempts = 0;
        void this.attempt(false);
      }
      return;
    }
    if (this.link !== "idle") return;
    const target = this.resume ?? (this.autoConnect && !this.userStopped ? this.remembered : null);
    const resuming = !!this.resume;
    this.resume = null;
    if (!target) return;
    this.want = target;
    this.maxAttempts = resuming ? MAX_ATTEMPTS : MAX_AUTO_ATTEMPTS;
    this.attempts = 0;
    this.wasLive = false;
    void this.attempt(false);
  }

  /** One connection attempt to `want`; on failure the next is scheduled with backoff, up to the attempt limit. */
  private async attempt(justSeen: boolean) {
    const dev = this.want;
    if (!dev || !this.foreground() || !this.ready()) return;
    if (this.inFlight !== null && this.inFlight === this.gen) return;
    this.clearRetry();
    this.attempts++;
    const gen = ++this.gen;
    this.inFlight = gen;
    this.device = dev;
    this.link = this.wasLive ? "lost" : "connecting";
    this.emit();
    try {
      await this.open(dev, gen, justSeen && this.attempts === 1);
    } catch (e) {
      if (tagged(e, "superseded") || gen !== this.gen) return;
      log("attempt failed", String((e as Error)?.message ?? e));
      await this.teardown(dev.id);
      this.error = describe(e, dev.name ?? i18n.t("errors:ble.theBand"));
      this.scheduleRetry();
    } finally {
      if (this.inFlight === gen) this.inFlight = null;
    }
  }

  /** Find → connect → discover → subscribe. Resolves once subscribed; "live" comes with the first notification. */
  private async open(dev: BleDevice, gen: number, justSeen: boolean) {
    const m = this.manager;
    if (!m) throw liveError(i18n.t("errors:ble.btUnavailable"));
    const check = () => {
      if (gen !== this.gen) throw superseded();
    };
    // Android connects reliably to a band it has just seen advertising (a random address needs that); a band it
    // can't see may still be reachable directly when it is paired, so a miss is not the end.
    log("connect", dev.name, { attempt: this.attempts, justSeen });
    if (!justSeen) {
      const seen = await this.find(dev.id, FIND_MS);
      log("find", seen ? "seen" : "not seen, trying directly");
      check();
    }
    await m.connectToDevice(dev.id, { autoConnect: false, timeout: CONNECT_TIMEOUT_MS });
    log("connected");
    check();
    await m.discoverAllServicesAndCharacteristicsForDevice(dev.id);
    check();
    let services = await m.servicesForDevice(dev.id).catch(() => []);
    log("services", services.map((x) => x.uuid.slice(4, 8)).join(","));
    // A paired band (the Fitbit Air, paired to Google Health) adds the Heart Rate Service when Share heart rate comes on,
    // but Android keeps the service list it saved before, so the service looks missing. Reconnect once with that list
    // refreshed (our connection only: the link Google Health holds stays up) and look again.
    if (!services.some((x) => sameUuid(x.uuid, HR_SERVICE_UUID))) {
      await m.cancelDeviceConnection(dev.id).catch(() => {});
      check();
      await m.connectToDevice(dev.id, { autoConnect: false, timeout: CONNECT_TIMEOUT_MS, refreshGatt: "OnConnected" });
      check();
      await m.discoverAllServicesAndCharacteristicsForDevice(dev.id);
      check();
      services = await m.servicesForDevice(dev.id).catch(() => []);
      log("services after refresh", services.map((x) => x.uuid.slice(4, 8)).join(","));
    }
    // Watched only from here: the refresh above drops and remakes our connection on purpose.
    this.subs.push(m.onDeviceDisconnected(dev.id, (err) => this.lost(gen, err ?? liveError(i18n.t("errors:ble.disconnected", { device: dev.name ?? i18n.t("errors:ble.theBand") })))));
    const chars = await m.characteristicsForDevice(dev.id, HR_SERVICE_UUID).catch(() => []);
    check();
    if (!chars.some((c) => sameUuid(c.uuid, HR_MEASUREMENT_UUID)))
      throw liveError(i18n.t("errors:ble.notSharingConnections", { device: dev.name ?? i18n.t("errors:ble.thisDevice") }));
    this.subs.push(m.monitorCharacteristicForDevice(dev.id, HR_SERVICE_UUID, HR_MEASUREMENT_UUID, (err, ch) => this.onValue(gen, err, ch?.value ?? null), `pulse-hr-${gen}`));
    this.armBeatTimer(gen, FIRST_BEAT_MS, i18n.t("errors:ble.noBeats", { device: dev.name ?? i18n.t("errors:ble.theBandLower") }));
  }

  private onValue(gen: number, err: BleError | null, value: string | null) {
    if (gen !== this.gen) return;
    if (err) {
      // The subscription ends with an error when the link drops or the band refuses it.
      this.lost(gen, err);
      return;
    }
    if (!value) return;
    const hr = parseHrMeasurementBase64(value);
    if (!hr) return;
    const t = Date.now();
    this.armBeatTimer(gen, STALL_MS, i18n.t("errors:ble.stalled", { device: this.device?.name ?? i18n.t("errors:ble.theBand") }));
    if (this.link !== "live") {
      this.link = "live";
      log("live");
      this.wasLive = true;
      this.attempts = 0;
      this.maxAttempts = MAX_ATTEMPTS;
      this.error = null;
      this.retryAt = null;
      this.emit();
    }
    const sample: LiveSample = { t, bpm: hr.bpm, rrMs: hr.rrMs, contact: hr.contact };
    this.sampleListeners.forEach((fn) => {
      try {
        fn(sample);
      } catch (e) {
        console.warn("[ble] sample listener", e);
      }
    });
  }

  /** Silence for `ms` on this link counts as losing it. */
  private armBeatTimer(gen: number, ms: number, message: string) {
    if (this.beatTimer) clearTimeout(this.beatTimer);
    this.beatTimer = setTimeout(() => this.lost(gen, liveError(message)), ms);
  }

  /** The link `gen` ended without being asked to: tear it down and retry (when the radio and the foreground allow). */
  private lost(gen: number, err: unknown) {
    if (gen !== this.gen) return;
    const dev = this.device;
    log("lost", String((err as Error)?.message ?? err));
    void this.teardown(dev?.id).then(() => {
      this.error = describe(err, dev?.name ?? i18n.t("errors:ble.theBand"));
      if (this.radio !== "on" || !this.foreground()) {
        // Resumes from onRadio / onAppState.
        this.link = this.want ? (this.wasLive ? "lost" : "connecting") : "idle";
        this.emit();
        return;
      }
      this.scheduleRetry();
    });
  }

  private scheduleRetry() {
    if (!this.want) {
      this.link = "idle";
      this.device = null;
      this.emit();
      return;
    }
    if (this.attempts >= this.maxAttempts) {
      // Give up and say why (the last attempt's reason); connecting again starts over.
      this.error ??= i18n.t("errors:ble.cantFind", { device: this.want.name ?? i18n.t("errors:ble.theBandLower") });
      this.want = null;
      this.wasLive = false;
      this.link = "idle";
      this.device = null;
      this.retryAt = null;
      this.emit();
      return;
    }
    const delay = backoffMs(this.attempts);
    this.link = this.wasLive ? "lost" : "connecting";
    this.retryAt = Date.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryAt = null;
      void this.attempt(false);
    }, delay);
    this.emit();
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
  }

  /** Ends the current link (if any): every callback of it goes stale, subscriptions go, the connection is cancelled. */
  private async teardown(id?: string) {
    this.gen++;
    if (this.beatTimer) clearTimeout(this.beatTimer);
    this.beatTimer = null;
    const subs = this.subs;
    this.subs = [];
    subs.forEach((s) => {
      try {
        s.remove();
      } catch {
        // Already gone with the link.
      }
    });
    if (this.link !== "scanning") this.endScan("cancel");
    if (id && this.manager) await this.manager.cancelDeviceConnection(id).catch(() => {});
  }

  // ── Foreground and background ─────────────────────────────────────────────

  private onAppState(next: AppStateStatus) {
    const wasFg = this.wasForeground;
    this.wasForeground = isForeground(next);
    if (this.wasForeground) {
      if (this.bgTimer) clearTimeout(this.bgTimer);
      this.bgTimer = null;
      if (wasFg) return;
      // The person may have granted the permission or turned Bluetooth on in Settings meanwhile.
      void (async () => {
        this.permission = await this.checkPermission();
        await this.readRadio();
        this.emit();
        this.maybeConnect();
      })();
      return;
    }
    if (!wasFg) return;
    // Leaving: a scan stops now; a pending reconnect waits; the band itself is let go after the grace period. (A
    // scan waiting for a permission or Bluetooth dialog stays pending: those dialogs pause Pulse too.)
    if (this.link === "scanning") this.endScan("cancel");
    if (this.retryTimer) {
      this.clearRetry();
      this.emit();
    }
    if (!this.bgTimer && (this.want || this.link === "live")) this.bgTimer = setTimeout(() => void this.releaseForBackground(), BACKGROUND_GRACE_MS);
  }

  private async releaseForBackground() {
    this.bgTimer = null;
    if (this.foreground()) return;
    const target = this.want;
    await this.dropWant();
    // Picked up again when Pulse comes back (maybeConnect), whatever the auto-connect setting: this was a pause.
    this.resume = target;
  }
}

/** The app's one controller. `start()` is called by LiveBleProvider. */
export const liveBle = new LiveHeartRate();
