// The template update's preview: what updating the session's template would add, remove, skip or reshape, and the dialog
// that asks before the write. It reads the same plan the action writes, so the preview cannot promise another shape.
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { i18n } from "@/i18n/config";
import { getGymRoutineUpdate } from "@/queries/gym";
import { useScreen } from "@/screens/useScreen";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Text } from "@/ui/Text";

const plan = (sets: number, reps: number) => (reps > 0 ? `${sets} × ${reps}` : String(sets));

function Section({ title, tone, rows }: { title: string; tone?: string; rows: string[] }) {
  if (!rows.length) return null;
  return (
    <View className="gap-1">
      <Text className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{title}</Text>
      {rows.map((row, i) => (
        <Text key={`${row}-${i}`} className={cn("text-[13px] leading-[19px]", tone)}>
          {row}
        </Text>
      ))}
    </View>
  );
}

/** The diff alone: the finish dialog shows it under the switch, the menu's dialog above its buttons. */
export function TemplateUpdatePreview({ sessionId, maxHeight = 240 }: { sessionId: string; maxHeight?: number }) {
  const { t } = useTranslation("gym");
  const { data, error } = useScreen((ctx) => getGymRoutineUpdate(ctx, sessionId), ["gym-routine-update", sessionId]);
  if (error) return <Text className="text-[13px] text-recovery-red-text">{t("session.templateUnavailable")}</Text>;
  if (data === undefined) return <Text className="text-[13px] text-muted-foreground">{i18n.t("common:loading")}</Text>;
  if (!data) return <Text className="text-[13px] text-recovery-red-text">{t("session.templateUnavailable")}</Text>;
  const empty = !data.added.length && !data.removed.length && !data.skipped.length && !data.changed.length;
  if (empty) return <Text className="text-[13px] leading-[19px] text-foreground-secondary">{t("session.templateNoChanges")}</Text>;
  return (
    <ScrollView style={{ maxHeight }} contentContainerClassName="gap-3" showsVerticalScrollIndicator={false}>
      <Section title={t("session.templateAdded")} tone="text-strain-text" rows={data.added.map((i) => `+ ${i.exercise.name} · ${plan(i.sets, i.reps)}`)} />
      <Section title={t("session.templateRemoved")} tone="text-recovery-red-text" rows={data.removed.map((i) => `− ${i.exercise.name} · ${plan(i.sets, i.reps)}`)} />
      <Section title={t("session.templateSkipped")} tone="text-foreground-secondary" rows={data.skipped.map((i) => `~ ${i.exercise.name} · ${plan(i.sets, i.reps)}`)} />
      {!!data.skipped.length && <Text className="text-[12px] leading-4 text-muted-foreground">{t("session.templateSkippedHint")}</Text>}
      <Section title={t("session.templateChanged")} rows={data.changed.map((c) => `${c.exercise.name} · ${plan(c.from.sets, c.from.reps)} → ${plan(c.to.sets, c.to.reps)}`)} />
      {!!data.unchanged && <Text className="text-[12px] text-muted-foreground">{t("session.templateKept", { count: data.unchanged })}</Text>}
    </ScrollView>
  );
}

/** The overflow menu's ask: show the diff, then write it. */
export function TemplateUpdateDialog({ open, sessionId, onClose, onApply }: { open: boolean; sessionId: string; onClose: () => void; onApply: () => void }) {
  const { t } = useTranslation("gym");
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-dim-strong px-4">
        <Pressable onPress={() => {}} className="w-full max-w-[384px] gap-5 rounded-3xl bg-popover p-5">
          <View className="gap-2">
            <Text accessibilityRole="header" className="text-[17px] font-semibold leading-6">
              {t("session.updateTemplateTitle")}
            </Text>
            <Text className="text-[14px] leading-[21px] text-foreground-secondary">{t("session.updateTemplateBody")}</Text>
          </View>
          {open && <TemplateUpdatePreview sessionId={sessionId} maxHeight={320} />}
          <View className="gap-2">
            <Button onPress={onApply}>{t("session.updateTemplate")}</Button>
            <Button variant="outline" onPress={onClose}>
              {i18n.t("common:actions.cancel")}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
