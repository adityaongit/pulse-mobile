// The tracking screen `/gym/session/[id]`: Strong's workout page. One card per exercise, a row per set with the last
// time's numbers beside the weight and reps, a tick at the end of each row, and (when a session still carries one) the
// rest timer floating above the list. Every tick and every edit is its own write, so a killed app comes back to the
// same workout.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useLocalSearchParams, useIsFocused } from "expo-router";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Clock, Dumbbell, History, MoreHorizontal, NotebookPen, Pencil, Plus, Scale, SkipForward, Trash2 } from "lucide-react-native";
import { actionCtx, dataChanged } from "@/state/app";
import { newId } from "@/lib/ids";
import { DAY, clock, formatDay } from "@/lib/format";
import { addSet, adjustRest, deleteSet, discardSession, finishSession, moveExercise, reorderExercises, restoreSet, restoreSets, saveSessionAsRoutine, saveSet, setExerciseUnit, setSuperset, skipExercise, skipPendingSets, stopRest, updateRoutineFromSession, updateSession } from "@/actions/gym";
import { cancelRest, scheduleRest } from "@/background/notify";
import { fromUnit, loadText } from "@/core/gym/load";
import { bestSet, isWorkSet } from "@/core/gym/stats";
import type { GymExercise, GymSet, SetType } from "@/core/gym/types";
import type { Block } from "@/queries/gym";
import { getGymPicker, getGymSession } from "@/queries/gym";
import { prefetch, useScreen } from "@/screens/useScreen";
import { TemplateUpdateDialog, TemplateUpdatePreview } from "./TemplateUpdate";
import { i18n } from "@/i18n/config";
import { Button } from "@/ui/Button";
import { Card, CardFill, useCardStyle } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { MenuPanel, useMenu } from "@/ui/Menu";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { DetailShell } from "@/ui/shells/DetailShell";
import { FACES } from "@/ui/fontClasses";
import { toast } from "@/ui/Toast";
import { Input } from "@/screens/log/fields";
import { goBack, push } from "@/ui/navigate";
import { useTheme } from "@/ui/theme";
import { ConfirmDialog, GymEmpty, MenuItem, StatTile, clockText, lengthText, useNow, volumeText } from "./parts";
import { SwipeActions } from "./SwipeActions";
import { ReorderSheet } from "./ReorderSheet";
import { Switch } from "@/screens/settings/controls";
import { QueryError } from "@/ui/shells/QueryError";

export function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation("gym");
  // Opened to be used: the read starts at mount, not after the slide ends, and a card that opens it prefetches it.
  const { data, error, reload } = useScreen((ctx) => getGymSession(ctx, id), ["gym-session", id], { eager: true });
  const vm = data;
  const [confirm, setConfirm] = useState<"finish" | "discard" | "delete" | null>(null);
  // What Finish does with the workout: drop the unticked sets, and make the template match today's exercises.
  const [skipPending, setSkipPending] = useState(true);
  const [updateTemplate, setUpdateTemplate] = useState(false);
  // When the finish dialog opened: its body says how long the workout has run, and it need not tick while it waits.
  const [confirmAt, setConfirmAt] = useState(0);
  const [rename, setRename] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  // A finished workout opens as its summary; the set-by-set page is one tap away.
  const [showDetails, setShowDetails] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  // The rows an Undo has just put back: they pulse once, so the eye finds where they landed.
  const [flash, setFlash] = useState<{ ids: string[]; at: number } | null>(null);
  const flashAt = useRef(0);
  const flashRows = (sets: GymSet[]) => setFlash({ ids: sets.map((s) => s.id), at: ++flashAt.current });
  const { ref: menuRef, anchor, open: openMenu, close: closeMenu } = useMenu();

  // The rest bar reads the session, or this between a ±15 and the row that records it: the countdown appears in the
  // same frame as the tap. `null` hides it (Skip); `undefined` follows the session. A tick no longer starts one.
  const [restOverride, setRestOverride] = useState<{ startedTs: number; sec: number } | null | undefined>(undefined);
  const current = vm?.session ?? null;
  const sessionRest = current?.restStartedTs && current.restSec ? { startedTs: current.restStartedTs, sec: current.restSec } : null;
  const rest = restOverride !== undefined ? restOverride : sessionRest;
  const nowS = () => Math.floor(Date.now() / 1000);
  // Which rest the screen is on: an adjustment's write can finish after the rest was skipped, and its late notification
  // must not replace the current one.
  const restSeq = useRef(0);
  // Every write this page starts, so Finish and Discard can wait for the ones in flight. A rest written after a finish
  // would put the session back to running; a set written after a discard would be left in an empty session.
  const inFlight = useRef(new Set<Promise<unknown>>());

  // Sets ticked on this screen but not yet in a reload: the finish dialog reads them at once, so a workout whose last
  // set was just ticked is not mistaken for an empty one.
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const isDone = (s: GymSet) => s.completed || ticked.has(s.id);
  const markTicked = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  if (vm === null) {
    return (
      <DetailShell title={t("session.title")} floatingAction={false} backHref="/gym" primary={<GymEmpty icon={Dumbbell} title={t("session.notFound")} body={t("session.notFoundBody")} />} />
    );
  }
  if (!vm) {
    return error ? (
      <DetailShell title={t("session.title")} floatingAction={false} backHref="/gym" primary={<QueryError compact error={error} reload={reload} />} />
    ) : (
      <DetailShell title={t("session.title")} loading bodySkeleton={<View className="h-40" />} />
    );
  }

  const { session } = vm;
  const lived = session.endTs ? session.endTs - session.startTs : 0;
  const store = actionCtx().store;
  const sessionUrl = `/gym/session/${session.id}`;
  const track = <T,>(job: Promise<T>): Promise<T> => {
    inFlight.current.add(job);
    void job.catch(() => {}).finally(() => inFlight.current.delete(job));
    return job;
  };
  const settle = async () => {
    while (inFlight.current.size) await Promise.allSettled([...inFlight.current]);
  };

  const save = (set: GymSet, draft: Draft, completed: boolean) =>
    track(
      (async () => {
        // Keep the row's tick: an edit can land before the reload that puts the tick into the view model.
        await saveSet(store, { ...set, ...draft, completed });
        dataChanged("gym");
      })(),
    );
  /** A tick draws at once (the row's own state); this writes it and refreshes the numbers behind it. */
  const tick = (set: GymSet, draft: Draft, on: boolean): Promise<boolean> =>
    track(
      (async (): Promise<boolean> => {
        if (on && draft.reps <= 0 && !(draft.seconds && draft.seconds > 0) && !(draft.distanceM && draft.distanceM > 0)) {
          toast.error(t("session.emptySet"));
          return false;
        }
        const at = nowS();
        markTicked(set.id, on);
        let saved: Awaited<ReturnType<typeof saveSet>>;
        try {
          saved = await saveSet(store, { ...set, ...draft, completed: on, ts: on ? at : null });
        } catch (e) {
          markTicked(set.id, !on);
          throw e;
        }
        if (!saved.ok) {
          markTicked(set.id, !on);
          return false;
        }
        dataChanged("gym");
        return on;
      })(),
    );
  /** Tick or untick every set of one exercise, through the same write a row's own tick uses. */
  const tickBlock = (block: Block, on: boolean) =>
    track(
      (async () => {
        for (const set of block.sets) {
          if (isDone(set) === on) continue;
          await tick(set, { weightKg: set.weightKg, reps: set.reps, seconds: set.seconds, distanceM: set.distanceM }, on);
        }
      })(),
    );
  const linkSuperset = (block: Block, next: Block | null, on: boolean) =>
    track(
      (async () => {
        await setSuperset(store, session.id, block.exercise.id, next?.exercise.id ?? null, on ? newId() : null);
        dataChanged("gym");
      })(),
    );
  const details = (set: GymSet, patch: Pick<GymSet, "type" | "note" | "rpe">) =>
    track(
      (async () => {
        await saveSet(store, { ...set, ...patch });
        dataChanged("gym");
      })(),
    );
  const removeSet = (set: GymSet) =>
    track(
      (async () => {
        await deleteSet(store, set);
        dataChanged("gym");
        toast.undo(t("session.setRemoved", { number: set.setNo }), {
          label: t("session.undo"),
          onPress: async () => {
            await restoreSet(store, set);
            dataChanged("gym");
            flashRows([set]);
          },
        });
      })(),
    );
  const removeExercise = (block: Block) =>
    track(
      (async () => {
        const removed = block.sets;
        for (const s of removed) await store.deleteGymSet(s.id);
        dataChanged("gym");
        toast.undo(t("session.exerciseRemoved", { name: block.exercise.name }), {
          label: t("session.undo"),
          onPress: async () => {
            await restoreSets(store, removed);
            dataChanged("gym");
            flashRows(removed);
          },
        });
      })(),
    );
  // Skipping keeps the sets already done (and their history) and drops only what is left.
  const skipBlock = (block: Block) =>
    track(
      (async () => {
        const removed = await skipExercise(store, session.id, block.exercise.id);
        if (!removed.length) return;
        dataChanged("gym");
        toast.undo(t("session.skipped", { name: block.exercise.name }), {
          label: t("session.undo"),
          onPress: async () => {
            await restoreSets(store, removed);
            dataChanged("gym");
            flashRows(removed);
          },
        });
      })(),
    );
  const addOne = (block: Block) =>
    track(
      (async () => {
        await addSet(store, session.id, block.exercise.id);
        dataChanged("gym");
      })(),
    );
  const move = (block: Block, delta: -1 | 1) =>
    track(
      (async () => {
        await moveExercise(store, session.id, block.exercise.id, delta);
        dataChanged("gym");
      })(),
    );
  // The rest bar and its writes are this screen's own rows: no reload is needed to show the countdown.
  const skipRest = () =>
    track(
      (async () => {
        restSeq.current++;
        setRestOverride(null);
        void cancelRest();
        await stopRest(store, session);
        // The screen keeps the hidden bar, but the cached session must not carry the rest into the next visit.
        dataChanged("gym");
      })(),
    );
  const adjust = (delta: number) =>
    track(
      (async () => {
        if (!rest) return;
        const seq = ++restSeq.current;
        const at = nowS();
        // Show the new total in the same frame; the write follows.
        setRestOverride({ startedTs: rest.startedTs, sec: Math.max(5, Math.min(900, rest.sec + delta)) });
        const next = await adjustRest(store, { ...session, restStartedTs: rest.startedTs, restSec: rest.sec }, delta);
        setRestOverride(next.restStartedTs && next.restSec ? { startedTs: next.restStartedTs, sec: next.restSec } : null);
        dataChanged("gym");
        if (seq !== restSeq.current) return;
        if (next.restStartedTs && next.restSec && next.restStartedTs + next.restSec > at) void scheduleRest(next.restStartedTs + next.restSec, sessionUrl);
        else void cancelRest();
      })(),
    );
  const saveTemplate = () =>
    track(
      (async () => {
        const routine = await saveSessionAsRoutine(store, session, nowS());
        if (!routine) return;
        await updateSession(store, session, { routineId: routine.id });
        dataChanged("gym");
        toast.success(t("session.templateSaved", { name: routine.name }));
      })(),
    );
  // Make the running session's template match it, so tomorrow's workout is this one, not the old plan.
  const saveTemplateUpdate = () =>
    track(
      (async () => {
        const routine = await updateRoutineFromSession(store, session, nowS());
        dataChanged("gym");
        if (routine) toast.success(t("session.templateUpdated", { name: routine.name }));
        else toast.error(t("session.templateEmpty"));
      })(),
    );
  // The picker is the heaviest list in the gym: its read starts on the tap, so its rows are there when it lands.
  const addExercise = () => {
    void prefetch(getGymPicker, ["gym-picker"]);
    push(`/gym/exercises?session=${session.id}`);
  };

  const empty = !vm.blocks.some((b) => b.sets.some((s) => isDone(s) && s.type !== "warmup"));
  const doneCount = vm.blocks.reduce((n, b) => n + b.sets.filter(isDone).length, 0);
  const pending = vm.blocks.reduce((n, b) => n + b.sets.filter((s) => !isDone(s)).length, 0);
  const totalSets = vm.blocks.reduce((n, b) => n + b.sets.length, 0);
  const unit = vm.blocks.length && vm.blocks.every((b) => b.exercise.unit === "lb") ? "lb" : "kg";
  // The finished card's right column: the set that best shows what the exercise did, in its own unit.
  const bestText = (block: Block): string => {
    const done = block.sets.filter(isWorkSet);
    if (!done.length) return "—";
    if (block.exercise.hold || done.some((s) => !!s.seconds && !s.reps)) {
      const seconds = Math.max(...done.map((s) => s.seconds ?? 0));
      return seconds > 0 ? clockText(seconds) : "—";
    }
    if (block.exercise.bodyPart === "cardio") {
      const meters = Math.max(...done.map((s) => s.distanceM ?? 0));
      if (meters > 0) return `${Math.round(meters / 10) / 100} km`;
      const seconds = Math.max(...done.map((s) => s.seconds ?? 0));
      return seconds > 0 ? clockText(seconds) : "—";
    }
    const best = bestSet(done);
    if (best) return `${loadText(best.weightKg, block.exercise.unit)} ${block.exercise.unit} × ${best.reps}`;
    const reps = Math.max(...done.map((s) => s.reps));
    return reps > 0 ? `${reps} ${t("session.reps")}` : "—";
  };
  const workCount = (block: Block) => block.sets.filter(isWorkSet).length;
  const workSetsDone = vm.blocks.reduce((n, b) => n + workCount(b), 0);

  return (
    <View className="flex-1">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <DetailShell
          title={session.name}
          titleClassName="text-[22px] font-semibold normal-case tracking-[-0.01em]"
          subtitle={
            <>
              <SessionClock startTs={session.startTs} endTs={session.endTs} />
              {` · ${`${vm.setCount} / ${totalSets}`} ${t("session.sets")}`}
            </>
          }
          floatingAction={false}
          // A workout is opened to be used, not watched slide in: its sets draw in the first frame.
          instant
          clipBody={false}
          backHref="/gym"
          action={
            <View className="flex-row items-center gap-2">
              {!session.finished && (
                <Press
                  accessibilityRole="button"
                  onPress={() => {
                    setSkipPending(true);
                    setUpdateTemplate(false);
                    setConfirmAt(nowS());
                    setConfirm("finish");
                  }}
                  className={cn("h-9 items-center justify-center rounded-full px-4", !empty && pending === 0 ? "bg-optimal" : "bg-secondary")}
                >
                  <Text className={cn("text-[12px] font-bold uppercase tracking-[0.1em]", !empty && pending === 0 ? "text-background" : "text-foreground")}>{t("session.finish")}</Text>
                </Press>
              )}
              <View ref={menuRef} collapsable={false}>
                <Press accessibilityRole="button" onPress={openMenu} className="size-11 items-center justify-center">
                  <Icon icon={MoreHorizontal} size={20} tone="muted-foreground" />
                </Press>
              </View>
            </View>
          }
          footer={
            <View className="gap-3 pb-8">
              {!session.finished && (
                <Press
                  accessibilityRole="button"
                  accessibilityLabel={t("session.addExercise")}
                  onPress={addExercise}
                  className="h-12 flex-row items-center justify-center gap-2"
                >
                  <Text className="text-[12px] font-bold uppercase tracking-[0.1em] text-foreground-secondary">{t("session.addExercise")}</Text>
                </Press>
              )}
            </View>
          }
          primary={
            <View className="gap-4">
              {!session.finished && vm.blocks.length > 0 && <Progress blocks={vm.blocks} isDone={isDone} />}
              {session.finished && !empty && (
                <Card className="gap-4 px-4 py-4">
                  <CardFill />
                  <View className="flex-row items-center gap-2">
                    <Icon icon={Check} size={16} tone="strain" strokeWidth={2.6} />
                    <Text className="text-[11px] font-bold uppercase tracking-[0.1em] text-strain-text">{t("session.complete")}</Text>
                    <Text className="ml-auto font-numeric text-[12px] tabular-nums text-muted-foreground">{`${formatDay(session.day, DAY.monthDay)} · ${clock(session.startTs * 1000)}`}</Text>
                  </View>
                  <View className="flex-row gap-2">
                    <StatTile label={t("session.duration")} value={lengthText(lived)} />
                    <StatTile label={t("session.sets")} value={String(workSetsDone)} />
                    <StatTile label={t("session.volume")} value={volumeText(vm.volumeKg, unit)} />
                  </View>
                  <View className="gap-1.5">
                    <View className="flex-row items-center gap-3 px-1">
                      <Text className="min-w-0 flex-1 text-[11px] font-bold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{t("session.sets")}</Text>
                      <Text className="text-[11px] font-bold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{t("session.bestSet")}</Text>
                    </View>
                    {vm.blocks
                      .filter((b) => workCount(b) > 0)
                      .map((b) => (
                        <View key={b.exercise.id} className="flex-row items-center gap-3 px-1">
                          <Text className="min-w-0 flex-1 text-[14px] leading-5" numberOfLines={1}>{`${workCount(b)} × ${b.exercise.name}`}</Text>
                          <Text className="shrink font-numeric text-[13px] leading-4 tabular-nums text-foreground-secondary">{bestText(b)}</Text>
                        </View>
                      ))}
                  </View>
                  {vm.newRecords.length > 0 && (
                    <View className="gap-1.5">
                      <Text className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{t("session.newRecords")}</Text>
                      {vm.newRecords.map((r) => (
                        <Text key={r.exercise.id} className="text-[13px] leading-[19px] text-foreground-secondary">
                          {`${r.exercise.name}: ${loadText(r.weightKg, r.exercise.unit)} ${r.exercise.unit} × ${r.reps}`}
                        </Text>
                      ))}
                    </View>
                  )}
                  <View className="gap-1">
                    {session.routineId ? (
                      <Button variant="secondary" onPress={() => setTemplateOpen(true)}>
                        {t("session.updateTemplate")}
                      </Button>
                    ) : (
                      <Button variant="secondary" onPress={() => void saveTemplate()}>
                        {t("session.saveTemplate")}
                      </Button>
                    )}
                    <Press
                      accessibilityRole="button"
                      accessibilityState={{ expanded: showDetails }}
                      onPress={() => setShowDetails((v) => !v)}
                      className="h-11 flex-row items-center justify-center gap-1.5"
                    >
                      <Text className="text-[12px] font-bold uppercase tracking-[0.1em] text-foreground-secondary">{showDetails ? t("session.hideDetails") : t("session.showDetails")}</Text>
                      <Icon icon={showDetails ? ChevronUp : ChevronDown} size={15} tone="foreground-secondary" />
                    </Press>
                  </View>
                </Card>
              )}

              {vm.blocks.length ? (
                (!session.finished || showDetails || empty) &&
                vm.blocks.map((block, index) => (
                  <BlockCard
                    key={block.exercise.id}
                    block={block}
                    next={vm.blocks[index + 1] ?? null}
                    onSuperset={linkSuperset}
                    onSave={save}
                    onTick={tick}
                    onDetails={details}
                    onRemoveSet={removeSet}
                    onRemoveExercise={removeExercise}
                    onSkip={skipBlock}
                    onAddSet={addOne}
                    onMove={move}
                    onTickBlock={tickBlock}
                    onReorder={() => setReordering(true)}
                    finished={session.finished}
                    allDone={block.sets.every((s) => isDone(s))}
                    someDone={block.sets.some((s) => isDone(s))}
                    doneSets={block.sets.filter(isDone).length}
                    canUp={index > 0}
                    canDown={index < vm.blocks.length - 1}
                    prSetIds={vm.prSetIds}
                    flash={flash}
                  />
                ))
              ) : (
                <Card className="items-center gap-3 px-4 py-8">
                  <CardFill />
                  <Icon icon={Dumbbell} size={24} tone="muted-foreground" />
                  <Text className="text-center text-[15px] text-foreground-secondary">{t("session.empty")}</Text>
                  {!session.finished && (
                    <Button variant="secondary" onPress={addExercise}>
                      {t("session.addExercise")}
                    </Button>
                  )}
                </Card>
              )}

              {!!session.notes && (
                <Press accessibilityRole="button" onPress={() => setNotesOpen(true)} className="gap-1 rounded-2xl bg-secondary px-4 py-3">
                  <Text className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{t("session.notes")}</Text>
                  <Text className="text-[14px] leading-[21px] text-foreground-secondary">{session.notes}</Text>
                </Press>
              )}
            </View>
          }
        />

        <MenuPanel anchor={anchor} onClose={closeMenu} align="end">
          <MenuItem icon={Pencil} label={t("session.rename")} onPress={() => (closeMenu(), setRename(true))} />
          <MenuItem icon={NotebookPen} label={t("session.notes")} onPress={() => (closeMenu(), setNotesOpen(true))} />
          {!session.finished && <MenuItem icon={Plus} label={t("session.addExercise")} onPress={() => (closeMenu(), addExercise())} />}
          {!!session.routineId && <MenuItem icon={Dumbbell} label={t("session.updateTemplate")} onPress={() => (closeMenu(), setTemplateOpen(true))} />}
          {!session.finished && <MenuItem icon={Trash2} label={t("session.discard")} danger onPress={() => (closeMenu(), setConfirm("discard"))} />}
          {session.finished && <MenuItem icon={Trash2} label={t("session.delete")} danger onPress={() => (closeMenu(), setConfirm("delete"))} />}
        </MenuPanel>

        {rest && <RestBar key={rest.startedTs} startedTs={rest.startedTs} sec={rest.sec} onSkip={() => void skipRest()} onAdjust={(d) => void adjust(d)} />}
      </KeyboardAvoidingView>

      <ConfirmDialog
        open={confirm === "finish"}
        title={empty ? t("session.emptyFinishTitle") : t("session.finishTitle")}
        body={empty ? t("session.emptyFinishBody") : `${t("session.finishBody", { sets: doneCount, time: clockText(Math.max(0, confirmAt - session.startTs)) })}${pending ? ` ${t("session.finishPending", { count: pending })}` : ""}`}
        extra={
          empty ? undefined : (
            <>
              {pending > 0 && (
                <FinishOption label={t("session.skipPending")} hint={t("session.skipPendingHint", { count: pending })} value={skipPending} onChange={setSkipPending} />
              )}
              {!!session.routineId && <FinishOption label={t("session.updateTemplate")} hint={t("session.updateTemplateHint")} value={updateTemplate} onChange={setUpdateTemplate} />}
              {updateTemplate && !!session.routineId && <TemplateUpdatePreview sessionId={session.id} maxHeight={240} />}
            </>
          )
        }
        confirm={empty ? t("session.discardConfirm") : t("session.finish")}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          // A tick still being written would draw the countdown again on the finished row.
          await settle();
          restSeq.current++;
          setRestOverride(null);
          void cancelRest();
          // The rows say whether there is work, not the view model a tick behind them: an empty workout is discarded.
          const latestSets = await store.gymSets([session.id]);
          if (skipPending) await skipPendingSets(store, session.id);
          const kept = skipPending ? await store.gymSets([session.id]) : latestSets;
          if (!kept.some(isWorkSet)) {
            await discardSession(store, session.id);
            dataChanged("gym");
            goBack();
            return;
          }
          const latest = (await store.gymSessions()).find((s) => s.id === session.id) ?? session;
          const done = await finishSession(store, latest, nowS());
          const routine = updateTemplate ? await updateRoutineFromSession(store, done, nowS()) : null;
          dataChanged("gym");
          toast.success(routine ? t("session.savedTemplateUpdated") : t("session.saved"));
        }}
      />
      <ConfirmDialog
        open={confirm === "discard" || confirm === "delete"}
        title={confirm === "discard" ? t("session.discardTitle") : t("session.deleteTitle")}
        body={confirm === "discard" ? t("session.discardBody") : t("session.deleteBody")}
        confirm={confirm === "discard" ? t("session.discardConfirm") : t("session.delete")}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const was = confirm;
          setConfirm(null);
          await settle();
          restSeq.current++;
          setRestOverride(null);
          void cancelRest();
          await discardSession(store, session.id);
          dataChanged("gym");
          if (was) goBack();
        }}
      />
      <ReorderSheet
        open={reordering}
        title={t("reorder.exercises")}
        items={vm.blocks.map((block) => ({ id: block.exercise.id, label: block.exercise.name, meta: t("session.setsCount", { count: block.sets.length }) }))}
        onClose={() => setReordering(false)}
        onDone={(ordered) => {
          setReordering(false);
          void reorderExercises(store, session.id, ordered).then(() => dataChanged("gym"));
        }}
      />
      {rename && (
        <RenameDialog
          initial={session.name}
          onClose={() => setRename(false)}
          onSave={(name) => {
            setRename(false);
            void track(
              (async () => {
                await updateSession(store, session, { name });
                dataChanged("gym");
              })(),
            );
          }}
        />
      )}
      {notesOpen && (
        <NotesDialog
          initial={session.notes ?? ""}
          onClose={() => setNotesOpen(false)}
          onSave={(notes) => {
            setNotesOpen(false);
            void track(
              (async () => {
                await updateSession(store, session, { notes });
                dataChanged("gym");
              })(),
            );
          }}
        />
      )}
      <TemplateUpdateDialog
        open={templateOpen}
        sessionId={session.id}
        onClose={() => setTemplateOpen(false)}
        onApply={() => {
          setTemplateOpen(false);
          void saveTemplateUpdate();
        }}
      />
    </View>
  );
}

/** The workout's progress: a segment per exercise, filling as its sets are ticked and turning green when all are. */
function Progress({ blocks, isDone }: { blocks: Block[]; isDone: (s: GymSet) => boolean }) {
  return (
    <View className="-mt-1 flex-row gap-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {blocks.map((block) => {
        const share = block.sets.length ? block.sets.filter(isDone).length / block.sets.length : 0;
        return (
          <View key={block.exercise.id} className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
            <View className={cn("h-full rounded-full", share === 1 ? "bg-optimal" : "bg-strain")} style={{ width: `${share * 100}%` }} />
          </View>
        );
      })}
    </View>
  );
}

/** One switch in the finish dialog: skip what was not done, or make the template match today. */
function FinishOption({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View className="flex-row items-center gap-3 rounded-xl bg-secondary px-3 py-2.5">
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-medium leading-[19px]">{label}</Text>
        <Text className="text-[12px] leading-4 text-muted-foreground">{hint}</Text>
      </View>
      <Switch label={label} value={value} onValueChange={onChange} />
    </View>
  );
}

type Draft = Pick<GymSet, "weightKg" | "reps" | "seconds" | "distanceM">;

/** One exercise: its header, the column labels and the rows. */
function BlockCard({
  block,
  next,
  onSuperset,
  onSave,
  onTick,
  onDetails,
  onRemoveSet,
  onRemoveExercise,
  onSkip,
  onAddSet,
  onMove,
  onTickBlock,
  onReorder,
  finished,
  allDone,
  someDone,
  doneSets,
  canUp,
  canDown,
  prSetIds,
  flash,
}: {
  block: Block;
  next: Block | null;
  onSuperset: (block: Block, next: Block | null, on: boolean) => void;
  onSave: (set: GymSet, d: Draft, completed: boolean) => void;
  onTick: (set: GymSet, d: Draft, on: boolean) => Promise<boolean>;
  onDetails: (set: GymSet, patch: Pick<GymSet, "type" | "note" | "rpe">) => void;
  onRemoveSet: (set: GymSet) => void;
  onRemoveExercise: (block: Block) => void;
  /** Skip the exercise for today: its unticked sets go, the done ones stay. */
  onSkip: (block: Block) => void;
  onAddSet: (block: Block) => void;
  onMove: (block: Block, delta: -1 | 1) => void;
  /** Tick or untick every set of the exercise at once. */
  onTickBlock: (block: Block, on: boolean) => void;
  /** Long press on the exercise name: reorder the workout's exercises. */
  onReorder: () => void;
  /** A finished workout is read back: skipping is a tracking action, not a history edit. */
  finished: boolean;
  allDone: boolean;
  someDone: boolean;
  /** Sets ticked so far, for the count beside the name. */
  doneSets: number;
  canUp: boolean;
  canDown: boolean;
  prSetIds: string[];
  flash: { ids: string[]; at: number } | null;
}) {
  const { t } = useTranslation("gym");
  const { exercise } = block;
  const { ref: menuRef, anchor, open: openMenu, close: closeMenu } = useMenu();
  const [remove, setRemove] = useState(false);
  const [noting, setNoting] = useState<GymSet | null>(null);
  const unit = exercise.unit;
  const supersetId = block.sets.find((s) => s.supersetId)?.supersetId ?? null;
  const cardio = exercise.bodyPart === "cardio";
  const hold = exercise.hold || block.sets.some((s) => !!s.seconds && !s.reps);
  // Strong's "+0%" against the last time this exercise was done. An unchanged volume shows nothing: "− 0" is noise,
  // and the absence is the honest reading (OpenGym's rule for a weight that has not moved).
  // Only once every set of the exercise is ticked: a workout in progress would otherwise compare one set's volume
  // against the whole of last time's and show a red "−80%" for the first three sets.
  const lastVolume = block.prev.reduce((n, s) => n + (s && s.type !== "warmup" ? s.weightKg * s.reps : 0), 0);
  const nowVolume = block.sets.reduce((n, s) => n + (s.completed && s.type !== "warmup" ? s.weightKg * s.reps : 0), 0);
  const workSets = block.sets.filter((s) => s.type !== "warmup");
  const allTicked = workSets.length > 0 && workSets.every((s) => s.completed);
  const delta = allTicked && lastVolume > 0 && nowVolume > 0 ? Math.round(((nowVolume - lastVolume) / lastVolume) * 100) : null;

  // Swipe the card for the exercise's actions; a set row's own swipe (delete) wins where the finger lands on a set.
  const cardLeft = [{ label: t("exercise.history"), icon: History, onPress: () => push(`/gym/exercise/${exercise.id}`) }];
  const cardRight = [
    ...(!finished && !allDone ? [{ label: t("session.skip"), icon: SkipForward, onPress: () => onSkip(block) }] : []),
    { label: t("session.remove"), icon: Trash2, tone: "danger" as const, onPress: () => setRemove(true) },
  ];

  return (
    <SwipeActions left={cardLeft} right={cardRight}>
      <Card className="px-3 py-4">
        <CardFill />
        <View className="mb-3 flex-row items-center gap-2 px-1">
          <Press
            accessibilityRole="link"
            accessibilityHint={t("session.reorder")}
            onPress={() => push(`/gym/exercise/${exercise.id}`)}
            onLongPress={() => {
              haptic.select();
              onReorder();
            }}
            delayLongPress={350}
            className="min-w-0 flex-1 flex-row items-center gap-1.5"
          >
            <Text className="shrink text-[17px] font-semibold leading-[22px]" numberOfLines={1}>
              {exercise.name}
            </Text>
          </Press>
          <Text className={cn("font-numeric text-[12px] font-semibold tabular-nums", allDone ? "text-optimal-text" : "text-muted-foreground")}>{`${doneSets}/${block.sets.length}`}</Text>
          {!!supersetId && (
            <View className="h-5 items-center justify-center rounded-full bg-secondary px-2">
              <Text className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{t("session.superset")}</Text>
            </View>
          )}
          {delta != null && delta !== 0 && <Text className={cn("font-numeric text-[12px] font-semibold tabular-nums", delta > 0 ? "text-strain-text" : "text-recovery-red-text")}>{`${delta > 0 ? "+" : ""}${delta}%`}</Text>}
          <View ref={menuRef} collapsable={false}>
            <Press accessibilityRole="button" accessibilityLabel={t("session.exerciseMenu")} onPress={openMenu} className="size-11 items-center justify-center">
              <Icon icon={MoreHorizontal} size={20} tone="muted-foreground" />
            </Press>
          </View>
        </View>

        <View className="mb-2 flex-row items-center gap-3 px-1">
          <Text className="w-8 text-center text-[11px] font-semibold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{t("session.set")}</Text>
          <Text className="w-[74px] text-right text-[11px] font-semibold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{t("session.previous")}</Text>
          <View className="flex-1 flex-row items-center gap-2">
            {hold && <View className="flex-1" />}
            <Text className="flex-1 text-center text-[11px] font-semibold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{cardio ? t("session.km") : hold ? t("session.sec") : unit === "lb" ? t("session.lb") : t("session.kg")}</Text>
            {!hold && <Text className="flex-1 text-center text-[11px] font-semibold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{cardio ? t("session.min") : t("session.reps")}</Text>}
          </View>
          <Press
            accessibilityRole="button"
            accessibilityState={{ checked: allDone }}
            accessibilityLabel={t("session.allSets")}
            onPress={() => onTickBlock(block, !allDone)}
            className="h-11 w-11 items-center justify-center"
          >
            <View className={cn("size-6 items-center justify-center rounded-full", allDone ? "border border-optimal bg-optimal" : "border border-muted-foreground")}>
              {allDone ? (
                <Icon icon={Check} size={13} tone="background" strokeWidth={2.6} />
              ) : someDone ? (
                <View className="h-0.5 w-3 rounded-full bg-muted-foreground" />
              ) : null}
            </View>
          </Press>
        </View>

        <View>
          {block.sets.map((set, i) => (
            <SwipeActions key={set.id} right={[{ label: t("session.delete"), icon: Trash2, tone: "danger", onPress: () => onRemoveSet(set) }]}>
              <View className="rounded-lg bg-card">
                <SetRow
                  set={set}
                  prev={block.prev[i] ?? null}
                  unit={unit}
                  cardio={cardio}
                  hold={hold}
                  pr={prSetIds.includes(set.id)}
                  flashAt={flash?.ids.includes(set.id) ? flash.at : 0}
                  onSave={(d, completed) => onSave(set, d, completed)}
                  onTick={(d, on) => onTick(set, d, on)}
                  onMenu={() => setNoting(set)}
                />
              </View>
          </SwipeActions>
        ))}
        </View>

        <Press accessibilityRole="button" onPress={() => onAddSet(block)} className="mt-1 h-11 items-center justify-center">
        <Text className="text-[12px] font-bold uppercase tracking-[0.1em] text-foreground-secondary">{t("session.addSet")}</Text>
        </Press>

        <MenuPanel anchor={anchor} onClose={closeMenu} align="end">
        {canUp && <MenuItem icon={ArrowUp} label={t("session.moveUp")} onPress={() => (closeMenu(), onMove(block, -1))} />}
        {canDown && <MenuItem icon={ArrowDown} label={t("session.moveDown")} onPress={() => (closeMenu(), onMove(block, 1))} />}
        {supersetId ? (
          <MenuItem icon={Scale} label={t("session.removeSuperset")} onPress={() => (closeMenu(), onSuperset(block, null, false))} />
        ) : next ? (
          <MenuItem icon={Plus} label={t("session.supersetWith", { name: next.exercise.name })} onPress={() => (closeMenu(), onSuperset(block, next, true))} />
        ) : null}
        <MenuItem icon={Scale} label={t("session.changeUnit", { unit: unit === "kg" ? "LB" : "KG" })} onPress={() => (closeMenu(), void setUnit(exercise, unit === "kg" ? "lb" : "kg"))} />
        <MenuItem icon={History} label={t("exercise.history")} onPress={() => (closeMenu(), push(`/gym/exercise/${exercise.id}`))} />
        {!finished && !allDone && <MenuItem icon={SkipForward} label={t("session.skipToday")} onPress={() => (closeMenu(), onSkip(block))} />}
        <MenuItem icon={Trash2} label={t("session.removeExercise")} danger onPress={() => (closeMenu(), setRemove(true))} />
        </MenuPanel>

        <ConfirmDialog
        open={remove}
        title={t("session.removeExercise")}
        body={t("session.removeExerciseBody", { count: block.sets.length })}
        confirm={t("session.removeExercise")}
        onCancel={() => setRemove(false)}
        onConfirm={() => {
          setRemove(false);
          onRemoveExercise(block);
        }}
        />
        {noting && (
        <NoteDialog
          number={noting.setNo}
          initial={noting.note ?? ""}
          type={noting.type}
          rpe={noting.rpe}
          onClose={() => setNoting(null)}
          onSave={(type, note, rpe) => {
            onDetails(noting, { type, note, rpe });
            setNoting(null);
          }}
          onDelete={() => {
            onRemoveSet(noting);
            setNoting(null);
          }}
        />
        )}
        {/* A note or an RPE on any set shows under the exercise: the file's notes, and the ones typed here. */}
        {block.sets.some((s) => s.note || s.rpe) && (
        <View className="mt-1 gap-1 px-1">
          {block.sets
            .filter((s) => s.note || s.rpe)
            .map((s) => (
              <Text key={s.id} className="text-[12px] leading-4 text-muted-foreground" onPress={() => setNoting(s)}>
                {`${s.setNo}. ${[s.note, s.rpe ? `${t("session.rpe")} ${s.rpe}` : null].filter(Boolean).join(" · ")}`}
              </Text>
            ))}
        </View>
        )}
      </Card>
    </SwipeActions>
  );
}

/** One set: number, last time, weight, reps, tick. */
function SetRow({
  set,
  prev,
  unit,
  cardio,
  hold,
  pr,
  flashAt,
  onSave,
  onTick,
  onMenu,
}: {
  set: GymSet;
  prev: GymSet | null;
  unit: "kg" | "lb";
  cardio: boolean;
  hold: boolean;
  pr: boolean;
  flashAt: number;
  onSave: (d: Draft, completed: boolean) => void;
  onTick: (d: Draft, on: boolean) => Promise<boolean>;
  onMenu: () => void;
}) {
  const { t } = useTranslation("gym");
  const reduce = useReducedMotion();
  const glow = useSharedValue(0);
  // A row an Undo has just brought back pulses once, so the eye finds it. No pulse under reduced motion.
  useEffect(() => {
    if (!flashAt || reduce) return;
    glow.value = 0.18;
    glow.value = withTiming(0, { duration: 800 });
  }, [flashAt, reduce, glow]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const [weight, setWeight] = useState(() => loadText(set.weightKg, unit));
  const [reps, setReps] = useState(() => String(set.reps));
  const [secs, setSecs] = useState(() => (set.seconds ? String(Math.round(set.seconds)) : ""));
  const [km, setKm] = useState(() => (set.distanceM ? String(Math.round(set.distanceM / 10) / 100) : ""));
  const [mins, setMins] = useState(() => (set.seconds ? String(Math.round((set.seconds / 60) * 10) / 10) : ""));
  // The tick is drawn here first: the write and the reload land behind it. `busy` turns a second tap while the first
  // is still being written into an untick; a write the screen refuses (an empty set) flips the row back.
  const [done, setDone] = useState(set.completed);
  const busy = useRef(false);
  useEffect(() => {
    if (!busy.current) setDone(set.completed);
  }, [set.completed]);
  const typed = useRef(false);
  const textKey = (w = weight, r = reps, s = secs, d = km, m = mins) => `${w}|${r}|${s}|${d}|${m}`;
  // Blur and submit both fire on Android: only a field whose text changed is written, so a row does not reload twice.
  const lastSaved = useRef(textKey());

  // A reload from the store refreshes the fields, but never while one is being typed in.
  useEffect(() => {
    if (typed.current) return;
    setWeight(loadText(set.weightKg, unit));
    setReps(String(set.reps));
    setSecs(set.seconds ? String(Math.round(set.seconds)) : "");
    setKm(set.distanceM ? String(Math.round(set.distanceM / 10) / 100) : "");
    setMins(set.seconds ? String(Math.round((set.seconds / 60) * 10) / 10) : "");
    lastSaved.current = `${loadText(set.weightKg, unit)}|${set.reps}|${set.seconds ? String(Math.round(set.seconds)) : ""}|${set.distanceM ? String(Math.round(set.distanceM / 10) / 100) : ""}|${set.seconds ? String(Math.round((set.seconds / 60) * 10) / 10) : ""}`;
  }, [set.weightKg, set.reps, set.seconds, set.distanceM, unit]);

  const n = (v: string) => {
    const x = parseFloat(v.replace(",", "."));
    return Number.isFinite(x) ? x : 0;
  };
  const draft = (): Draft => ({
    weightKg: hold || cardio ? 0 : fromUnit(n(weight), unit),
    reps: hold || cardio ? 0 : Math.max(0, Math.round(n(reps))),
    seconds: cardio ? Math.round(n(mins) * 60) || null : hold ? Math.round(n(secs)) || null : null,
    distanceM: cardio ? Math.round(n(km) * 1000) || null : null,
  });
  const commit = () => {
    typed.current = false;
    const key = textKey();
    if (key === lastSaved.current) return;
    lastSaved.current = key;
    onSave(draft(), done);
  };
  const toggle = async () => {
    if (busy.current) return;
    const on = !done;
    busy.current = true;
    setDone(on);
    if (on) haptic.tap();
    try {
      if (await onTick(draft(), on)) {
        // The write took the typed numbers too: a later blur has nothing left to save.
        typed.current = false;
        lastSaved.current = textKey();
      } else {
        setDone(!on);
      }
    } catch {
      setDone(!on);
    } finally {
      busy.current = false;
    }
  };
  const prevText = prev
    ? hold
      ? `${Math.round(prev.seconds ?? 0)} s`
      : cardio
        ? `${Math.round((prev.distanceM ?? 0) / 10) / 100} km`
        : `${loadText(prev.weightKg, unit)} ${unit} × ${prev.reps}`
    : "—";

  return (
    <Press onLongPress={onMenu} delayLongPress={350} accessible={false} className={cn("flex-row items-center gap-3 rounded-lg px-1 py-1", done && "bg-optimal/15")}>
      <Animated.View pointerEvents="none" className="absolute inset-0 rounded-lg bg-strain" style={glowStyle} />
      <Press onPress={onMenu} hitSlop={10} className="w-8 items-center justify-center" accessibilityRole="button" accessibilityLabel={`${t("session.set")} ${set.setNo}`}>
        <Text className={cn("font-numeric text-[13px] font-semibold", done ? "text-optimal-text" : "text-foreground-secondary")}>{set.type === "warmup" ? "W" : set.type === "drop" ? "D" : set.type === "failure" ? "F" : set.setNo}</Text>
      </Press>
      <View className="w-[74px] flex-row items-center justify-end gap-1">
        {pr && <Text className="text-[11px] font-bold uppercase tracking-[0.1em] text-strain-text">{t("session.record")}</Text>}
        <Text className="shrink font-numeric text-[13px] leading-4 text-muted-foreground" numberOfLines={1}>
          {prevText}
        </Text>
      </View>
      <View className="flex-1 flex-row items-center gap-2">
        {hold && <View className="flex-1" />}
        {!hold && (
          <NumCell value={weight} onChangeText={(v) => ((typed.current = true), setWeight(v))} onEnd={commit} className="flex-1" label={`${t("session.set")} ${set.setNo} ${t("session.kg")}`} completed={done} />
        )}
        {hold && <NumCell value={secs} onChangeText={(v) => ((typed.current = true), setSecs(v))} onEnd={commit} className="flex-1" label={`${t("session.set")} ${set.setNo} ${t("session.sec")}`} completed={done} />}
        {cardio && <NumCell value={km} onChangeText={(v) => ((typed.current = true), setKm(v))} onEnd={commit} className="flex-1" label={`${t("session.set")} ${set.setNo} ${t("session.km")}`} completed={done} />}
        {cardio && <NumCell value={mins} onChangeText={(v) => ((typed.current = true), setMins(v))} onEnd={commit} className="flex-1" label={`${t("session.set")} ${set.setNo} ${t("session.min")}`} completed={done} />}
        {!hold && !cardio && <NumCell value={reps} onChangeText={(v) => ((typed.current = true), setReps(v))} onEnd={commit} className="flex-1" label={`${t("session.set")} ${set.setNo} ${t("session.reps")}`} completed={done} />}
      </View>
      <Press
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`${t("session.set")} ${set.setNo} · ${t("session.done")}`}
        onPress={() => void toggle()}
        className="h-11 w-11 items-center justify-center"
      >
        <View className={cn("size-8 items-center justify-center rounded-full border", done ? "border-optimal bg-optimal" : "border-muted-foreground")}>
          {done && <Icon icon={Check} size={13} tone="background" strokeWidth={2.6} />}
        </View>
      </Press>
    </Press>
  );
}

/** The number cell: a filled rounded box, the way Strong draws a set's weight. */
function NumCell({ value, onChangeText, onEnd, className, label, completed }: { value: string; onChangeText: (v: string) => void; onEnd: () => void; className?: string; label: string; completed?: boolean }) {
  const { c } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onBlur={onEnd}
      onSubmitEditing={onEnd}
      keyboardType="decimal-pad"
      selectTextOnFocus
      returnKeyType="done"
      placeholder="0"
      accessibilityLabel={label}
      placeholderTextColor={c["muted-foreground"]}
      className={cn("h-11 rounded-lg text-center font-numeric text-[19px] font-semibold text-foreground", completed ? "bg-transparent" : "bg-secondary", className)}
      // Android gives a TextInput font padding above the line, which a 36 px box then clips: a 0 lost its top and read
      // as a U ("10" as "IU"). No padding, no extra font padding, and the glyph sits centred.
      style={{ paddingVertical: 0, includeFontPadding: false, textAlignVertical: "center", fontFamily: FACES.numeric.semibold, fontVariant: ["tabular-nums"] }}
    />
  );
}

/** The workout's clock: it ticks on its own, only while the page is in front, so the sets below it never render for a
 *  second hand and a picker pushed over the workout does not keep a timer running behind it. */
function SessionClock({ startTs, endTs }: { startTs: number; endTs: number | null }) {
  const focused = useIsFocused();
  const now = useNow(focused && endTs == null);
  return <>{clockText(Math.max(0, (endTs ?? now) - startTs))}</>;
}

/**
 * The rest countdown, a bar at the foot of the screen. It counts on its own (the page below it does not render for a
 * second hand), reads the stored start instant so a phone that slept comes back to the right number, and ends where it
 * was set to.
 */
function RestBar({ startedTs, sec, onSkip, onAdjust }: { startedTs: number; sec: number; onSkip: () => void; onAdjust: (delta: number) => void }) {
  const { t } = useTranslation("gym");
  const cardStyle = useCardStyle("overlay");
  // The bar's total stays the one it opened with: ±15 turns the clock, it does not rescale the whole bar under the thumb.
  const [openedWith] = useState(sec);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const left = Math.max(0, startedTs + sec - now);
  const running = left > 0;
  // A rest that ends while the screen is open gets a haptic; a skip unmounts the bar, so it stays silent.
  const was = useRef(false);
  useEffect(() => {
    if (running) {
      was.current = true;
      return;
    }
    if (!was.current) return;
    was.current = false;
    haptic.success();
    void cancelRest();
  }, [running]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  const share = Math.max(0, Math.min(1, left / Math.max(1, openedWith)));
  const reduce = useReducedMotion();
  const scale = useSharedValue(share);
  const mounted = useRef(false);
  // The clock arrives a second at a time; the bar sweeps between ticks instead of stepping, and it scales rather than
  // resizes, so a second of movement never relayouts the card. A rest opened mid-count snaps to where it is, and so
  // does a jump (a phone that slept, a ±15 press): only one-second steps are worth animating.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      scale.value = share;
      return;
    }
    const jump = Math.abs(share - scale.value) > 2 / Math.max(1, openedWith);
    scale.value = reduce || jump ? share : withTiming(share, { duration: 1000, easing: Easing.linear });
  }, [share, openedWith, reduce, scale]);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));
  if (!running) return null;
  return (
    <View className="absolute inset-x-3 bottom-3 overflow-hidden rounded-2xl bg-card px-4 py-3" style={cardStyle}>
      <View className="flex-row items-center gap-3">
        <Icon icon={Clock} size={18} tone="strain" />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{t("session.rest")}</Text>
          <Text className="font-numeric text-[18px] font-semibold leading-6 tabular-nums">{clockText(left)}</Text>
        </View>
        <Press accessibilityRole="button" accessibilityLabel={t("session.restMinus")} onPress={() => onAdjust(-15)} className="h-9 w-11 items-center justify-center rounded-full bg-secondary">
          <Text className="text-[12px] font-bold tabular-nums">{`-15`}</Text>
        </Press>
        <Press accessibilityRole="button" accessibilityLabel={t("session.restPlus")} onPress={() => onAdjust(15)} className="h-9 w-11 items-center justify-center rounded-full bg-secondary">
          <Text className="text-[12px] font-bold tabular-nums">{`+15`}</Text>
        </Press>
        <Press accessibilityRole="button" onPress={onSkip} className="h-9 items-center justify-center rounded-full bg-secondary px-4">
          <Text className="text-[12px] font-bold uppercase tracking-[0.08em]">{t("session.restSkip")}</Text>
        </Press>
      </View>
      <View className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
        <Animated.View className="h-full w-full rounded-full bg-strain" style={[fill, { transformOrigin: "left" }]} />
      </View>
    </View>
  );
}

/** The session's name. */
function RenameDialog({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (name: string) => void }) {
  const { t } = useTranslation("gym");
  const [text, setText] = useState(initial);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-dim-strong px-4">
        <Pressable onPress={() => {}} className="w-full max-w-[384px] gap-4 rounded-3xl bg-popover p-5">
          <Text className="text-[17px] font-semibold">{t("session.rename")}</Text>
          <Input autoFocus value={text} onChangeText={setText} placeholder={t("session.namePlaceholder")} maxLength={60} />
          <View className="gap-2">
            <Button onPress={() => onSave(text)}>{t("session.save")}</Button>
            <Button variant="outline" onPress={onClose}>
              {i18n.t("common:actions.cancel")}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A set's details: what it was (working, warmup, drop, failure), its RPE, its note, and the way to delete it. */
function NoteDialog({
  number,
  initial,
  type,
  rpe,
  onClose,
  onSave,
  onDelete,
}: {
  number: number;
  initial: string;
  type: SetType;
  rpe: number | null;
  onClose: () => void;
  onSave: (type: SetType, note: string, rpe: number | null) => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation("gym");
  const [text, setText] = useState(initial);
  const [kind, setKind] = useState<SetType>(type);
  const [effort, setEffort] = useState<number | null>(rpe);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-dim-strong px-4">
        <Pressable onPress={() => {}} className="w-full max-w-[384px] gap-4 rounded-3xl bg-popover p-5">
          <Text className="text-[17px] font-semibold">{t("session.setDetails", { number })}</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {(["normal", "warmup", "drop", "failure"] as const).map((option) => (
              <Text
                key={option}
                onPress={() => setKind(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === option }}
                className={cn("h-8 rounded-full px-3 text-center text-[12px] font-medium leading-8", kind === option ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground")}
              >
                {t(`session.${option}`)}
              </Text>
            ))}
          </View>
          <View className="gap-1.5">
            <Text className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{t("session.rpe")}</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
                <Text
                  key={value}
                  onPress={() => setEffort(effort === value ? null : value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: effort === value }}
                  className={cn("h-8 w-9 rounded-full text-center text-[12px] font-medium leading-8", effort === value ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground")}
                >
                  {value}
                </Text>
              ))}
            </View>
          </View>
          <Input multiline value={text} onChangeText={setText} placeholder={t("session.notePlaceholder")} maxLength={240} className="min-h-20" />
          <View className="gap-2">
            <Button onPress={() => onSave(kind, text, effort)}>{t("session.save")}</Button>
            <Button variant="outline" onPress={onClose}>
              {i18n.t("common:actions.cancel")}
            </Button>
            {!!onDelete && (
              <Button variant="ghost" textClassName="text-recovery-red-text" onPress={onDelete}>
                {t("session.delete")}
              </Button>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The workout's own note: an imported Strong note, or how the session felt. */
function NotesDialog({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (text: string) => void }) {
  const { t } = useTranslation("gym");
  const [text, setText] = useState(initial);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-dim-strong px-4">
        <Pressable onPress={() => {}} className="w-full max-w-[384px] gap-4 rounded-3xl bg-popover p-5">
          <Text className="text-[17px] font-semibold">{t("session.notes")}</Text>
          <Input autoFocus multiline value={text} onChangeText={setText} placeholder={t("session.notesPlaceholder")} maxLength={1000} className="min-h-28" />
          <View className="gap-2">
            <Button onPress={() => onSave(text)}>{t("session.save")}</Button>
            <Button variant="outline" onPress={onClose}>
              {i18n.t("common:actions.cancel")}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

async function setUnit(exercise: GymExercise, unit: "kg" | "lb") {
  await setExerciseUnit(actionCtx().store, exercise, unit);
  dataChanged("gym");
}
