// Settings › Live heart rate (`/settings?s=live`), from halo src/screens/settings/liveHr.tsx (its behaviour and copy;
// drawn with Pulse's kit). Three cards: the band (status, the remembered band, auto-connect, Go live / Stop, Forget),
// the permissions, and Go live: the three steps in Google Health, then the scan, the bands it finds and the
// connection. A scan runs only when asked: Search / Go live here, or once on arrival from Heart rate's Go live (`go=1`).
//
// The band shares heart rate with the standard Bluetooth Heart Rate Service once Google Health › Fitbit Air ›
// Connections › Share heart rate is on (src/health/ble.ts). Live readings are for viewing only: scores keep using what
// Pulse reads from Health Connect.
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { BatteryMedium, Bluetooth, BluetoothOff, ChevronRight, ExternalLink, Info, Watch, type LucideIcon } from "lucide-react-native";
import { BACKGROUND_GRACE_MS } from "@/health/ble";
import { i18n } from "@/i18n/config";
import { signalWord } from "@/health/bleHr";
import { MISSING } from "@/lib/format";
import { showsLive, useLiveBle, useLiveBleControl, type FoundDevice, type LiveControl, type LiveData } from "@/state/liveBle";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { BeatingHeart, GoLiveButton, LivePill, StopLiveButton } from "@/ui/metrics/LiveHeartRate";
import { CAPTION, ValueUnit } from "@/ui/metrics/primitives";
import { Press } from "@/ui/Press";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { openApp } from "../../../modules/pulse-bt";
import { BODY, ConfirmDialog, HINT, ROW, ROW_LABEL, ROW_RULE, ROW_VALUE, Switch } from "./controls";

type Live = LiveControl & LiveData;

const GOOGLE_HEALTH = "com.fitbit.FitbitMobile";
/** How long Pulse keeps the band after leaving the foreground, in words. */
const GRACE_SECONDS = Math.round(BACKGROUND_GRACE_MS / 1000);
const WARN = "text-[13px] font-semibold leading-[18px] text-warning-text";

/** The status in a few words. */
function statusLabel(l: Live): string {
  switch (l.status) {
    case "live":
      return i18n.t("settings:live.status.live", { bpm: l.bpm ?? MISSING });
    case "lost":
      return i18n.t("settings:live.status.lost");
    case "connecting":
      return i18n.t("settings:live.status.connecting");
    case "scanning":
      return i18n.t("settings:live.status.scanning");
    case "unauthorized":
      return i18n.t("settings:live.status.unauthorized");
    case "off":
      return i18n.t(l.radio === "unsupported" ? "settings:live.status.noBluetooth" : l.radio === "unavailable" ? "settings:live.status.notAvailable" : "settings:live.status.bluetoothOff");
    default:
      return i18n.t("settings:live.status.notConnected");
  }
}

function Row({ label, value, tone, rule }: { label: string; value: string; tone?: string; rule?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} className={cn(ROW, rule && ROW_RULE)}>
      <Text className={ROW_LABEL}>{label}</Text>
      <Text className={cn(ROW_VALUE, tone)}>{value}</Text>
    </View>
  );
}

/** A tinted box with an icon and a line or two: the band's state when there is no list to show. */
function Panel({ icon, title, body }: { icon: ReactNode; title: string; body?: string | null }) {
  return (
    <View accessibilityRole="summary" className="flex-row items-center gap-3 rounded-xl bg-foreground/[0.04] p-4">
      <View className="size-11 shrink-0 items-center justify-center rounded-xl bg-fill-faint">{icon}</View>
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold leading-[22px]">{title}</Text>
        {!!body && <Text className={HINT}>{body}</Text>}
      </View>
    </View>
  );
}

// ── The band ─────────────────────────────────────────────────────────────────

// The per-beat rows read the live data themselves (≤ 4 renders a second); the cards around them take the controller only.
function StatusRow() {
  const { t } = useTranslation("settings");
  const live = useLiveBle();
  return <Row label={t("live.statusLabel")} value={statusLabel(live)} tone={live.status === "live" ? "text-recovery-red-text" : undefined} />;
}

function HrvRow() {
  const { t } = useTranslation("settings");
  const live = useLiveBle();
  return <Row rule label={t("live.hrv")} value={live.rmssd === null ? (live.rrMs.length ? t("live.measuring") : t("live.notSent")) : `${Math.round(live.rmssd)} ms`} />;
}

function BandCard({ live, onFind }: { live: LiveControl; onFind: () => void }) {
  const { t } = useTranslation("settings");
  const [confirmForget, setConfirmForget] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const linked = live.status === "live" || live.status === "connecting" || live.status === "lost";
  const noRadio = live.radio === "unsupported" || live.radio === "unavailable";
  const remembered = live.remembered;
  return (
    <SectionShell variant="card" title={t("live.title")}>
      <View>
        <StatusRow />
        <Row rule label={t("live.band")} value={remembered ? (remembered.name ?? t("live.unnamedBand")) : t("live.none")} />
        {live.status === "live" && <HrvRow />}
        <View className={cn(ROW, ROW_RULE, !remembered && "opacity-disabled")}>
          <View className="min-w-0 flex-1">
            <Text className={ROW_LABEL}>{t("live.autoConnect")}</Text>
            <Text className={HINT}>{t("live.autoConnectHint")}</Text>
          </View>
          <Switch label={t("live.autoConnect")} value={live.autoConnect} disabled={!remembered} onValueChange={(v) => void live.setAutoConnect(v)} />
        </View>
      </View>
      {!!live.error && !linked && (
        <Text accessibilityRole="alert" className={cn(WARN, "mt-2")}>
          {live.error}
        </Text>
      )}
      <View className="mt-4 gap-2">
        {linked ? (
          <StopLiveButton onPress={() => void live.disconnect()} />
        ) : (
          <GoLiveButton status={live.status} onPress={() => (remembered ? void live.connect(remembered.id) : onFind())} disabled={noRadio} />
        )}
        {remembered && (
          <Button variant="outline" textClassName="text-recovery-red-text" onPress={() => setConfirmForget(true)}>
            {t("live.forgetBand")}
          </Button>
        )}
      </View>
      <ConfirmDialog
        open={confirmForget}
        title={t("live.forgetTitle")}
        description={t("live.forgetBody")}
        confirmLabel={t("live.forgetBand")}
        pendingLabel={t("live.forgetting")}
        pending={forgetting}
        onCancel={() => setConfirmForget(false)}
        onConfirm={async () => {
          setForgetting(true);
          await live.forget();
          setForgetting(false);
          setConfirmForget(false);
        }}
      />
    </SectionShell>
  );
}

function PermissionsCard({ live }: { live: LiveControl }) {
  const { t } = useTranslation("settings");
  const [btHint, setBtHint] = useState<string | null>(null);
  const noRadio = live.radio === "unsupported" || live.radio === "unavailable";
  const permission = live.permission === "granted" ? t("live.permAllowed") : live.permission === "blocked" ? t("live.permBlocked") : t("live.permNotYet");
  const radio = live.radio === "on" ? t("live.radioOn") : live.radio === "off" ? t("live.radioOff") : live.radio === "turning" ? t("live.radioTurning") : noRadio ? t("live.radioNotAvailable") : t("live.radioUnknown");
  return (
    <SectionShell variant="card" title={t("live.permissions")}>
      <View>
        <Row label={t("live.nearby")} value={permission} tone={live.permission === "granted" ? undefined : "text-warning-text"} />
        <Row rule label={t("live.bluetooth")} value={radio} tone={live.radio === "on" ? undefined : "text-warning-text"} />
      </View>
      <Text className={cn(HINT, "mt-2")}>{t("live.nearbyNote")}</Text>
      {live.permission !== "granted" && (
        <Button className="mt-4" onPress={() => void live.requestPermission()}>
          {live.permission === "blocked" ? t("live.openAndroidSettings") : t("live.allowNearby")}
        </Button>
      )}
      {live.permission === "granted" && live.radio === "off" && (
        <Button className="mt-4" onPress={() => void live.turnOnBluetooth().then((ok) => setBtHint(ok ? null : t("live.quickSettings")))}>
          {t("live.turnOnBluetooth")}
        </Button>
      )}
      {!!btHint && <Text className={cn(WARN, "mt-2")}>{btHint}</Text>}
    </SectionShell>
  );
}

// ── Go live ──────────────────────────────────────────────────────────────────

const STEPS = [
  { title: "live.step1Title", body: "live.step1Body" },
  { title: "live.step2Title", body: "live.step2Body" },
  { title: "live.step3Title", body: "live.step3Body" },
] as const;

function Steps() {
  const { t } = useTranslation("settings");
  const [missing, setMissing] = useState(false);
  return (
    <View className="gap-4">
      {/* Straight to where the setting lives. */}
      <Button variant="secondary" onPress={() => setMissing(!openApp(GOOGLE_HEALTH))} accessibilityLabel={t("live.openGoogleHealth")}>
        <Icon icon={ExternalLink} size={16} tone="secondary-foreground" strokeWidth={2.25} />
        <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">{t("live.openGoogleHealth")}</Text>
      </Button>
      {missing && <Text className={WARN}>{t("live.googleHealthFailed")}</Text>}
      {STEPS.map((s, i) => (
        <View key={s.title} accessible accessibilityLabel={t("live.stepLabel", { n: i + 1, title: t(s.title), body: t(s.body) })} className="flex-row gap-3">
          <View className="size-8 items-center justify-center rounded-full bg-fill-faint">
            <Text className="font-numeric text-base font-bold">{String(i + 1)}</Text>
          </View>
          <View className="min-w-0 flex-1 pt-1">
            <Text className="text-[15px] font-semibold leading-[22px]">{t(s.title)}</Text>
            <Text className={BODY}>{t(s.body)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Note({ icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <View className="flex-row gap-2.5">
      <View className="mt-0.5">
        <Icon icon={icon} size={16} tone="muted-foreground" strokeWidth={2} />
      </View>
      <Text className={cn(HINT, "flex-1")}>{children}</Text>
    </View>
  );
}

function DeviceRow({ d, onPress, aside, rule }: { d: FoundDevice; onPress: () => void; aside?: string; rule?: boolean }) {
  const { t } = useTranslation("settings");
  const signal = signalWord(d.rssi);
  const detail = [d.paired ? t("live.pairedHere") : d.likely ? t("live.likelyBand") : null, signal ? t("live.signal", { signal }) : null, aside ?? null].filter(Boolean).join(" · ");
  return (
    <Press
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={detail ? t("live.connectToDetail", { name: d.name ?? t("live.unnamedDevice"), detail }) : t("live.connectTo", { name: d.name ?? t("live.unnamedDevice") })}
      onPress={onPress}
      className={cn("min-h-14 flex-row items-center gap-3 py-2", rule && ROW_RULE)}
    >
      <View className="size-11 shrink-0 items-center justify-center rounded-xl bg-fill-faint">
        <Icon icon={Watch} size={20} tone={d.likely ? "recovery-red-text" : "foreground-secondary"} strokeWidth={2} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold leading-[22px]">{d.name ?? t("live.unnamedDeviceTitle")}</Text>
        {!!detail && <Text className={HINT}>{detail}</Text>}
      </View>
      <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary">{t("live.connect")}</Text>
      <Icon icon={ChevronRight} size={16} tone="foreground-secondary" strokeWidth={2} />
    </Press>
  );
}

function secondsUntil(at: number | null, now: number) {
  return at === null ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** What the link is doing, or the scan's list. */
function BandState() {
  const { t } = useTranslation("settings");
  const live = useLiveBle();
  const { c } = useTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (live.retryAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live.retryAt]);
  const name = live.device?.name ?? live.remembered?.name ?? t("live.theBand");

  if (live.status === "off") {
    if (live.radio === "unsupported" || live.radio === "unavailable")
      return (
        <Panel
          icon={<Icon icon={BluetoothOff} size={20} tone="foreground-secondary" strokeWidth={2} />}
          title={live.radio === "unsupported" ? t("live.noBluetoothTitle") : t("live.bluetoothUnavailableTitle")}
          body={live.radio === "unsupported" ? t("live.noBluetoothBody") : t("live.bluetoothUnavailableBody")}
        />
      );
    return <Panel icon={<Icon icon={BluetoothOff} size={20} tone="warning-text" strokeWidth={2} />} title={t("live.bluetoothOffTitle")} body={t("live.bluetoothOffBody")} />;
  }
  if (live.status === "unauthorized")
    return (
      <Panel
        icon={<Icon icon={Bluetooth} size={20} tone="warning-text" strokeWidth={2} />}
        title={t("live.allowNearbyTitle")}
        body={live.permission === "blocked" ? t("live.nearbyBlockedBody") : t("live.nearbyBody")}
      />
    );
  if (showsLive(live))
    return (
      <View accessibilityRole="summary" className="flex-row items-center gap-4 rounded-xl bg-foreground/[0.04] p-4">
        <View className="size-13 items-center justify-center rounded-xl bg-fill-faint">
          <BeatingHeart bpm={live.bpm ?? 60} live={live.status === "live"} size={26} />
        </View>
        <View className="min-w-0 flex-1 gap-1.5">
          <ValueUnit value={live.bpm === null ? MISSING : String(live.bpm)} unit="bpm" className="font-numeric text-[34px] font-bold leading-[38px]" />
          <LivePill name={live.device?.name ?? null} lost={live.status === "lost"} />
        </View>
      </View>
    );
  if (live.status === "connecting" || live.status === "lost") {
    const wait = secondsUntil(live.retryAt, now);
    return (
      <Panel
        icon={<ActivityIndicator size="small" color={c["recovery-red"]} />}
        title={t(live.status === "lost" ? "live.reconnectingTo" : "live.connectingTo", { name })}
        body={wait !== null && wait > 0 ? (live.error ? t("live.retryInWithError", { error: live.error, seconds: wait }) : t("live.retryIn", { seconds: wait })) : live.error}
      />
    );
  }

  // idle / scanning: the list.
  const remembered = live.remembered && !live.found.some((d) => d.id === live.remembered!.id) ? live.remembered : null;
  return (
    <View>
      {live.status === "scanning" && (
        <View className="flex-row items-center gap-2.5 py-2">
          <ActivityIndicator size="small" color={c["recovery-red"]} />
          <Text className={cn(BODY, "flex-1")}>{t("live.lookingFor")}</Text>
        </View>
      )}
      {live.found.map((d, i) => (
        <DeviceRow key={d.id} rule={i > 0} d={d} onPress={() => void live.connect(d.id)} aside={live.remembered?.id === d.id ? t("live.lastUsed") : undefined} />
      ))}
      {remembered && (
        <DeviceRow
          rule={live.found.length > 0}
          d={{ id: remembered.id, name: remembered.name, rssi: null, likely: true }}
          onPress={() => void live.connect(remembered.id)}
          aside={live.status === "scanning" ? t("live.lastUsedNotSeen") : t("live.lastUsed")}
        />
      )}
      {live.status === "idle" && !!live.error && (
        <Text accessibilityRole="alert" className={cn(WARN, "mt-2")}>
          {live.error}
        </Text>
      )}
    </View>
  );
}

/** The one action the band's state calls for (halo's Go-live sheet footer). */
function BandAction({ live }: { live: LiveControl }) {
  const { t } = useTranslation("settings");
  const [btHint, setBtHint] = useState<string | null>(null);
  let action: ReactNode = null;
  if (live.status === "off") {
    if (live.radio !== "unsupported" && live.radio !== "unavailable")
      action = <Button onPress={() => void live.turnOnBluetooth().then((ok) => setBtHint(ok ? null : t("live.quickSettingsBack")))}>{t("live.turnOnBluetooth")}</Button>;
  } else if (live.status === "unauthorized")
    action = <Button onPress={() => void live.requestPermission()}>{live.permission === "blocked" ? t("live.openSettings") : t("live.allowNearby")}</Button>;
  else if (live.status === "live" || live.status === "connecting" || live.status === "lost")
    action = (
      <Button variant="secondary" onPress={() => void live.disconnect()}>
        {live.status === "live" ? t("live.disconnect") : t("live.cancel")}
      </Button>
    );
  else if (live.status === "scanning")
    action = (
      <Button variant="secondary" onPress={live.stopScan}>
        {t("live.stopSearching")}
      </Button>
    );
  else action = <Button onPress={() => void live.scan()}>{live.found.length || live.error ? t("live.searchAgain") : t("live.searchForBand")}</Button>;
  return (
    <>
      {action}
      {!!btHint && live.status === "off" && <Text className={WARN}>{btHint}</Text>}
    </>
  );
}

/**
 * Scans only when the person asks: Search / Go live here, or once on arrival from Heart rate's Go live button (`go=1`).
 * Never again by itself, not on coming back to the app nor when Bluetooth comes on. Leaving stops a scan still running.
 */
function useScanOnce(live: LiveControl, on: boolean) {
  const latest = useRef(live);
  useEffect(() => {
    latest.current = live;
  });
  const done = useRef(false);
  const ready = live.loaded && live.status === "idle";
  useEffect(() => {
    if (!on || !ready || done.current) return;
    done.current = true;
    void latest.current.scan();
  }, [on, ready]);
  useEffect(() => () => latest.current.stopScan(), []);
}

function GoLiveCard({ live, scanOnArrival }: { live: LiveControl; scanOnArrival: boolean }) {
  const { t } = useTranslation("settings");
  useScanOnce(live, scanOnArrival);
  return (
    <SectionShell variant="card" title={t("live.goLive")}>
      <Text className={cn(BODY, "mb-4")}>{t("live.goLiveIntro")}</Text>
      <Steps />
      <Text className={cn(CAPTION, "mb-2 mt-6 uppercase tracking-[0.1em]")}>{t("live.yourBand")}</Text>
      <View className="gap-3">
        <BandState />
        <BandAction live={live} />
      </View>
      <View className="mt-6 gap-2.5">
        <Note icon={BatteryMedium}>
          {t("live.batteryNote", { seconds: GRACE_SECONDS })}
        </Note>
        <Note icon={Info}>{t("live.viewingNote")}</Note>
      </View>
    </SectionShell>
  );
}

/** Settings › Live heart rate (`/settings?s=live`; `&go=1` scans on arrival). */
export function LiveHeartRate() {
  const live = useLiveBleControl();
  const { go } = useLocalSearchParams<{ go?: string }>();
  return (
    <>
      <BandCard live={live} onFind={() => void live.scan()} />
      <GoLiveCard live={live} scanOnArrival={go === "1"} />
      <PermissionsCard live={live} />
    </>
  );
}
