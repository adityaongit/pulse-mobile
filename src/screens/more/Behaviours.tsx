// More › Behaviours (U21, journal-04..09): choose what the journal asks from the catalogue and your own behaviours, then
// save; add your own. A behaviour left out keeps its past answers, which still count in insights. Ported from pulse
// (app)/more/behaviours/Behaviours.tsx and page.tsx.
import { useRef, useState } from "react";
import { View, type TextInput } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addCustomTag } from "@/actions/journal";
import { store } from "@/data/store";
import { getBehaviours } from "@/queries/journal";
import type { BehavioursVM } from "@/queries/types";
import { Button } from "@/ui/Button";
import { haptic } from "@/ui/haptics";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { SheetSection } from "@/ui/shells/SheetScreen";
import { Text } from "@/ui/Text";
import { TextField } from "../settings/controls";
import { toast } from "@/ui/Toast";
import { useScreen } from "../useScreen";
import { BehaviorPicker, saveSelection, shownOf } from "./BehaviorPicker";

const INTRO = "Choose what your journal asks. A behaviour you leave out keeps its past answers, and they still count in your insights.";

function Behaviours({ vm }: { vm: BehavioursVM }) {
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
    toast.success("Behaviours saved");
  };

  const add = async () => {
    haptic.tap();
    const name = label.trim();
    if (!name) return;
    if (name.length > 32) return invalid("Use 32 characters or fewer.");
    if (vm.tags.some((t) => t.label.toLowerCase() === name.toLowerCase())) return invalid("That behaviour already exists.");
    setAdding(true);
    const r = await addCustomTag(store, { label: name }).catch(() => ({ ok: false as const, error: "network" }));
    setAdding(false);
    if (!r.ok) return invalid(r.error.startsWith("Tag already exists") ? "That behaviour already exists." : r.error.startsWith("Too many") ? "You’ve reached the behaviour limit." : "Couldn’t add it. Try again.");
    setAddError(null);
    setLabel("");
    toast.success(`${name} added`);
  };

  return (
    <View className="flex-1">
      <DetailShell
        title="Behaviours"
        primary={
          <View className="w-full gap-6">
            <Text className="text-[15px] leading-[22px] text-foreground-secondary">{INTRO}</Text>
            <BehaviorPicker tags={vm.tags} initial={initial} selected={selected} onChange={setSelected} />
            <SectionShell variant="card" title="Your own">
              <View className="gap-2">
                <Text className="text-[15px] font-medium leading-[22px]">Add a behaviour</Text>
                <View className="flex-row gap-2">
                  <View className="min-w-0 flex-1">
                    <TextField
                      ref={input}
                      variant="input"
                      accessibilityLabel="Add a behaviour"
                      placeholder="e.g. Cold shower…"
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
                  <Button variant="secondary" disabled={adding || !label.trim()} accessibilityLabel={adding ? undefined : "Add behaviour"} onPress={add}>
                    {adding ? "Adding…" : "Add"}
                  </Button>
                </View>
                {addError && (
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
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(150)} className="absolute inset-x-4" style={{ bottom: Math.max(insets.bottom + 84, 96) }}>
          <Button size="sheet" disabled={saving} onPress={save}>
            {saving ? "Saving…" : "Save behaviours"}
          </Button>
        </Animated.View>
      )}
    </View>
  );
}

/** The web's loading.tsx: the intro, the search field, the tabs and the nine default rows under "Selected" (spec §5.19). */
function BehavioursLoading() {
  return (
    <DetailShell
      title="Behaviours"
      loading
      primary={
        <View accessibilityElementsHidden className="w-full gap-6">
          <Text className="text-[15px] leading-[22px] text-foreground-secondary">{INTRO}</Text>
          <View>
            <Skeleton className="h-12 rounded-xl" />
            <View className="mt-3 h-11 flex-row items-center gap-6 overflow-hidden px-2.5">
              {["w-6", "w-36", "w-36", "w-28"].map((w, i) => (
                <SkeletonText key={i} className={`${w} shrink-0`} />
              ))}
            </View>
            <View className="mt-4">
              <SheetSection>Selected</SheetSection>
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
      }
    />
  );
}

/** Behaviours `/more/behaviours` (U21): manage the journal check-in list. */
export function BehavioursScreen() {
  const { data } = useScreen(getBehaviours, []);
  return data ? <Behaviours vm={data} /> : <BehavioursLoading />;
}
