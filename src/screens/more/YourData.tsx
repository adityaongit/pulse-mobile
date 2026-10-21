// Your data `/more/data` (U21): your daily scores and journal answers as CSV or JSON. Ported from pulse
// (app)/more/data/page.tsx and loading.tsx. A download becomes the system share sheet (src/actions/export.ts): Save to
// Files, AirDrop, Drive, mail. The web's Backup card was never in the page; there is nothing else to export or restore here.
import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react-native";
import { type ExportFormat, type ExportKind, shareExport } from "@/actions/export";
import { DAY, FORMATS, formatDay } from "@/lib/format";
import { getYourData } from "@/queries/settings";
import { queryCtx } from "@/state/app";
import { Button } from "@/ui/Button";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { CAPTION } from "@/ui/metrics/primitives";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { BODY } from "../settings/controls";
import { toast } from "@/ui/Toast";
import { useScreen } from "../useScreen";

/** A button that opens the share sheet with one export. */
function DownloadLink({ kind, format, busy, setBusy }: { kind: ExportKind; format: ExportFormat; busy: string | null; setBusy: (id: string | null) => void }) {
  const { t } = useTranslation("more");
  const id = `${kind}-${format}`;
  return (
    <Button
      variant="secondary"
      className="flex-1"
      disabled={busy !== null}
      accessibilityLabel={t("data.exportLabel", { kind, format: format.toUpperCase() })}
      onPress={async () => {
        haptic.tap();
        setBusy(id);
        const r = await shareExport(queryCtx(), kind, format);
        setBusy(null);
        if (!r.ok) toast.error(r.error);
      }}
    >
      <Icon icon={Download} size={20} tone="secondary-foreground" />
      <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">{busy === id ? t("data.preparing") : format.toUpperCase()}</Text>
    </Button>
  );
}

const count = <SkeletonText className="w-16" />;
const buttons = (
  <View className="mt-4 flex-row gap-2">
    <Skeleton className="h-11 flex-1 rounded-xl" />
    <Skeleton className="h-11 flex-1 rounded-xl" />
  </View>
);

function LoadingPrimary() {
  const { t } = useTranslation("more");
  return (
  <View accessibilityElementsHidden className="w-full gap-3">
    <SectionShell variant="card" title={t("data.dailyScores")} info={false} aside={count}>
      <SkeletonText lh={22} fs={15} className="w-full" />
      <SkeletonText lh={22} fs={15} className="w-full" />
      <SkeletonText lh={22} fs={15} className="w-3/4" />
      {buttons}
    </SectionShell>
    <SectionShell variant="card" title={t("data.journal")} info={false} aside={count}>
      <Text className={BODY}>{t("data.journalBody")}</Text>
      {buttons}
    </SectionShell>
  </View>
  );
}

function Loading() {
  const { t } = useTranslation("more");
  return (
    <DetailShell
      loading
      title={t("data.title")}
      primary={<LoadingPrimary />}
      bodySkeleton={<LoadingPrimary />}
    />
  );
}

/** Megabytes as Android's storage settings count them (powers of ten). */
const BYTES_PER_MB = 1_000_000;

export function YourDataScreen() {
  const { t } = useTranslation("more");
  const { data } = useScreen(async (ctx) => ({ vm: await getYourData(ctx) }), ["yourData"]);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Loading />;
  const { vm } = data;
  const link = (kind: ExportKind, format: ExportFormat) => <DownloadLink kind={kind} format={format} busy={busy} setBusy={setBusy} />;

  return (
    <View className="flex-1">
      <DetailShell
        title={t("data.title")}
        bodySkeleton={<LoadingPrimary />}
        primary={
          <View className="w-full gap-3">
            <SectionShell variant="card" title={t("data.dailyScores")} info={false} aside={<Text className={`${CAPTION} tabular-nums`}>{t("data.days", { count: vm.days, formatted: FORMATS.grouped(vm.days) })}</Text>}>
              <Text className={BODY}>
                {vm.first ? t("data.dailyBodySince", { date: formatDay(vm.first, DAY.full) }) : t("data.dailyBody")}
              </Text>
              <View className="mt-4 flex-row gap-2">
                {link("daily", "csv")}
                {link("daily", "json")}
              </View>
            </SectionShell>

            <SectionShell variant="card" title={t("data.journal")} info={false} aside={<Text className={`${CAPTION} tabular-nums`}>{t("data.answers", { count: vm.answers, formatted: FORMATS.grouped(vm.answers) })}</Text>}>
              <Text className={BODY}>{t("data.journalBody")}</Text>
              <View className="mt-4 flex-row gap-2">
                {link("journal", "csv")}
                {link("journal", "json")}
              </View>
            </SectionShell>

            <Text className={CAPTION}>
              {vm.storageBytes === null
                ? t("data.storageNone")
                : t("data.storage", { mb: FORMATS.decimal1(vm.storageBytes / BYTES_PER_MB) })}
            </Text>
          </View>
        }
      />
    </View>
  );
}
