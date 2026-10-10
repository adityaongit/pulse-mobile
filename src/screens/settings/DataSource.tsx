// Data source (spec §7.14). Ported from pulse (app)/settings/SettingsView.tsx `DataSource` and SettingsClient.tsx
// (`DisconnectButton`, `SwitchGoogleButton`): the source as one row (logo, name, last sync), its status only when
// something needs doing, Sync now, and the per-type sync status folded underneath. Dropped: the demo source, the Google
// account's email under the name (the app never receives it), and the OAuth toast (connect.ts reports its own).
import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Check, ChevronDown, CircleAlert, Minus, RefreshCw, TriangleAlert } from "lucide-react-native";
import { disconnectGoogle } from "@/actions/reset";
import { store } from "@/data/store";
import { ago } from "@/lib/format";
import type { SettingsVM } from "@/queries/types";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { CAPTION } from "@/ui/metrics/primitives";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { connectGoogle, forgetGoogleTokens, syncNow } from "./connect";
import { BODY, ConfirmDialog, Divider, ProgressBar, ROW_LABEL } from "./controls";
import { GoogleFit } from "./GoogleFit";
import { toast } from "@/ui/Toast";

/** Where a Google account without a Google Health profile sets one up (pulse src/lib/google.ts). */
const HEALTH_SIGNUP_URL = "https://fitbit.google.com/auth/signup";

/** The status line under the source name, and what to do about it. Connected says nothing more: its line has the last sync. */
const SOURCE: Record<Exclude<SettingsVM["source"]["status"], "demo">, { line?: string; tone?: string; body?: string }> = {
  not_connected: { line: "Not connected", body: "Connect the Google account your Fitbit Air syncs to. Pulse reads your data and writes only what you log in Pulse." },
  not_linked: {
    line: "No Google Health profile",
    tone: "text-warning-text",
    body: "This Google account has no Google Health profile, so there is no Fitbit data to read. Set up Google Health with this account (or move your Fitbit account to it), or switch to the account your Fitbit Air uses.",
  },
  no_device: {
    line: "No Fitbit device",
    tone: "text-warning-text",
    body: "This Google account has Google Health but no Fitbit device, so there is nothing to import. Pair your Fitbit Air in the Google Health app and sync again, or switch to the account it uses.",
  },
  connected: {},
  revoked: { line: "Access revoked", tone: "text-recovery-red-text", body: "Google access was revoked or expired. Sync is paused until you reconnect." },
};

const STATUS_WORD = { ok: "up to date", stale: "behind", error: "failed", never: "not synced yet" };

function SyncIcon({ status }: { status: SettingsVM["sync"][number]["status"] }) {
  if (status === "ok") return <Icon icon={Check} size={16} tone="optimal-text" strokeWidth={2.5} />;
  if (status === "stale") return <Icon icon={TriangleAlert} size={16} tone="warning-text" strokeWidth={2} />;
  if (status === "error") return <Icon icon={CircleAlert} size={16} tone="recovery-red-text" strokeWidth={2} />;
  return <Icon icon={Minus} size={16} tone="muted-foreground" strokeWidth={2} />;
}

/** Per data type, folded under one summary line; it opens itself when something failed or fell behind. */
function DataTypes({ rows, now }: { rows: SettingsVM["sync"]; now: number }) {
  const failing = rows.filter((r) => r.status === "error").length;
  const behind = rows.filter((r) => r.status === "stale").length;
  const summary = failing ? `${failing} failing` : behind ? `${behind} behind` : rows.every((r) => r.status === "ok") ? "All up to date" : "Waiting for first sync";
  const [open, setOpen] = useState(failing + behind > 0);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(open ? "180deg" : "0deg", { duration: 200 }) }] }), [open]);
  return (
    <View className="mt-4 border-t border-border">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          haptic.toggle(!open);
          setOpen(!open);
        }}
        className="min-h-13 flex-row items-center justify-between gap-3 rounded-md py-2"
      >
        <Text className={ROW_LABEL}>Data types</Text>
        <View className="flex-row items-center gap-2">
          <Text className={cn("text-[13px] leading-[18px]", failing ? "text-recovery-red-text" : behind ? "text-warning-text" : "text-muted-foreground")}>{summary}</Text>
          <Animated.View style={chevron}>
            <Icon icon={ChevronDown} size={16} tone="muted-foreground" strokeWidth={2} />
          </Animated.View>
        </View>
      </Pressable>
      {open && (
        <View className="border-t border-border">
          {rows.map((r, i) => (
            <View key={r.key}>
              {i > 0 && <Divider />}
              <View accessible accessibilityLabel={`${r.label}, ${r.lastSuccessAt ? ago(r.lastSuccessAt, now) : "never"}, ${STATUS_WORD[r.status]}`} className="min-h-12 flex-row items-center gap-3 py-2">
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-[15px] leading-[22px]">
                    {r.label}
                  </Text>
                  {r.status === "error" && r.error && <Text className={cn(CAPTION, "text-recovery-red-text")}>{r.error}</Text>}
                </View>
                <Text className={cn(CAPTION, "shrink-0 font-numeric tabular-nums")}>{r.lastSuccessAt ? ago(r.lastSuccessAt, now) : "Never"}</Text>
                <SyncIcon status={r.status} />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const LABEL = "text-[13px] font-bold uppercase tracking-[0.1em]";

/** The icon of Sync now, spinning while it runs (on the UI thread). */
function Spinner({ spinning }: { spinning: boolean }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    if (spinning) turn.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    else {
      cancelAnimation(turn);
      turn.value = 0;
    }
  }, [spinning, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon icon={RefreshCw} size={20} tone="secondary-foreground" strokeWidth={2} />
    </Animated.View>
  );
}

/** "Sync now": a sync past the 5-minute gate, then the screens reload. The outcome is a toast. */
function SyncNowButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      className="flex-1"
      disabled={pending}
      onPress={async () => {
        haptic.tap();
        setPending(true);
        const r = await syncNow();
        setPending(false);
        if (r.ok) toast.success("Synced");
        else toast.error(r.error);
      }}
    >
      <Spinner spinning={pending} />
      <Text className={cn(LABEL, "text-secondary-foreground")}>{pending ? "Syncing…" : "Sync now"}</Text>
    </Button>
  );
}

/** "Disconnect" and its confirmation dialog (spec §7.14). */
function DisconnectButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setPending(true);
    setError(null);
    const r = await disconnectGoogle(store, forgetGoogleTokens);
    setPending(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    toast.success("Google access removed");
  };
  return (
    <>
      <Button variant="outline" textClassName="text-recovery-red-text" className="flex-1" onPress={() => setOpen(true)}>
        Disconnect
      </Button>
      <ConfirmDialog
        open={open}
        title="Disconnect Google?"
        description="Pulse forgets its Google access and removes what it synced from Google: heart rate, sleep, steps and the scores built from them. Your journal and profile stay. You can connect again any time."
        error={error}
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting…"
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={run}
      />
    </>
  );
}

/** "Switch account": connect a different Google account. Its confirmation says what happens to the data the current account synced. */
function SwitchGoogleButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        onPress={() => {
          haptic.tap();
          setOpen(true);
        }}
      >
        Switch Google account
      </Button>
      <ConfirmDialog
        open={open}
        title="Switch Google account?"
        description="Pulse removes the data synced so far and imports the new account’s history. Your journal, profile and dashboard stay."
        confirmLabel="Choose account"
        pendingLabel="Choose account"
        pending={false}
        confirmVariant="primary"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setOpen(false);
          const r = await connectGoogle({ switchAccount: true });
          if (!r.ok) toast.error(r.error);
        }}
      />
    </>
  );
}

/** A "Connect Google" / "Reconnect Google" button: the connect step starts here. */
function ConnectButton({ label, className }: { label: string; className?: string }) {
  return (
    <Button
      className={className}
      onPress={async () => {
        const r = await connectGoogle();
        if (!r.ok) toast.error(r.error);
      }}
    >
      {label}
    </Button>
  );
}

export function DataSource({ vm, now }: { vm: Pick<SettingsVM, "source" | "sync" | "import">; now: number }) {
  const { source } = vm;
  const status = source.status === "demo" ? "not_connected" : source.status;
  const s = SOURCE[status];
  const last = vm.sync.reduce<number | null>((m, r) => (r.lastSuccessAt && (!m || r.lastSuccessAt > m) ? r.lastSuccessAt : m), null);
  const line = s.line ?? (last ? `Synced ${ago(last, now)}` : "Not synced yet");
  const actions =
    status === "connected" || status === "no_device" ? (
      <View className="flex-row gap-2">
        <SyncNowButton />
        <DisconnectButton />
      </View>
    ) : status === "not_linked" ? (
      <View className="flex-row gap-2">
        <Button className="flex-1" onPress={() => Linking.openURL(HEALTH_SIGNUP_URL)}>
          Set up
        </Button>
        <DisconnectButton />
      </View>
    ) : status === "revoked" ? (
      <View className="flex-row gap-2">
        <ConnectButton label="Reconnect Google" className="flex-1" />
        <DisconnectButton />
      </View>
    ) : (
      <ConnectButton label="Connect Google" />
    );
  return (
    <SectionShell variant="card" title="Data source">
      <View className="min-h-11 flex-row items-center gap-3">
        <View accessibilityElementsHidden className="size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-foreground/[0.06]">
          <GoogleFit size={24} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold leading-[22px]">{source.label}</Text>
          <Text numberOfLines={1} className={cn("text-[13px] leading-[18px] tabular-nums text-muted-foreground", s.tone)}>
            {line}
          </Text>
        </View>
      </View>
      {s.body && <Text className={cn(BODY, "mt-3")}>{s.body}</Text>}
      {source.needsPermissions && (
        <View accessibilityRole="summary" className="mt-4 rounded-xl bg-foreground/[0.04] p-4">
          <View className="flex-row items-center gap-2">
            <Icon icon={TriangleAlert} size={16} tone="warning-text" strokeWidth={2} />
            <Text accessibilityRole="header" className="shrink text-[15px] font-semibold leading-[22px]">
              Pulse needs new permissions
            </Text>
          </View>
          <Text className={cn(BODY, "mt-1")}>
            To save what you log (water, food, weight, mood, symptoms, cycle) to Google Health, reconnect Google and allow them. Sync keeps working until then.
          </Text>
          <View className="mt-3">
            <ConnectButton label="Reconnect Google" />
          </View>
        </View>
      )}
      {vm.import && (
        <View accessibilityLiveRegion="polite" className="mt-4 gap-2">
          <Text className="text-[15px] leading-[22px] tabular-nums">
            Importing history… {vm.import.done} of {vm.import.total}&nbsp;days
          </Text>
          <ProgressBar value={(vm.import.done / vm.import.total) * 100} label="Import progress" />
        </View>
      )}
      <View className="mt-4 gap-2">
        {actions}
        {status !== "not_connected" && <SwitchGoogleButton />}
      </View>
      {vm.sync.length > 0 && <DataTypes rows={vm.sync} now={now} />}
    </SectionShell>
  );
}

