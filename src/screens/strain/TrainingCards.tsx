// Version 19's training cards, from halo src/screens/detail/TrainingCards.tsx (its fields and copy) drawn with Pulse's
// kit: Training Readiness with Recovery Time and Training Status (Strain), and a workout's Aerobic Training Effect
// (Activity). Plain views only: a value, a band word, rows and ZoneBars-style meters; nothing animates.
import type { ReactNode } from "react";
import { View } from "react-native";
import { Activity, BedDouble, Brain, Gauge, Moon, Timer, type LucideIcon } from "lucide-react-native";
import type { ReadinessFactorKey } from "@/core/algorithms/trainingReadiness";
import type { ChipTone } from "@/lib/bands";
import { clock, formatValue, MISSING } from "@/lib/format";
import type { Metric } from "@/lib/reasons";
import { getTraining, type TrainingEffectVM, type TrainingVM } from "@/queries/training";
import { cn } from "@/ui/cn";
import { Divided } from "@/ui/Divided";
import { Icon } from "@/ui/Icon";
import { Bar } from "@/screens/goals/parts";
import { CAPTION, LABEL, ValueUnit } from "@/ui/metrics/primitives";
import { ReasonPlaceholder } from "@/ui/metrics/ReasonPlaceholder";
import { MetricState } from "@/ui/shells/MetricState";
import { SectionShell } from "@/ui/shells/SectionShell";
import type { InfoContent } from "@/ui/shells/InfoButton";
import { Skeleton } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import type { TokenName } from "@/ui/palette";
import { useTheme } from "@/ui/theme";
import { useScreen } from "../useScreen";

function P({ children }: { children: ReactNode }) {
  return <Text className="text-[15px] leading-[22px] text-foreground-body">{children}</Text>;
}
export const SOURCE_NOTE = <Text className="text-[13px] leading-[18px] text-muted-foreground">Pulse scores, computed from your Fitbit data.</Text>;

/** A meter stays quiet unless it flags something: only a weak value (warning, alert) takes a colour. */
const TONE_FILL: Record<ChipTone, TokenName> = { optimal: "foreground-secondary", warning: "warning", alert: "recovery-red", neutral: "foreground-secondary" };
/** The score heroes' number (Health's Fitness and Heart rate cards), in the foreground colour. */
export const HERO = "font-numeric text-4xl font-bold leading-10 tracking-[-0.01em]";
export const LINE = "text-[15px] leading-[22px] text-foreground-secondary";
/** A band or status word in caps, in secondary ink (the PWA's Fitness card category). */
const BAND = cn(LABEL, "text-foreground-secondary");

/** A quiet meter, ZoneBars' bar: `frac` of a hatched track. */
function Meter({ frac, tone }: { frac: number; tone: ChipTone }) {
  const { c } = useTheme();
  return <Bar value={frac} color={c[TONE_FILL[tone]]} />;
}

/** A score hero (Health's Fitness card): the number and its unit, the band word in caps under it, then a grey caption. */
export function Hero({ value, unit, band, caption, spoken }: { value: string; unit?: string; band: string; caption?: string | null; spoken: string }) {
  return (
    <View accessible accessibilityLabel={spoken} className="gap-1">
      <ValueUnit value={value} unit={unit} className={HERO} />
      <Text className={BAND}>{band}</Text>
      {!!caption && <Text className={cn(CAPTION, "tabular-nums")}>{caption}</Text>}
    </View>
  );
}

/**
 * KeyStatRow's "row" for a value that is not a plain metric: an optional icon, the caps label with a grey caption, and
 * the value on the right in the display font (`word`: a word in body type). Put rows in <Divided>.
 */
export function StatRow({
  icon,
  label,
  caption,
  value,
  unit,
  spoken,
  word,
}: {
  icon?: ReactNode;
  label: string;
  caption?: string | null;
  value: string;
  unit?: string;
  spoken: string;
  word?: boolean;
}) {
  const missing = value === MISSING;
  return (
    <View accessible accessibilityLabel={spoken} className="min-h-14 flex-row items-center gap-3 py-2">
      {!!icon && <View className="size-5 shrink-0 items-center justify-center">{icon}</View>}
      <View className="min-w-0 flex-1">
        <Text className={LABEL}>{label}</Text>
        {!!caption && <Text className={cn(CAPTION, "mt-0.5")}>{caption}</Text>}
      </View>
      {word ? (
        <Text className={cn("max-w-[50%] text-right text-base font-semibold leading-6", missing && "text-muted-foreground")}>{value}</Text>
      ) : (
        <ValueUnit value={value} unit={unit} className={cn("shrink-0 font-numeric text-xl font-bold leading-6", missing && "text-muted-foreground")} />
      )}
    </View>
  );
}

export const TRAINING_READINESS_INFO: InfoContent = {
  title: "Training Readiness",
  body: (
    <>
      <P>
        How ready you are for hard training today, from 1 to 100, in the manner of Garmin’s Training Readiness. Last night’s sleep and your recovery time weigh
        most (a quarter each), then your HRV status and load ratio, then your sleep over the last 3 nights and your stress over the last 3 days. One very weak
        factor caps the score, and a very long day awake before last night takes 10 off.
      </P>
      <P>95-100 Prime, 75-94 High, 50-74 Moderate, 25-49 Low, 1-24 Poor. It is set at wake and drops after training as recovery time builds.</P>
      <P>
        Recovery time is how long until you are ready for another hard session: each workout adds hours from its Training Effect (about a day at 3.5, three at
        5), up to 96. It counts down faster during good sleep and slower in stressful hours or after a poor night.
      </P>
      <P>Garmin doesn’t publish its weights; these are Pulse’s.</P>
      {SOURCE_NOTE}
    </>
  ),
};

export const TRAINING_STATUS_INFO: InfoContent = {
  title: "Training Status",
  body: (
    <>
      <P>
        What your recent training is doing, in the manner of Garmin’s Training Status: from your load ratio (Garmin’s acute against chronic load), the trend of
        Fitbit’s VO2 max over 28 days, and your HRV Status.
      </P>
      <P>
        Productive: load at your usual or above, with VO2 max rising or HRV steady. Maintaining: enough to hold fitness. Recovery: a lighter stretch. Peaking:
        fitness up while load eases. Unproductive: steady load but VO2 max falling. Overreaching: very high load that is starting to cost you. Strained: HRV low
        under load. Detraining: far below your usual load for a week.
      </P>
      <P>Fitbit’s VO2 max moves slowly, so the trend is read over 28 days, not Garmin’s 14. Needs about 3 weeks of data, and a VO2 max or an HRV Status.</P>
      {SOURCE_NOTE}
    </>
  ),
};

export const TRAINING_EFFECT_INFO: InfoContent = {
  title: "Training Effect",
  body: (
    <>
      <P>
        How much this workout improves your aerobic fitness, from 0 to 5, in the manner of Garmin’s Aerobic Training Effect. Pulse estimates the session’s EPOC
        (the extra oxygen your body uses afterwards to recover) from your heart rate and VO2 max, and compares it with what your fitness and recent training make
        routine: the same run counts for less the fitter and busier you are.
      </P>
      <P>0-0.9 No benefit, 1-1.9 Minor, 2-2.9 Maintaining, 3-3.9 Improving, 4-4.9 Highly improving, 5 Overreaching.</P>
      <P>
        Garmin estimates EPOC with beat-to-beat data and constants it doesn’t publish; Pulse’s comes from heart rate alone, fitted to Firstbeat’s published
        figures. There is no anaerobic Training Effect: it needs pace or power.
      </P>
      {SOURCE_NOTE}
    </>
  ),
};

/** "13 h" / "1 h 30 min" for recovery hours. */
export const hoursText = (h: number) => {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min === 60 ? `${whole + 1} h` : min ? `${whole} h ${min} min` : `${whole} h`;
};

const FACTOR_ICON: Record<ReadinessFactorKey, LucideIcon> = { sleep: Moon, recoveryTime: Timer, hrv: Activity, load: Gauge, sleepHistory: BedDouble, stressHistory: Brain };
const cardSkeleton = <Skeleton className="h-40 w-full rounded-lg" />;

function ReadinessBody({ vm, timeZone }: { vm: TrainingVM; timeZone: string }) {
  const rt = vm.recoveryTime.value;
  return (
    <MetricState
      metric={vm.readiness}
      skeleton={cardSkeleton}
      renderReason={(r, meta) => <ReasonPlaceholder reason={r} nightsLeft={meta.nightsLeft} size="md" copy={r === "calibrating" ? "Training Readiness needs a scored night and about 3 weeks of training data." : undefined} />}
    >
      {(r) => (
        <View className="gap-4">
          <View className="gap-3">
            <Hero
              value={String(r.score)}
              unit="of 100"
              band={r.band}
              caption={vm.isToday && r.atWake !== null && r.atWake !== r.score ? `At wake ${r.atWake}` : null}
              spoken={`Training Readiness ${r.score} of 100, ${r.band}`}
            />
            <Text className={LINE}>{r.line}</Text>
          </View>
          <Divided>
            {rt && (
              <StatRow
                icon={<Icon icon={Timer} size={20} tone="muted-foreground" strokeWidth={1.75} />}
                label="Recovery time"
                caption={
                  rt.hours <= 0
                    ? "Recovered"
                    : rt.readyAt !== null && vm.isToday
                    ? `Ready for hard training around ${clock(rt.readyAt, timeZone)}${rt.hours >= 24 ? ` in ${Math.round(rt.hours / 24)} day${Math.round(rt.hours / 24) === 1 ? "" : "s"}` : ""}`
                    : null
                }
                value={hoursText(rt.hours)}
                spoken={rt.hours > 0 ? `Recovery time ${hoursText(rt.hours)}` : "Recovery time: fully recovered"}
              />
            )}
            {/* WHOOP's contributor rows (strain-02): icon, caps label, the value on the right. */}
            {r.factors.map((f) => (
              <StatRow
                key={f.key}
                icon={<Icon icon={FACTOR_ICON[f.key]} size={20} tone="muted-foreground" strokeWidth={1.75} />}
                label={f.label}
                value={f.value === null ? MISSING : String(f.value)}
                spoken={`${f.label}: ${f.value === null ? "not available" : `${f.value} of 100`}`}
              />
            ))}
          </Divided>
        </View>
      )}
    </MetricState>
  );
}

function StatusBody({ status }: { status: TrainingVM["status"] }) {
  return (
    <MetricState
      metric={status}
      skeleton={cardSkeleton}
      renderReason={(r, meta) => (
        <ReasonPlaceholder
          reason={r}
          nightsLeft={meta.nightsLeft}
          size="md"
          copy={r === "calibrating" ? "Training Status needs about 3 weeks of training data." : r === "no_data" ? "Training Status needs a VO2 max from Fitbit or an HRV Status." : undefined}
        />
      )}
    >
      {(s) => (
        <View className="gap-3">
          <View className="gap-2">
            <Text className={BAND}>{s.status}</Text>
            <Text className={LINE}>{s.line}</Text>
          </View>
          <Divided>
            <StatRow label="Load ratio" value={formatValue("decimal2", s.loadRatio)} spoken={`Load ratio ${s.loadRatio ?? "not available"}`} />
            <StatRow
              label="VO2 max trend"
              value={s.vo2PerMonth === null ? MISSING : `${s.vo2PerMonth > 0 ? "+" : ""}${formatValue("decimal1", s.vo2PerMonth)}`}
              unit="a month"
              spoken={s.vo2PerMonth === null ? "VO2 max trend not available" : `VO2 max trend ${s.vo2PerMonth} a month`}
            />
            <StatRow label="HRV status" value={s.hrv ?? "Not yet"} word spoken={`HRV status ${s.hrv ?? "not yet"}`} />
          </Divided>
        </View>
      )}
    </MetricState>
  );
}

/** Strain's two training cards for day `d`, loaded on their own so the page's query is unchanged. */
export function TrainingSection({ d, timeZone }: { d: string; timeZone: string }) {
  const vm = useScreen((ctx) => getTraining(d, ctx), ["training", d]).data;
  return (
    <View className="gap-4">
      <SectionShell variant="card" title="Training Readiness" info={TRAINING_READINESS_INFO}>
        {vm ? <ReadinessBody vm={vm} timeZone={timeZone} /> : cardSkeleton}
      </SectionShell>
      <SectionShell variant="card" title="Training Status" info={TRAINING_STATUS_INFO}>
        {vm ? <StatusBody status={vm.status} /> : cardSkeleton}
      </SectionShell>
    </View>
  );
}

/** A workout's Aerobic Training Effect, its main benefit and the recovery time it added (Activity). */
export function TrainingEffectCard({ te }: { te: TrainingEffectVM | null }) {
  const metric: Metric<TrainingEffectVM> = te ? { value: te, reason: null, provisional: false } : { value: null, reason: "insufficient_hr_data", provisional: false };
  return (
    <SectionShell variant="card" title="Training effect" info={TRAINING_EFFECT_INFO}>
      <MetricState metric={metric} skeleton={null}>
        {(t) => (
          <View className="gap-3">
            <View className="gap-3">
              <Hero value={formatValue("decimal1", t.te)} unit="of 5" band={t.label} spoken={`Aerobic Training Effect ${formatValue("decimal1", t.te)} of 5, ${t.label}`} />
              <Meter frac={t.te / 5} tone={t.tone} />
            </View>
            <Divided>
              <StatRow label="Main benefit" caption={t.benefitLine} value={t.benefit} word spoken={`Main benefit ${t.benefit}. ${t.benefitLine}`} />
              {t.recoveryHours > 0 && (
                <StatRow
                  icon={<Icon icon={Timer} size={20} tone="muted-foreground" strokeWidth={1.75} />}
                  label="Adds recovery time"
                  value={hoursText(t.recoveryHours)}
                  spoken={`Adds ${hoursText(t.recoveryHours)} of recovery time`}
                />
              )}
            </Divided>
          </View>
        )}
      </MetricState>
    </SectionShell>
  );
}
