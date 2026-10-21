// More › Behaviours (U21, journal-04..09): choose what the journal asks from the catalogue and your own behaviours, then
// save; add your own. A behaviour left out keeps its past answers, which still count in insights. Ported from pulse
// (app)/more/behaviours/Behaviours.tsx and page.tsx.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, type TextInput } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addCustomTag } from "@/actions/journal";
import { i18n } from "@/i18n/config";
import { actionCtx, dataChanged } from "@/state/app";
import { getBehaviours, MAX_TAGS, tagKey } from "@/queries/journal";
import type { BehavioursVM } from "@/queries/types";
import { Button } from "@/ui/Button";
import { haptic } from "@/ui/haptics";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { TaskSection } from "@/ui/shells/TaskPage";
import { Text } from "@/ui/Text";
import { TextField } from "../settings/controls";
import { toast } from "@/ui/Toast";
import { useScreen } from "../useScreen";
import { BehaviorPicker, saveSelection, shownOf } from "./BehaviorPicker";
import { DURATION } from "@/ui/motion";

function Behaviours({ vm }: { vm: BehavioursVM }) {
  const { t } = useTranslation("more");
  const insets = useSafeAreaInsets();
  const [initial, setInitial] = useState(() => shownOf(vm.tags));
  const [selected, setSelected] = useState(initial);
  // Stored data wins when it changes (after a save or an add), without an effect.
  const [last, setLast] = useState(vm.tags);
  if (vm.tags !== last) {
    setLast(vm.tags);
    const shown = shownOf(vm.tags);
    setInitial(shown);
    setSelected((s) => new Set([...s, ...[...shown].filter((t) => !initial.has(t))]));
  }
  const dirty = selected.size !== initial.size || [...selected].some((t) => !initial.has(t));
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const input = useRef<TextInput>(null);
  // An invalid name keeps focus on the field, so the error under it is read out and fixable in place.
  const invalid = (message: string) => {
    setAddError(message);
    input.current?.focus();
  };

  const save = async () => {
    setSaving(true);
    const e = await saveSelection(selected);
    setSaving(false);
    if (e) return void toast.error(e);
    toast.success(t("behaviours.saved"));
  };

  const add = async () => {
    haptic.tap();
    const name = label.trim();
    if (!name) return;
    if (name.length > 32) return invalid(t("behaviours.tooLong"));
    if (vm.tags.some((t) => t.label.toLowerCase() === name.toLowerCase())) return invalid(t("behaviours.exists"));
    setAdding(true);
    const r = await addCustomTag(actionCtx(), { label: name }).catch(() => ({ ok: false as const, error: "network" }));
    setAdding(false);
    if (!r.ok) return invalid(r.error === i18n.t("errors:journal.tagExists", { tag: tagKey(name) }) ? t("behaviours.exists") : r.error === i18n.t("errors:journal.tooManyBehaviours", { count: MAX_TAGS }) ? t("behaviours.limit") : t("behaviours.addFailed"));
    setAddError(null);
    setLabel("");
    dataChanged();
    toast.success(t("behaviours.added", { name }));
  };

  return (
    <View className="flex-1">
      <DetailShell
        title={t("behaviours.title")}
        bodySkeleton={<LoadingPrimary />}
        primary={
          <View className="w-full gap-6">
            <Text className="text-[15px] leading-[22px] text-foreground-secondary">{t("behaviours.intro")}</Text>
            <BehaviorPicker tags={vm.tags} initial={initial} selected={selected} onChange={setSelected} />
            <SectionShell variant="card" title={t("behaviours.ownTitle")} info={false}>
              <View className="gap-2">
                <Text className="text-[15px] font-medium leading-[22px]">{t("behaviours.addTitle")}</Text>
                <View className="flex-row gap-2">
                  <View className="min-w-0 flex-1">
                    <TextField
                      ref={input}
                      variant="input"
                      accessibilityLabel={t("behaviours.addTitle")}
                      placeholder={t("behaviours.placeholder")}
                      returnKeyType="done"
                      autoCapitalize="sentences"
                      maxLength={32}
                      value={label}
                      onChangeText={(t) => {
                        setLabel(t);
                        setAddError(null);
                      }}
                      onSubmitEditing={add}
                      invalid={!!addError}
                    />
                  </View>
                  {/* "Add" fits beside the field on a phone; the name says what it adds (label in name). */}
                  <Button variant="secondary" disabled={adding || !label.trim()} accessibilityLabel={adding ? undefined : t("behaviours.addLabel")} onPress={add}>
                    {adding ? t("behaviours.adding") : t("behaviours.add")}
                  </Button>
                </View>
                {!!addError && (
                  <Text accessibilityRole="alert" className="text-xs font-medium leading-4 text-recovery-red-text">
                    {addError}
                  </Text>
                )}
              </View>
            </SectionShell>
          </View>
        }
      />
      {/* Pinned over the list once something changed, clear of the round action at the phone's foot. */}
      {(dirty || saving) && (
        <Animated.View entering={FadeInDown.duration(DURATION.base)} exiting={FadeOut.duration(DURATION.fast)} className="absolute inset-x-4" style={{ bottom: Math.max(insets.bottom + 84, 96) }}>
          <Button disabled={saving} onPress={save}>
            {saving ? t("behaviours.saving") : t("behaviours.save")}
          </Button>
        </Animated.View>
      )}
    </View>
  );
}

function LoadingPrimary() {
  const { t } = useTranslation("more");
  return (
  <View accessibilityElementsHidden className="w-full gap-6">
    <Text className="text-[15px] leading-[22px] text-foreground-secondary">{t("behaviours.intro")}</Text>
    <View>
      <Skeleton className="h-12 rounded-xl" />
      <View className="mt-3 h-11 flex-row items-center gap-6 overflow-hidden px-2.5">
        {["w-6", "w-36", "w-36", "w-28"].map((w, i) => (
          <SkeletonText key={i} className={`${w} shrink-0`} />
        ))}
      </View>
      <View className="mt-4">
        <TaskSection>{t("behaviours.selected")}</TaskSection>
      </View>
      <View className="mt-1">
        {Array.from({ length: 9 }, (_, i) => (
          <View key={i} className="min-h-16 flex-row items-center gap-4 py-2">
            <View className="min-w-0 flex-1">
              <SkeletonText lh={24} fs={17} className="w-32" />
              <SkeletonText lh={22} fs={15} className="w-48" />
            </View>
            <Skeleton className="size-7 rounded-lg" />
          </View>
        ))}
      </View>
    </View>
  </View>
  );
}

/** The web's loading.tsx: the intro, the search field, the tabs and the nine default rows under "Selected" (spec §5.19). */
function BehavioursLoading() {
  const { t } = useTranslation("more");
  return (
    <DetailShell
      title={t("behaviours.title")}
      loading
      primary={<LoadingPrimary />}
      bodySkeleton={<LoadingPrimary />}
    />
  );
}

/** Behaviours `/more/behaviours` (U21): manage the journal check-in list. */
export function BehavioursScreen() {
  const { data } = useScreen(getBehaviours, ["behaviours"]);
  return data ? <Behaviours vm={data} /> : <BehavioursLoading />;
}
