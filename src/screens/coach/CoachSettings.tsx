// Coach settings `/coach/settings` (spec §7.21 Settings › Coach), ported from pulse src/app/(app)/coach/CoachSettings.tsx
// via halo: Provider, Model and the key as ••••last4; Change, Remove key, Delete chats, Turn off; and About you, up to
// 500 characters of the person's own notes for the coach. Without consent or a provider, the setup steps instead.
import { useState } from "react";
import { View } from "react-native";
import { MAX_NOTES } from "@/coach/instructions";
import { providerLabel, providerOf } from "@/coach/providers";
import { useCoachSetup } from "@/coach/session";
import { deleteAllChats, removeProvider, setAutoAnalysis, setConsent, setInstructions } from "@/coach/storage";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { DetailShell } from "@/ui/shells/DetailShell";
import { GROUP_LABEL } from "@/ui/shells/LinkList";
import { ConfirmDialog, Field, HINT, ROW, ROW_LABEL, ROW_RULE, ROW_VALUE, SmallButton, SwitchRow, TextField } from "@/screens/settings/controls";
import { cn } from "@/ui/cn";
import { ConnectProvider, Consent } from "./CoachSetup";

const failed = () => toast.error("Couldn’t save that on this phone. Try again.");

function Row({ label, value, first }: { label: string; value: string; first?: boolean }) {
  return (
    <View className={cn(ROW, "px-4", !first && ROW_RULE)}>
      <Text className={ROW_LABEL}>{label}</Text>
      <Text className={ROW_VALUE}>{value}</Text>
    </View>
  );
}

function Notes({ saved }: { saved: string | null }) {
  const [text, setText] = useState(saved ?? "");
  return (
    <Field label="About you" hint="How you’d like the coach to talk and what it should know. It never changes the coach’s safety rules." optional>
      <TextField
        accessibilityLabel="About you"
        value={text}
        onChangeText={setText}
        onBlur={() => text.trim() !== (saved ?? "") && void setInstructions(text).catch(failed)}
        multiline
        maxLength={MAX_NOTES}
        placeholder="Short and direct. I lift four days a week and I'm training for a half marathon."
      />
    </Field>
  );
}

type Confirm = "key" | "chats" | "off" | null;

export function CoachSettings() {
  const setup = useCoachSetup();
  const [changing, setChanging] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, setPending] = useState(false);

  // The person's own server: its address shows, and it may have no key to remove.
  const custom = providerOf(setup?.provider)?.custom;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setPending(true);
    try {
      await fn();
      toast.success(done);
    } catch {
      failed();
    }
    setPending(false);
    setConfirm(null);
  };
  const DIALOG = {
    key: custom
      ? { title: "Disconnect your server?", description: "The coach stops answering until you connect a provider again.", label: "Disconnect", go: () => run(removeProvider, "Server disconnected.") }
      : { title: "Remove your key?", description: "The coach stops answering until you add a key again.", label: "Remove key", go: () => run(removeProvider, "Key removed.") },
    chats: { title: "Delete every chat?", description: "Every chat on this phone is removed. This can’t be undone.", label: "Delete chats", go: () => run(deleteAllChats, "Chats deleted.") },
    off: { title: "Turn off the coach?", description: "Your key is removed and the coach asks for consent again. Your chats stay until you delete them.", label: "Turn off", go: () => run(async () => (await removeProvider(), await setConsent(false)), "Coach turned off.") },
  } as const;

  const body =
    setup === undefined ? null : !setup.consent ? (
      <Consent />
    ) : !setup.provider || changing ? (
      <View className="gap-4">
        <ConnectProvider current={setup} onSaved={() => setChanging(false)} />
        {changing && <SmallButton label="Cancel" onPress={() => setChanging(false)} />}
      </View>
    ) : (
      <View className="gap-6">
        <View className="gap-2">
          <Text className={GROUP_LABEL}>Provider</Text>
          <Card>
            <Row first label="Provider" value={providerLabel(setup.provider)} />
            <Row label="Model" value={setup.model ?? ""} />
            {!!custom && <Row label="Server" value={setup.baseUrl ?? ""} />}
            <Row label="API key" value={setup.last4 ? `••••${setup.last4}` : custom ? "None" : "Not saved"} />
          </Card>
          <View className="flex-row flex-wrap gap-2">
            <SmallButton label="Change" onPress={() => setChanging(true)} />
            <SmallButton label={custom ? "Disconnect" : "Remove key"} onPress={() => setConfirm("key")} />
          </View>
        </View>
        <Notes key={setup.instructions ?? ""} saved={setup.instructions} />
        <View className="gap-2">
          <Text className={GROUP_LABEL}>Workouts</Text>
          <SwitchRow rule={false} label="Analyze each workout" hint="A one-line take from your provider as a workout opens. Off, the coach answers only when you tap." value={setup.autoAnalysis} onChange={(on) => void setAutoAnalysis(on).catch(failed)} />
        </View>
        <View className="gap-2">
          <Text className={GROUP_LABEL}>Chats</Text>
          <Text className={HINT}>Saved on this phone, visible only to you.</Text>
          <View className="flex-row flex-wrap gap-2">
            <SmallButton label="Delete chats" onPress={() => setConfirm("chats")} />
            <SmallButton label="Turn off" onPress={() => setConfirm("off")} />
          </View>
        </View>
      </View>
    );

  const d = confirm && DIALOG[confirm];
  return (
    <DetailShell
      title="Coach settings"
      backHref="/more"
      loading={setup === undefined}
      primary={
        <View>
          {body}
          <ConfirmDialog open={!!d} title={d?.title ?? ""} description={d?.description ?? ""} confirmLabel={d?.label ?? ""} pendingLabel="Saving…" pending={pending} onCancel={() => setConfirm(null)} onConfirm={() => void d?.go()} />
        </View>
      }
    />
  );
}
