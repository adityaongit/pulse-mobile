// Your data `/more/data` (U21): your daily scores, journal answers and coach chats as CSV or JSON. Ported from pulse
// (app)/more/data/page.tsx and loading.tsx. A download becomes the system share sheet (src/actions/export.ts): Save to
// Files, AirDrop, Drive, mail. The web's Backup card was never in the page; there is nothing else to export or restore here.
import { useState } from "react";
import { View } from "react-native";
import { Download } from "lucide-react-native";
import { type ExportFormat, type ExportKind, shareExport } from "@/actions/export";
import { store } from "@/data/store";
import { DAY, formatDay } from "@/lib/format";
import { getYourData, hasCoachChats } from "@/queries/settings";
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

const grouped = new Intl.NumberFormat("en");

/** A button that opens the share sheet with one export. */
function DownloadLink({ kind, format, busy, setBusy }: { kind: ExportKind; format: ExportFormat; busy: string | null; setBusy: (id: string | null) => void }) {
  const id = `${kind}-${format}`;
  return (
    <Button
      variant="secondary"
      className="flex-1"
      disabled={busy !== null}
      accessibilityLabel={`${kind} ${format.toUpperCase()}`}
      onPress={async () => {
        haptic.tap();
        setBusy(id);
        const r = await shareExport(store, kind, format);
        setBusy(null);
        if (!r.ok) toast.error(r.error);
      }}
    >
      <Icon icon={Download} size={20} tone="secondary-foreground" />
      <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">{busy === id ? "Preparing…" : format.toUpperCase()}</Text>
    </Button>
  );
}

const count = <SkeletonText className="w-16" />;

function Loading() {
  const buttons = (
    <View className="mt-4 flex-row gap-2">
      <Skeleton className="h-11 flex-1 rounded-xl" />
      <Skeleton className="h-11 flex-1 rounded-xl" />
    </View>
  );
  return (
    <DetailShell
      loading
      title="Your data"
      primary={
        <View accessibilityElementsHidden className="w-full gap-3">
          <SectionShell variant="card" title="Daily scores" aside={count}>
            <SkeletonText lh={22} fs={15} className="w-full" />
            <SkeletonText lh={22} fs={15} className="w-full" />
            <SkeletonText lh={22} fs={15} className="w-3/4" />
            {buttons}
          </SectionShell>
          <SectionShell variant="card" title="Journal" aside={count}>
            <Text className={BODY}>Every check-in answer, hidden behaviours included. The JSON also lists your behaviours.</Text>
            {buttons}
          </SectionShell>
        </View>
      }
    />
  );
}

export function YourDataScreen() {
  const { data } = useScreen(async (ctx) => ({ vm: await getYourData(ctx), coach: await hasCoachChats(ctx) }), []);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Loading />;
  const { vm, coach } = data;
  const since = vm.first ? ` since ${formatDay(vm.first, DAY.full)}` : "";
  const link = (kind: ExportKind, format: ExportFormat) => <DownloadLink kind={kind} format={format} busy={busy} setBusy={setBusy} />;

  return (
    <View className="flex-1">
      <DetailShell
        title="Your data"
        primary={
          <View className="w-full gap-3">
            <SectionShell variant="card" title="Daily scores" aside={<Text className={`${CAPTION} tabular-nums`}>{grouped.format(vm.days)}&nbsp;days</Text>}>
              <Text className={BODY}>
                One row per day{since}: Recovery, Strain, sleep performance, hours and consistency, heart rate variability, resting heart rate, respiratory rate, stress and steps.
              </Text>
              <View className="mt-4 flex-row gap-2">
                {link("daily", "csv")}
                {link("daily", "json")}
              </View>
            </SectionShell>

            <SectionShell variant="card" title="Journal" aside={<Text className={`${CAPTION} tabular-nums`}>{grouped.format(vm.answers)}&nbsp;answers</Text>}>
              <Text className={BODY}>Every check-in answer, hidden behaviours included. The JSON also lists your behaviours.</Text>
              <View className="mt-4 flex-row gap-2">
                {link("journal", "csv")}
                {link("journal", "json")}
              </View>
            </SectionShell>

            {coach && (
              <SectionShell variant="card" title="Coach">
                <Text className={BODY}>Every saved coach chat, with the data cards it showed.</Text>
                <View className="mt-4 flex-row">{link("coach", "json")}</View>
              </SectionShell>
            )}

            <Text className={CAPTION}>No export includes your Google access tokens or your AI provider key.</Text>
          </View>
        }
      />
    </View>
  );
}
