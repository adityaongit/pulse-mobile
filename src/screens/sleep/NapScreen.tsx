// Nap `/sleep/nap/[id]` (spec §7.4), ported from pulse src/app/(app)/sleep/nap/[id]/page.tsx: the nap on its own, as `/sleep`
// shows the main sleep. Back falls back to that day's Sleep.
import { useTranslation } from "react-i18next";
import { clock, dayLabel } from "@/lib/format";
import { dayHref } from "@/lib/url";
import { todayOf } from "@/queries/common";
import { getNap } from "@/queries/mobileExtras";
import { SleepStages } from "@/ui/metrics/SleepStages";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { useScreen } from "../useScreen";
import { NAP_BODY_SKELETON, NapSkeleton } from "./NapSkeleton";

export function NapScreen({ id }: { id: string }) {
  const { t } = useTranslation("sleep");
  const { data } = useScreen(async (ctx) => ({ vm: await getNap(id, ctx), today: todayOf(ctx), timeZone: ctx.timeZone }), ["nap", id]);
  if (!data) return <NapSkeleton />;
  const { vm, today, timeZone } = data;
  // The web calls notFound(): its default page says this.
  if (!vm) return <DetailShell title={t("nap.title")} align="start" primary={<EmptyState body={t("nap.notFound")} />} />;
  return (
    <DetailShell
      title={t("nap.title")}
      bodySkeleton={NAP_BODY_SKELETON}
      subtitle={t("nap.when", { day: dayLabel(vm.day, today), start: clock(vm.start, timeZone), end: clock(vm.end, timeZone) })}
      align="start"
      backHref={dayHref("/sleep", vm.day, today)}
      primary={
        <SectionShell variant="card" title={t("nap.title")}>
          <SleepStages hours={vm.hours} hr={vm.hr} data={vm.stages} />
        </SectionShell>
      }
    />
  );
}
