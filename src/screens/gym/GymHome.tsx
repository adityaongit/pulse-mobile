// The gym tab `/gym`: the owner's templates in their saved order, the split's next one first, the workout in progress
// above them, then the last sessions and the week's totals. Tapping a template starts it; "Start empty" starts a blank
// one. Swipe a template right to start it, left to edit or delete it; hold it to reorder.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useIsFocused } from "expo-router";
import { ChevronRight, Dumbbell, Play, Plus, Search, Trophy } from "lucide-react-native";
import { actionCtx, dataChanged } from "@/state/app";
import { deleteRoutine as removeRoutine, reorderRoutines, startSession } from "@/actions/gym";
import { loadText, toUnit } from "@/core/gym/load";
import type { GymHomeVM } from "@/queries/gym";
import { getGymHome, getGymSession } from "@/queries/gym";
import { prefetch, useScreen } from "@/screens/useScreen";
import { Button } from "@/ui/Button";
import { CARD_CLASS, Card, CardFill, useCardStyle } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { PageShell } from "@/ui/shells/PageShell";
import { push } from "@/ui/navigate";
import { toast } from "@/ui/Toast";
import { Block, ConfirmDialog, GymEmpty, HeaderAction, SessionRow, StatTile, TemplateCard, clockText, lengthText, useNow, volumeText } from "./parts";
import { GymSkeleton } from "./GymSkeleton";
import { ReorderSheet } from "./ReorderSheet";
import { QueryError } from "@/ui/shells/QueryError";

export function GymHome() {
  const { t } = useTranslation("gym");
  const { data, error, reload } = useScreen(getGymHome, ["gym-home"]);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [reordering, setReordering] = useState(false);
  const active = data?.active;

  // The workout page starts its read on the tap, in parallel with the slide, so its sets are there when it lands.
  const sessionKey = (id: string) => ["gym-session", id] as const;
  const preloadSession = (id: string) => prefetch((ctx) => getGymSession(ctx, id), sessionKey(id));
  const openSession = (id: string) => {
    void preloadSession(id);
    push(`/gym/session/${id}`);
  };

  const start = async (routineId?: string) => {
    if (pending) return;
    if (data?.active) {
      // One workout at a time: a tap on a template while one runs says so and opens the one already going.
      toast.info(t("home.alreadyActive"));
      openSession(data.active.session.id);
      return;
    }
    setPending(true);
    // No try/finally: the React Compiler skips a component that has one, and the whole tab would render on every change.
    const res = await startSession(actionCtx(), routineId ? { routineId } : {}).catch(() => null);
    setPending(false);
    if (!res || !res.ok) return;
    dataChanged("gym");
    void preloadSession(res.data.session.id);
    push(`/gym/session/${res.data.session.id}`);
  };

  return (
    <PageShell
      title={t("tab")}
      loading={!data}
      actions={
        <Press accessibilityRole="button" accessibilityLabel={t("home.search")} activeBg="bg-fill-hover" onPress={() => push("/gym/exercises")} className="h-13 w-full flex-row items-center gap-2 rounded-xl bg-field px-3">
          <Icon icon={Search} size={18} tone="muted-foreground" />
          <Text className="text-[15px] text-muted-foreground">{t("home.searchHint")}</Text>
        </Press>
      }
    >
      {!data ? (
        error ? <QueryError compact error={error} reload={reload} /> : <GymSkeleton />
      ) : (
        <>
          {active && <ResumeCard active={active} onPress={() => openSession(active.session.id)} />}

          {!active && (
            <Button onPress={() => void start()} disabled={pending}>
              {t("home.startEmpty")}
            </Button>
          )}

          <Block
            title={t("home.templates", { count: data.routines.length })}
            action={
              data.routines.length > 0 ? (
                <HeaderAction icon={Plus} label={t("home.newTemplate")} onPress={() => push("/gym/routine/new")} />
              ) : undefined
            }
          >
            {data.routines.length ? (
              <View className="gap-3">
                {data.routines.map((card) => (
                  <TemplateCard
                    key={card.routine.id}
                    card={card}
                    next={card.routine.id === data.nextId}
                    onStart={() => void start(card.routine.id)}
                    onEdit={() => push(`/gym/routine/${card.routine.id}`)}
                    onDelete={() => setRemoving({ id: card.routine.id, name: card.routine.name })}
                    onReorder={() => setReordering(true)}
                  />
                ))}
              </View>
            ) : (
              <GymEmpty icon={Dumbbell} title={t("home.emptyTemplates")} body={t("home.emptyTemplatesBody")}>
                <Button variant="secondary" className="mt-2" onPress={() => push("/gym/routine/new")}>
                  {t("home.newTemplate")}
                </Button>
              </GymEmpty>
            )}
          </Block>

          {data.recent.length > 0 && (
            <Block
              title={t("home.recent")}
              action={
                <HeaderAction label={t("home.seeAll")} onPress={() => push("/gym/history")} />
              }
            >
              <Card className="px-3 py-1">
                <CardFill />
                {data.recent.map((card, i) => (
                  <View key={card.id} className={i > 0 ? "border-t border-border" : undefined}>
                    <SessionRow card={card} onPress={() => openSession(card.id)} />
                  </View>
                ))}
              </Card>
            </Block>
          )}

          {data.week.sessions > 0 && (
            <Block title={t("home.week")}>
              <View className="gap-3">
                <View className="flex-row gap-3">
                  <StatTile label={t("home.workouts")} value={String(data.week.sessions)} />
                  <StatTile label={t("home.sets")} value={String(data.week.sets)} />
                </View>
                <View className="flex-row gap-3">
                  <StatTile label={t("home.volume")} value={volumeText(data.week.volumeKg, data.week.unit)} />
                  <StatTile label={t("home.time")} value={lengthText(data.week.seconds)} />
                </View>
              </View>
            </Block>
          )}

          {data.records.length > 0 && (
            <Block
              title={t("home.records")}
              action={
                <HeaderAction label={t("home.seeAll")} onPress={() => push("/gym/records")} />
              }
            >
              <Card className="px-3 py-1">
                <CardFill />
                {data.records.map((r, i) => (
                  <View key={r.exercise.id} className={i > 0 ? "border-t border-border" : undefined}>
                    <Press
                      accessibilityRole="link"
                      activeBg="bg-fill-hover"
                      onPress={() => push(`/gym/exercise/${r.exercise.id}`)}
                      className="flex-row items-center gap-3 rounded-xl py-3"
                    >
                      <Icon icon={Trophy} size={16} tone="muted-foreground" />
                      <View className="min-w-0 flex-1">
                        <Text className="text-[15px] font-semibold leading-5" numberOfLines={1}>
                          {r.exercise.name}
                        </Text>
                        <Text className="font-numeric text-[12px] leading-4 text-muted-foreground">
                          {`${loadText(r.record.weightKg, r.exercise.unit)} ${r.exercise.unit} × ${r.record.reps}`}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-[11px] font-semibold uppercase leading-4 tracking-[0.1em] text-muted-foreground">
                          {t("records.oneRm")}
                        </Text>
                        <Text className="font-numeric text-[15px] font-medium leading-5">
                          {`${(Math.round(toUnit(r.record.oneRm, r.exercise.unit) * 10) / 10).toFixed(1)} ${r.exercise.unit}`}
                        </Text>
                      </View>
                      <Icon icon={ChevronRight} size={16} tone="muted-foreground" />
                    </Press>
                  </View>
                ))}
              </Card>
            </Block>
          )}

        </>
      )}

      <ConfirmDialog
        open={!!removing}
        title={t("routine.deleteTitle")}
        body={t("routine.deleteBody")}
        confirm={t("routine.delete")}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await removeRoutine(actionCtx().store, removing.id);
          setRemoving(null);
          dataChanged("gym");
        }}
      />
      <ReorderSheet
        open={reordering}
        title={t("reorder.templates")}
        items={(data?.routines ?? []).map((card) => ({ id: card.routine.id, label: card.routine.name, meta: t("card.exercises", { count: card.items.length }) }))}
        onClose={() => setReordering(false)}
        onDone={(ordered) => {
          setReordering(false);
          void reorderRoutines(actionCtx().store, ordered, Math.floor(Date.now() / 1000)).then(() => dataChanged("gym"));
        }}
      />
    </PageShell>
  );
}

/**
 * The workout in progress. Its clock is its own leaf, and it ticks only while the tab is in front: the tab stays
 * mounted under a pushed workout page, and a timer there must not re-render this page once a second behind it.
 */
function ResumeCard({ active, onPress }: { active: NonNullable<GymHomeVM["active"]>; onPress: () => void }) {
  const { t } = useTranslation("gym");
  const focused = useIsFocused();
  const now = useNow(focused);
  const cardStyle = useCardStyle();
  const elapsed = now - active.session.startTs;
  return (
    <Press activeScale={0.98} accessibilityRole="button" onPress={onPress} className={cn(CARD_CLASS, "px-4 py-4")} style={cardStyle}>
      <CardFill />
      <View className="flex-row items-center gap-3">
        <View className="size-9 items-center justify-center rounded-full bg-secondary">
          <Icon icon={Play} size={16} tone="strain-text" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[11px] font-bold uppercase leading-4 tracking-[0.1em] text-strain-text">{t("home.inProgress")}</Text>
          <Text className="text-[17px] font-semibold leading-[22px]" numberOfLines={1}>
            {active.session.name}
          </Text>
          <Text className="font-numeric text-[12px] leading-4 tabular-nums text-muted-foreground">
            {t("home.resumeSub", { done: active.done, total: active.setCount })} · {clockText(elapsed)}
          </Text>
        </View>
        <Icon icon={ChevronRight} size={18} tone="muted-foreground" />
      </View>
    </Press>
  );
}
