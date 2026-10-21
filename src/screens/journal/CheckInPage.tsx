// The Journal (spec §7.11, journal-01..15), pulse's (app)/journal/CheckIn.tsx `CheckInPage`: the full-screen check-in
// over whatever screen is showing, for that screen's day (`d`); the strip and arrows inside move between days. Closing it
// (X, Back, swipe down, Save) leaves that screen as it was (spec §11 UX2). There is no offline queue (the phone
// writes to its own database, so a save cannot be "offline") and Select Behaviors is not a dialog (the pencil opens
// Settings' behaviours screen).
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Pencil, X } from "lucide-react-native";
import { addCustomTag, loadCheckIn, saveCheckIn } from "@/actions/journal";
import { actionCtx, dataChanged, queryCtx, refresh } from "@/state/app";
import { behavior, followUpText, JOURNAL_SECTIONS, questionOf, type JournalSection } from "@/lib/behaviors";
import { DAY, dayLabel, formatDay, MISSING } from "@/lib/format";
import { addDays, parseDay } from "@/lib/url";
import type { JournalTag, JournalVM } from "@/queries/types";
import { FormAlert, Input } from "@/screens/log/fields";
import { alpha } from "@/ui/color";
import { Button } from "@/ui/Button";
import { haptic } from "@/ui/haptics";
import { DayStrip } from "@/ui/metrics/DayStrip";
import { TaskPage, TaskSection } from "@/ui/shells/TaskPage";
import { useShellCalendar } from "@/ui/shells/ShellStatus";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { changedEntries, heading, type Values } from "./checkin";
import { DismissDialog, dismissIsQuiet } from "./DismissDialog";
import { Slider } from "./Slider";
import { goBack, push } from "@/ui/navigate";
import { Press } from "@/ui/Press";

/** A behaviour with the question the check-in asks and its section, from the catalogue (src/lib/behaviors.ts). */
type Tag = JournalTag & { question: string; section: JournalSection };
type Loaded = { day: string; tags: Tag[] } & Pick<JournalVM, "checkIn" | "strip">;
const withQuestion = (t: JournalTag): Tag => ({ ...t, question: questionOf(t.tag, t.label), section: behavior(t.tag)?.section ?? "custom" });

/**
 * The Store keeps a yes, a no or a count per behaviour (halo's journal_entries): no follow-up values and no notes. The
 * follow-up sliders and the Notes field stay in the code but are not shown.
 */
const DETAILS = false;
type Confirm = { to: string | null };

function Spinner() {
  const { c } = useTheme();
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1);
  }, [turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <LoaderCircle size={20} color={c["muted-foreground"]} strokeWidth={2} />
    </Animated.View>
  );
}

/** journal-01's answer key: a grey square; "no" lights white, "yes" blue. 44 px for touch. */
function Answer({ kind, on, label, onPress }: { kind: "no" | "yes"; on: boolean; label: string; onPress: () => void }) {
  const { c } = useTheme();
  const bg = on ? (kind === "yes" ? c["answer-yes"] : c.foreground) : c["fill-pressed"];
  const fg = on ? (kind === "yes" ? c["on-color"] : c.background) : alpha(c.foreground, 0.8);
  const Glyph = kind === "yes" ? Check : X;
  return (
    <Press activeScale={0.96} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress} className="size-11 items-center justify-center rounded-lg" style={{ backgroundColor: bg }}>
      <Glyph size={18} color={fg} strokeWidth={3} />
    </Press>
  );
}

/** /checkin?d=2026-10-02: the sheet the round check-in button opens. `d` is the screen's day (today when absent). */
export function CheckInPage() {
  const { t: tr } = useTranslation("journal");
  const { today } = useShellCalendar();
  const { d: raw } = useLocalSearchParams<{ d?: string }>();
  const { d: urlDay } = parseDay(raw, today);
  const navigation = useNavigation();
  const [day, setDay] = useState(urlDay);
  const [data, setData] = useState<Loaded | null>(null);
  // keep: reload the questions only (after Select Behaviors), leaving the answers being entered alone.
  const [request, setRequest] = useState<{ day: string; n: number; keep?: boolean }>({ day: urlDay, n: 0 });
  const [loadError, setLoadError] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [details, setDetails] = useState<Values>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [done, setDone] = useState(false);
  // The Dismiss journal? dialog: open, and the day to go to once dismissed (null: close the journal).
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [label, setLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const input = useRef<TextInput>(null);
  const allow = useRef(false);
  const picked = useRef(false);
  const { c } = useTheme();

  const loaded = data?.day === day ? data : null;
  const tags = loaded?.tags ?? [];
  const saved = loaded?.checkIn.entries ?? {};
  const savedDetails: Record<string, number> = {};
  const dirty = !!loaded && (changedEntries(values, details, saved, savedDetails).length > 0 || note.trim() !== "");

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => loadCheckIn(queryCtx(), request.day))
      .then((r) => {
        if (!live) return;
        if (!r.ok) return setLoadError(true);
        setData({ day: request.day, ...r.data, tags: r.data.tags.map(withQuestion) });
        if (request.keep) return;
        setValues({ ...r.data.checkIn.entries });
        setDetails({});
        setNote("");
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [request]);

  const load = (to: string) => {
    setDay(to);
    setLoadError(false);
    setSaveError(false);
    setRequest((r) => ({ day: to, n: r.n + 1 }));
  };

  // Back to this sheet from Settings' behaviours: ask the questions again, keeping the answers entered.
  useFocusEffect(
    useCallback(() => {
      if (!picked.current) return;
      picked.current = false;
      setRequest((r) => ({ day, n: r.n + 1, keep: true }));
    }, [day]),
  );

  const finish = () => {
    allow.current = true;
    setConfirm(null);
    goBack();
  };

  // Back and the swipe down ask first when answers would be lost (journal-15); the X always asks, below.
  const guard = dirty && !saving && !done;
  useEffect(
    () =>
      navigation.addListener("beforeRemove", (e) => {
        if (allow.current || !guard) return;
        e.preventDefault();
        setConfirm({ to: null });
      }),
    [navigation, guard],
  );
  useEffect(() => {
    // A swipe down must not slip past the guard where the platform cannot be told in time.
    navigation.setOptions({ gestureEnabled: !guard });
  }, [navigation, guard]);

  const keepEditing = () => setConfirm(null);
  const dismiss = () => {
    const to = confirm?.to;
    if (to) {
      setConfirm(null);
      load(to);
    } else finish();
  };
  // The reference app asks on every X (journal-15) until "Don't show me this message again"; a day switch asks only
  // when it would drop answers.
  const close = () => {
    if (saving) return;
    if (done || dismissIsQuiet()) return finish();
    setConfirm({ to: null });
  };
  const go = (to: string) => {
    if (to === day || to > today) return;
    if (dirty) setConfirm({ to });
    else load(to);
  };

  // An invalid name keeps focus on the field, so the error under it is read out and fixable in place.
  const invalid = (message: string) => {
    setAddError(message);
    input.current?.focus();
  };

  const save = async () => {
    if (!loaded) return;
    setSaving(true);
    setSaveError(false);
    const changes = changedEntries(values, details, saved, savedDetails);
    const r = await saveCheckIn(actionCtx(), loaded.day, changes).catch(() => ({ ok: false as const }));
    setSaving(false);
    if (!r.ok) {
      haptic.error();
      return setSaveError(true);
    }
    // The check-in feeds stage 2 (journal impact, Insights, the Monitor's context): rescore, as halo does.
    dataChanged();
    void refresh();
    setDone(true); // the Saved screen plays the success haptic
  };

  const add = async () => {
    const name = label.trim();
    if (!name) return;
    if (name.length > 32) return invalid(tr("checkIn.errLength"));
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (tags.some((t) => t.tag === key || t.label.toLowerCase() === name.toLowerCase())) return invalid(tr("checkIn.errExists"));
    setAdding(true);
    const r = await addCustomTag(actionCtx(), { label: name }).catch(() => ({ ok: false as const, error: "network" }));
    setAdding(false);
    if (!r.ok) return invalid(r.error.startsWith("Tag already exists") ? tr("checkIn.errExists") : r.error.startsWith("Too many") ? tr("checkIn.errLimit") : tr("checkIn.errAdd"));
    setAddError(null);
    setLabel("");
    // A new behaviour starts as "Yes": you add one because you just did it. It joins the list until the next load.
    setData((d) => d && { ...d, tags: [...d.tags, withQuestion({ tag: r.data.tag, label: name, group: "custom", isDefault: false, hidden: false })] });
    setValues((v) => ({ ...v, [r.data.tag]: 1 }));
  };

  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const answer = (tag: string, to: number | undefined) => {
    haptic.toggle(to === 1);
    setValues((s) => ({ ...s, [tag]: to }));
  };

  return (
    <>
      <TaskPage
        title={tr("checkIn.title")}
        glow
        onClose={close}
        action={
          <Press
            activeBg="bg-fill-hover"
            accessibilityRole="button"
            accessibilityLabel={tr("checkIn.selectBehaviours")}
            onPress={() => {
              haptic.tap();
              picked.current = true;
              push("/more/behaviours");
            }}
            className="size-11 items-center justify-center rounded-full"
          >
            <Pencil size={22} color={c.foreground} strokeWidth={1.75} />
          </Press>
        }
        done={done ? { title: tr("checkIn.saved"), body: tr("checkIn.savedBody"), onDone: finish } : null}
        footer={
          <>
            {saveError && <FormAlert>{tr("checkIn.saveFailed")}</FormAlert>}
            {/* Nothing answered, nothing to save: the sheet can open by itself (Log yesterday) right where the Journal tab was
                tapped, and a second tap must not file an empty check-in. */}
            <Button onPress={save} disabled={saving || !loaded || !dirty}>
              {saving ? tr("checkIn.saving") : tr("checkIn.save")}
            </Button>
          </>
        }
      >
        {/* ‹ TODAY ›: a day back or forward; never past today (journal-01). */}
        <View accessibilityRole="toolbar" accessibilityLabel={tr("checkIn.dayToolbar")} className="flex-row items-center justify-center gap-2">
          <Button variant="ghost" size="icon-touch" accessibilityLabel={tr("checkIn.previousDay", { day: formatDay(prev, DAY.long) })} onPress={() => go(prev)}>
            <ChevronLeft size={20} color={c.foreground} strokeWidth={2} />
          </Button>
          <Text className="min-w-28 text-center text-xs font-bold uppercase leading-4 tracking-[0.1em]">{dayLabel(day, today)}</Text>
          <Button variant="ghost" size="icon-touch" accessibilityLabel={tr("checkIn.nextDay", { day: formatDay(next, DAY.long) })} disabled={next > today} onPress={() => go(next)}>
            <ChevronRight size={20} color={c.foreground} strokeWidth={2} />
          </Button>
        </View>
        {data && (
          <View className="-mx-4 mt-2">
            <DayStrip indicator="journal" variant="pill" value={day} onSelect={go} days={data.strip.map((s) => ({ date: s.day, done: s.done }))} />
          </View>
        )}
        {/* The web caps the line at 16ch; React Native has no ch unit, so 285 px is 16 zeros of Figtree at 30 px. */}
        <Text className="mt-6 text-[30px] font-semibold leading-9 tracking-[-0.01em]" style={{ maxWidth: 285 }}>
          {heading(day, today)}
        </Text>

        {!loaded &&
          (loadError ? (
            <View className="mt-6">
              <FormAlert>
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="shrink text-sm leading-5 text-recovery-red-text">{tr("checkIn.loadFailed")}</Text>
                  <Button variant="secondary" onPress={() => load(day)}>
                    {tr("actions.tryAgain", { ns: "common" })}
                  </Button>
                </View>
              </FormAlert>
            </View>
          ) : (
            <View accessibilityRole="progressbar" accessibilityLabel={tr("checkIn.loading")} className="items-center py-16">
              <Spinner />
            </View>
          ))}
        {loaded &&
          JOURNAL_SECTIONS.map((g) => {
            const items = tags.filter((t) => t.section === g.key);
            if (!items.length && g.key !== "custom") return null;
            return (
              <View key={g.key} className="mt-7">
                <TaskSection>{g.title}</TaskSection>
                <View className="mt-3 gap-3">
                  {items.map((t) => {
                    const v = values[t.tag];
                    const f = behavior(t.tag)?.followUp;
                    const d = details[t.tag];
                    return (
                      <View key={t.tag} className="rounded-2xl bg-foreground/[0.07] px-4">
                        <View className="min-h-18 flex-row items-center gap-3 py-3">
                          <Text className="min-w-0 flex-1 text-[17px] leading-6">{t.question}</Text>
                          <View accessibilityRole="radiogroup" accessibilityLabel={t.question} className="flex-row gap-2">
                            <Answer kind="no" label={tr("checkIn.no")} on={v === 0} onPress={() => answer(t.tag, v === 0 ? undefined : 0)} />
                            <Answer kind="yes" label={tr("checkIn.yes")} on={v !== undefined && v > 0} onPress={() => answer(t.tag, v !== undefined && v > 0 ? undefined : 1)} />
                          </View>
                        </View>
                        {/* journal-12: a "yes" opens its follow-up; "--" until the slider moves. */}
                        {DETAILS && f && v !== undefined && v > 0 && (
                          <View className="border-t border-border pb-1 pt-3">
                            <View className="flex-row items-baseline justify-between gap-3 px-2">
                              <Text className="shrink text-[15px] leading-[22px] text-foreground-secondary">{f.question}</Text>
                              <Text className="font-numeric text-[15px] font-semibold leading-[22px] tabular-nums">{d === undefined ? MISSING : followUpText(f, d)}</Text>
                            </View>
                            <View className="px-2">
                              <Slider label={f.question} valueText={d === undefined ? tr("checkIn.notSet") : followUpText(f, d)} min={f.min} max={f.max} step={f.step} value={d ?? f.min} onChange={(x) => setDetails((s) => ({ ...s, [t.tag]: x }))} />
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
                {g.key === "custom" && (
                  <View className="mt-4 gap-2">
                    <Text className="text-[15px] font-medium leading-[22px]">{tr("checkIn.addTitle")}</Text>
                    <View className="flex-row gap-2">
                      <Input
                        ref={input}
                        accessibilityLabel={tr("checkIn.addTitle")}
                        returnKeyType="done"
                        value={label}
                        onChangeText={(t) => {
                          setLabel(t);
                          setAddError(null);
                        }}
                        onSubmitEditing={() => void add()}
                        placeholder={tr("checkIn.addPlaceholder")}
                        maxLength={32}
                        className="flex-1 text-base"
                      />
                      {/* "Add" fits beside the field on a phone; the name says what it adds (label in name). */}
                      <Button variant="secondary" disabled={adding || !label.trim()} accessibilityLabel={adding ? undefined : tr("checkIn.addLabel")} onPress={() => void add()}>
                        {adding ? tr("checkIn.adding") : tr("checkIn.add")}
                      </Button>
                    </View>
                    {!!addError && (
                      <Text accessibilityRole="alert" className="text-xs font-medium leading-4 text-recovery-red-text">
                        {addError}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        {DETAILS && loaded && (
          <View className="mt-7">
            <TaskSection>{tr("checkIn.notes")}</TaskSection>
            <Input
              accessibilityLabel={tr("checkIn.notes")}
              value={note}
              onChangeText={setNote}
              placeholder={tr("checkIn.notePlaceholder")}
              maxLength={2000}
              multiline
              textAlignVertical="top"
              className="mt-3 min-h-14 w-full rounded-2xl border-border px-4 py-3.5"
              style={{ lineHeight: 24 }}
            />
          </View>
        )}
      </TaskPage>
      <DismissDialog open={!!confirm} onKeep={keepEditing} onDismiss={dismiss} />
    </>
  );
}
