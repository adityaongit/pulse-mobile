// Import from Strong `/gym/import`: pick the CSV, see what it holds, then write it. The parser is pure (src/core/gym/csv.ts)
// and the write (src/actions/gym.ts) never overwrites a day already in the log.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { File } from "expo-file-system";
import { FileUp, History, Undo2 } from "lucide-react-native";
import { actionCtx, dataChanged } from "@/state/app";
import { importStrong, previewStrong, undoStrongImport, type ImportOutcome, type ImportPreview } from "@/actions/gym";
import type { GymImportState } from "@/data/gym";
import { getGymImport } from "@/queries/gym";
import { useScreen } from "@/screens/useScreen";
import { Button } from "@/ui/Button";
import { Card, CardFill } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { DetailShell } from "@/ui/shells/DetailShell";
import { ProgressBar } from "@/ui/ProgressBar";
import { DAY, formatDay } from "@/lib/format";
import { toast } from "@/ui/Toast";
import { ConfirmDialog, StatTile } from "./parts";
import { attempt } from "@/lib/attempt";

export function ImportScreen() {
  const { t } = useTranslation("gym");
  const { data: last } = useScreen(getGymImport, ["gym-import"]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [done, setDone] = useState<ImportOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState<GymImportState | null>(null);

  const choose = async () => {
    setBusy(true);
    await attempt(async () => {
      const picked = await File.pickFileAsync({ mimeTypes: ["text/csv", "text/plain", "application/vnd.ms-excel", "text/comma-separated-values", "*/*"] });
      if (picked.canceled) return;
      const content = await picked.result.text();
      const res = await previewStrong(actionCtx(), content);
      if (!res.ok) {
        toast.error(t(res.error === "emptyFile" ? "import.errorEmpty" : res.error === "notStrong" ? "import.errorFormat" : "import.errorNothing"));
        return;
      }
      setText(content);
      setPreview(res.data);
      setDone(null);
    }, { catch: () => {
      toast.error(t("import.error"));
    }, finally: () => {
      setBusy(false);
    } });
  };

  const run = async () => {
    if (!text) return;
    setBusy(true);
    setProgress({ done: 0, total: preview?.result.sessions.length ?? 0 });
    await attempt(async () => {
      const res = await importStrong(actionCtx(), text, setProgress);
      if (!res.ok) {
        toast.error(t("import.nothing"));
        return;
      }
      setDone(res.data);
      setPreview(null);
      dataChanged("gym");
      toast.success(t("import.done", { count: res.data.sessions }));
    }, { finally: () => {
      setBusy(false);
      setProgress(null);
    } });
  };

  const s = done ?? preview?.result.summary ?? null;
  const duplicates = done?.duplicates ?? preview?.duplicates ?? 0;
  const newExercises = done?.custom.length ?? preview?.custom.length ?? 0;
  const lastUndoable = last?.sessionIds?.length ? last : null;

  const runUndo = async () => {
    if (!confirmUndo) return;
    setUndoing(true);
    await attempt(async () => {
      await undoStrongImport(actionCtx().store, confirmUndo);
      dataChanged("gym");
      setDone(null);
      setPreview(null);
      setText(null);
      setConfirmUndo(null);
      toast.success(t("import.undone"));
    }, { finally: () => {
      setUndoing(false);
    } });
  };

  return (
    <DetailShell
      title={t("import.title")}
      floatingAction={false}
      backHref="/gym"
      dismiss="close"
      primary={
        <View className="gap-6">
          <Text className="text-[14px] leading-[21px] text-foreground-secondary">{t("import.body")}</Text>

          {!!s && (
            <Card className="gap-3 px-4 py-4">
              <CardFill />
              <Text className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{done ? t("import.done", { count: done.sessions }) : t("import.preview")}</Text>
              <View className="flex-row gap-2">
                <StatTile label={t("import.workoutsLabel")} value={String(s.sessions)} />
                <StatTile label={t("import.setsLabel")} value={String(s.sets)} />
              </View>
              <View className="flex-row gap-2">
                <StatTile label={t("import.notesLabel")} value={String(s.notes)} />
                <StatTile label={t("import.customLabel")} value={String(newExercises)} />
              </View>
              {!!s.from && !!s.to && <Text className="text-[12px] text-muted-foreground">{t("import.range", { from: formatDay(s.from, DAY.monthDay), to: formatDay(s.to, DAY.monthDay) })}</Text>}
              {duplicates > 0 && <Text className="text-[12px] text-muted-foreground">{t("import.duplicates", { count: duplicates })}</Text>}
              {s.cappedDuration > 0 && <Text className="text-[12px] text-warning-text">{t("import.capped", { count: s.cappedDuration })}</Text>}
            </Card>
          )}

          {!!progress && (
            <View className="gap-2">
              <ProgressBar value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} label={t("import.importing")} />
              <Text className="text-[12px] tabular-nums text-muted-foreground">
                {t("import.importing")} {progress.done} / {progress.total}
              </Text>
            </View>
          )}

          {done ? (
            <View className="gap-2">
              <Button onPress={() => void choose()} disabled={busy}>
                {t("import.again")}
              </Button>
              <Button variant="ghost" textClassName="text-recovery-red-text" disabled={busy || undoing} onPress={() => setConfirmUndo({ importedAt: 0, sessions: done.sessions, sets: done.sets, firstDay: done.from, lastDay: done.to, sessionIds: done.sessionIds, routineIds: done.routineIds })}>
                <View className="flex-row items-center gap-2">
                  <Icon icon={Undo2} size={16} tone="recovery-red-text" />
                  <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-recovery-red-text">{t("import.undo")}</Text>
                </View>
              </Button>
            </View>
          ) : preview ? (
            preview.result.sessions.length > 0 && duplicates >= preview.result.sessions.length ? (
              <View className="gap-2">
                <Button disabled>{t("import.allImported")}</Button>
                <Button variant="outline" onPress={() => void choose()} disabled={busy}>
                  {t("import.again")}
                </Button>
              </View>
            ) : (
              <Button onPress={() => void run()} disabled={busy}>
                {t("import.run")}
              </Button>
            )
          ) : (
            <Button onPress={() => void choose()} disabled={busy}>
              <View className="flex-row items-center gap-2">
                <Icon icon={FileUp} size={16} tone="primary-foreground" />
                <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-primary-foreground">{t("import.pick")}</Text>
              </View>
            </Button>
          )}

          {!done && !!lastUndoable && (
            <Press accessibilityRole="button" onPress={() => setConfirmUndo(lastUndoable)} className="h-11 flex-row items-center justify-center gap-2 rounded-xl">
              <Icon icon={Undo2} size={15} tone="recovery-red-text" />
              <Text className="text-[12px] font-bold uppercase tracking-[0.08em] text-recovery-red-text">{t("import.undoLast")}</Text>
            </Press>
          )}

          <View className="flex-row items-center gap-2">
            <Icon icon={History} size={14} tone="muted-foreground" />
            <Text className="text-[12px] text-muted-foreground">
              {last ? t("import.lastImport", { date: formatDay(new Date(last.importedAt * 1000).toISOString().slice(0, 10), DAY.full) }) : t("import.never")}
            </Text>
          </View>
        </View>
      }
      footer={
        <ConfirmDialog
          open={!!confirmUndo}
          title={t("import.undoTitle")}
          body={t("import.undoBody", { count: confirmUndo?.sessions ?? 0 })}
          confirm={t("import.undo")}
          onCancel={() => setConfirmUndo(null)}
          onConfirm={() => void runUndo()}
        />
      }
    />
  );
}
