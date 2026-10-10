// Nap `/sleep/nap/[id]` (spec §7.4), ported from pulse src/app/(app)/sleep/nap/[id]/page.tsx: the nap on its own, as `/sleep`
// shows the main sleep. Back falls back to that day's Sleep.
import { clock, dayLabel } from "@/lib/format";
import { dayHref } from "@/lib/url";
import { todayOf } from "@/queries/common";
import { getNap } from "@/queries/sleep";
import { SleepStages } from "@/ui/metrics/SleepStages";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { SectionShell } from "@/ui/shells/SectionShell";
import { useScreen } from "../useScreen";
import { NapSkeleton } from "./NapSkeleton";

export function NapScreen({ id }: { id: string }) {
  const { data } = useScreen(async (ctx) => ({ vm: await getNap(ctx, id), today: todayOf(ctx), timeZone: ctx.timeZone }), [id]);
  if (!data) return <NapSkeleton />;
  const { vm, today, timeZone } = data;
  // The web calls notFound(): its default page says this.
  if (!vm) return <DetailShell title="Nap" align="start" primary={<EmptyState body="This page could not be found." />} />;
  return (
    <DetailShell
      title="Nap"
      subtitle={`${dayLabel(vm.day, today)} ${clock(vm.start, timeZone)} to ${clock(vm.end, timeZone)}`}
      align="start"
      backHref={dayHref("/sleep", vm.day, today)}
      primary={
        <SectionShell variant="card" title="Nap">
          <SleepStages hours={vm.hours} hr={vm.hr} data={vm.stages} />
        </SectionShell>
      }
    />
  );
}
