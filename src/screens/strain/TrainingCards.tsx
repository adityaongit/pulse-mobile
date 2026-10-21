// Version 19's training cards, from halo src/screens/detail/TrainingCards.tsx (its fields and copy) drawn with Pulse's
// kit: Training Readiness with Recovery Time and Training Status (Strain), and a workout's Aerobic Training Effect
// (Activity). Plain views only: a value, a band word, rows and ZoneBars-style meters; nothing animates.
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Activity, BedDouble, Brain, Gauge, Moon, Timer, type LucideIcon } from "lucide-react-native";
import { i18n } from "@/i18n/config";
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
function SourceNote() {
  const { t } = useTranslation("strain");
  return <Text className="text-[13px] leading-[18px] text-muted-foreground">{t("sourceNote")}</Text>;
}
export const SOURCE_NOTE = <SourceNote />;

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

const trainingReadinessInfo = (): InfoContent => ({
  title: i18n.t("strain:training.readiness"),
  body: (
    <>
      <P>{i18n.t("strain:trainingInfo.readinessP1")}</P>
      <P>{i18n.t("strain:trainingInfo.readinessP2")}</P>
      <P>{i18n.t("strain:trainingInfo.readinessP3")}</P>
      <P>{i18n.t("strain:trainingInfo.readinessP4")}</P>
      {SOURCE_NOTE}
    </>
  ),
});

const trainingStatusInfo = (): InfoContent => ({
  title: i18n.t("strain:training.status"),
  body: (
    <>
      <P>{i18n.t("strain:trainingInfo.statusP1")}</P>
      <P>{i18n.t("strain:trainingInfo.statusP2")}</P>
      <P>{i18n.t("strain:trainingInfo.statusP3")}</P>
      {SOURCE_NOTE}
    </>
  ),
});

const trainingEffectInfo = (): InfoContent => ({
  title: i18n.t("strain:training.effect"),
  body: (
    <>
      <P>{i18n.t("strain:trainingInfo.effectP1")}</P>
      <P>{i18n.t("strain:trainingInfo.effectP2")}</P>
      <P>{i18n.t("strain:trainingInfo.effectP3")}</P>
      {SOURCE_NOTE}
    </>
  ),
});

/** "13 h" / "1 h 30 min" for recovery hours. */
export const hoursText = (h: number) => {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min === 60 ? i18n.t("strain:hours.whole", { h: whole + 1 }) : min ? i18n.t("strain:hours.wholeMin", { h: whole, min }) : i18n.t("strain:hours.whole", { h: whole });
};

const FACTOR_ICON: Record<ReadinessFactorKey, LucideIcon> = { sleep: Moon, recoveryTime: Timer, hrv: Activity, load: Gauge, sleepHistory: BedDouble, stressHistory: Brain };
const cardSkeleton = <Skeleton className="h-40 w-full rounded-lg" />;

function ReadinessBody({ vm, timeZone }: { vm: TrainingVM; timeZone: string }) {
  const { t } = useTranslation("strain");
  const rt = vm.recoveryTime.value;
  const days = rt ? Math.round(rt.hours / 24) : 0;
  const time = rt?.readyAt != null ? clock(rt.readyAt, timeZone) : "";
  return (
    <MetricState
      metric={vm.readiness}
      skeleton={cardSkeleton}
      renderReason={(r, meta) => <ReasonPlaceholder reason={r} nightsLeft={meta.nightsLeft} size="md" copy={r === "calibrating" ? t("readiness.calibrating") : undefined} />}
    >
      {(r) => (
        <View className="gap-4">
          <View className="gap-3">
            <Hero
              value={String(r.score)}
              unit={t("training.ofHundred")}
              band={r.band}
              caption={vm.isToday && r.atWake !== null && r.atWake !== r.score ? t("readiness.atWake", { score: r.atWake }) : null}
              spoken={t("readiness.spoken", { score: r.score, band: r.band })}
            />
            <Text className={LINE}>{r.line}</Text>
          </View>
          <Divided>
            {rt && (
              <StatRow
                icon={<Icon icon={Timer} size={20} tone="muted-foreground" strokeWidth={1.75} />}
                label={t("readiness.recoveryTime")}
                caption={
                  rt.hours <= 0
                    ? t("readiness.recovered")
                    : rt.readyAt !== null && vm.isToday
                    ? rt.hours >= 24
                      ? t("readiness.readyAroundDays", { time, count: days })
                      : t("readiness.readyAround", { time })
                    : null
                }
                value={hoursText(rt.hours)}
                spoken={rt.hours > 0 ? t("readiness.spokenRecoveryTime", { time: hoursText(rt.hours) }) : t("readiness.spokenRecovered")}
              />
            )}
            {/* WHOOP's contributor rows (strain-02): icon, caps label, the value on the right. */}
            {r.factors.map((f) => (
              <StatRow
                key={f.key}
                icon={<Icon icon={FACTOR_ICON[f.key]} size={20} tone="muted-foreground" strokeWidth={1.75} />}
                label={f.label}
                value={f.value === null ? MISSING : String(f.value)}
                spoken={f.value === null ? t("readiness.spokenFactorNone", { label: f.label }) : t("readiness.spokenFactor", { label: f.label, value: f.value })}
              />
            ))}
          </Divided>
        </View>
      )}
    </MetricState>
  );
}

function StatusBody({ status }: { status: TrainingVM["status"] }) {
  const { t } = useTranslation("strain");
  return (
    <MetricState
      metric={status}
      skeleton={cardSkeleton}
      renderReason={(r, meta) => (
        <ReasonPlaceholder
          reason={r}
          nightsLeft={meta.nightsLeft}
          size="md"
          copy={r === "calibrating" ? t("status.calibrating") : r === "no_data" ? t("status.noData") : undefined}
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
            <StatRow
              label={t("status.loadRatio")}
              value={formatValue("decimal2", s.loadRatio)}
              spoken={s.loadRatio === null ? t("status.spokenLoadNone") : t("status.spokenLoad", { value: s.loadRatio })}
            />
            <StatRow
              label={t("status.vo2Trend")}
              value={s.vo2PerMonth === null ? MISSING : `${s.vo2PerMonth > 0 ? "+" : ""}${formatValue("decimal1", s.vo2PerMonth)}`}
              unit={t("status.aMonth")}
              spoken={s.vo2PerMonth === null ? t("status.spokenVo2None") : t("status.spokenVo2", { value: s.vo2PerMonth })}
            />
            <StatRow
              label={t("status.hrv")}
              value={s.hrv ?? t("status.notYet")}
              word
              spoken={s.hrv === null ? t("status.spokenHrvNone") : t("status.spokenHrv", { value: s.hrv })}
            />
          </Divided>
        </View>
      )}
    </MetricState>
  );
}

/** Strain's two training cards for day `d`, loaded on their own so the page's query is unchanged. */
export function TrainingSection({ d, timeZone }: { d: string; timeZone: string }) {
  const { t } = useTranslation("strain");
  const vm = useScreen((ctx) => getTraining(d, ctx), ["training", d]).data;
  return (
    <View className="gap-4">
      <SectionShell variant="card" title={t("training.readiness")} info={trainingReadinessInfo()}>
        {vm ? <ReadinessBody vm={vm} timeZone={timeZone} /> : cardSkeleton}
      </SectionShell>
      <SectionShell variant="card" title={t("training.status")} info={trainingStatusInfo()}>
        {vm ? <StatusBody status={vm.status} /> : cardSkeleton}
      </SectionShell>
    </View>
  );
}

/** A workout's Aerobic Training Effect, its main benefit and the recovery time it added (Activity). */
export function TrainingEffectCard({ te }: { te: TrainingEffectVM | null }) {
  const { t } = useTranslation("strain");
  const metric: Metric<TrainingEffectVM> = te ? { value: te, reason: null, provisional: false } : { value: null, reason: "insufficient_hr_data", provisional: false };
  return (
    <SectionShell variant="card" title={t("training.effect")} info={trainingEffectInfo()}>
      <MetricState metric={metric} skeleton={null}>
        {(e) => (
          <View className="gap-3">
            <View className="gap-3">
              <Hero value={formatValue("decimal1", e.te)} unit={t("training.ofFive")} band={e.label} spoken={t("effect.spoken", { value: formatValue("decimal1", e.te), label: e.label })} />
              <Meter frac={e.te / 5} tone={e.tone} />
            </View>
            <Divided>
              <StatRow label={t("effect.mainBenefit")} caption={e.benefitLine} value={e.benefit} word spoken={t("effect.spokenBenefit", { benefit: e.benefit, line: e.benefitLine })} />
              {e.recoveryHours > 0 && (
                <StatRow
                  icon={<Icon icon={Timer} size={20} tone="muted-foreground" strokeWidth={1.75} />}
                  label={t("effect.addsRecovery")}
                  value={hoursText(e.recoveryHours)}
                  spoken={t("effect.spokenAdds", { time: hoursText(e.recoveryHours) })}
                />
              )}
            </Divided>
          </View>
        )}
      </MetricState>
    </SectionShell>
  );
}
