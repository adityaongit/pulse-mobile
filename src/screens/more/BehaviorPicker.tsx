// Select Behaviors (journal-04..09). Ticking a row leaves it in place until Save. Removed
// behaviours have their own tab, where they can be restored to the available list.
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Check, Search, Trash2, Undo2 } from "lucide-react-native";
import { saveBehaviors, type BehaviorSelection } from "@/actions/journal";
import { i18n } from "@/i18n/config";
import { MAX_TAGS } from "@/queries/journal";
import { actionCtx, dataChanged } from "@/state/app";
import { behavior, BEHAVIOR_CATEGORIES, BEHAVIORS, type BehaviorCategory, questionOf } from "@/lib/behaviors";
import type { BehavioursVM } from "@/queries/types";
import { alpha } from "@/ui/color";
import { cn } from "@/ui/cn";
import { Gradient } from "@/ui/Gradient";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { TaskSection } from "@/ui/shells/TaskPage";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { TextField } from "../settings/controls";
import type { BehaviorState } from "./behaviorSelection";

type Tab = "all" | BehaviorCategory | "custom" | "removed";
type Item = { key: string; label: string; question: string; category: BehaviorCategory | "custom" };

/** The catalogue A to Z, then the user's own behaviours. */
const itemsOf = (tags: BehavioursVM["tags"]): Item[] => [
  ...BEHAVIORS.map((b) => ({ key: b.key, label: b.label, question: b.question, category: b.category })),
  ...tags.filter((t) => !behavior(t.tag)).map((t) => ({ key: t.tag, label: t.label, question: questionOf(t.tag, t.label), category: "custom" as const })),
];

type PickerProps = {
  tags: BehavioursVM["tags"];
  initial: Set<string>;
  selected: Set<string>;
  removed: Set<string>;
  disabled: boolean;
  onChange: (tag: string, state: BehaviorState) => void;
};

export function BehaviorPicker({ tags, initial, selected, removed, disabled, onChange }: PickerProps) {
  const { t } = useTranslation("more");
  const { c } = useTheme();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const items = itemsOf(tags);
  const tabs: { key: Tab; label: string }[] = [{ key: "all", label: t("behaviours.tabAll") }];
  if (removed.size) tabs.push({ key: "removed", label: t("behaviours.tabRemoved") });
  tabs.push(...BEHAVIOR_CATEGORIES);
  if (items.some((i) => i.category === "custom" && !removed.has(i.key))) tabs.push({ key: "custom", label: t("behaviours.tabYours") });
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "all";
  if (activeTab !== tab) setTab(activeTab);
  const inRemoved = activeTab === "removed";
  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => {
    const inTab = inRemoved ? removed.has(i.key) : !removed.has(i.key) && (activeTab === "all" || i.category === activeTab);
    return inTab && (!q || i.label.toLowerCase().includes(q) || i.question.toLowerCase().includes(q));
  });
  const groups = inRemoved ? [{ key: "removed", title: t("behaviours.tabRemoved"), rows: shown }] : [
    { key: "selected", title: t("behaviours.selected"), rows: shown.filter((i) => initial.has(i.key)) },
    { key: "not-selected", title: t("behaviours.notSelected"), rows: shown.filter((i) => !initial.has(i.key)) },
  ];

  return (
    <View>
      <TextField
        variant="search"
        accessibilityLabel={t("behaviours.search")}
        placeholder={t("behaviours.search")}
        returnKeyType="search"
        autoCapitalize="none"
        value={query}
        onChangeText={setQuery}
        left={
          <View className="w-11 justify-center pl-3.5" pointerEvents="none">
            <Icon icon={Search} size={20} tone="muted-foreground" strokeWidth={1.75} />
          </View>
        }
      />
      {/* Category tabs in one scrolling row, the chosen one underlined (journal-04, journal-06). */}
      <View className="mt-3 -mx-4">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" contentContainerClassName="gap-1 px-4">
          {tabs.map((t) => {
            const on = t.key === activeTab;
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  if (on) return;
                  haptic.select();
                  setTab(t.key);
                }}
                className="h-11 justify-center px-2"
              >
                <Text className={cn("text-xs font-bold uppercase leading-4 tracking-[0.1em]", on ? "text-foreground" : "text-muted-foreground")}>{t.label}</Text>
                <View className={cn("absolute inset-x-2.5 bottom-1.5 h-0.5 rounded-full bg-foreground", !on && "opacity-0")} />
              </Pressable>
            );
          })}
        </ScrollView>
      {/* The web masks the row's last 32 px to transparent ([mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]); there is no mask view, so the ground fades over it. */}
      <View pointerEvents="none" className="absolute inset-y-0 right-0 w-8">
        <Gradient from={alpha(c["background-mid"], 0)} to={c["background-mid"]} />
      </View>
      </View>
      {shown.length === 0 && <Text className="py-8 text-center text-[15px] leading-[22px] text-foreground-secondary">{t("behaviours.noMatch", { query: query.trim() })}</Text>}
      {groups.map(
        (g) =>
          g.rows.length > 0 && (
            <View key={g.key} accessibilityLabel={g.title} className="mt-4">
              <TaskSection>{g.title}</TaskSection>
              <View className="mt-1">
                {g.rows.map((i) => {
                  const on = selected.has(i.key);
                  return (
                    <View key={i.key} className="flex-row items-center gap-1">
                      <Pressable
                        disabled={disabled}
                        accessibilityRole={inRemoved ? "button" : "checkbox"}
                        accessibilityState={inRemoved ? { disabled } : { checked: on, disabled }}
                        accessibilityLabel={inRemoved ? t("behaviours.restoreLabel", { name: i.label }) : `${i.label}. ${i.question}`}
                        onPress={() => {
                          haptic.select();
                          const checked = inRemoved ? initial.has(i.key) : !on;
                          onChange(i.key, checked ? "selected" : "unselected");
                        }}
                        className="min-h-16 flex-1 flex-row items-center gap-4 py-2"
                      >
                        <View className="min-w-0 flex-1">
                          <Text className="text-[17px] font-semibold leading-6">{i.label}</Text>
                          <Text className="text-[15px] leading-[22px] text-muted-foreground">{i.question}</Text>
                        </View>
                        {inRemoved ? (
                          <Icon icon={Undo2} size={20} tone="muted-foreground" />
                        ) : (
                          <View className={cn("size-7 items-center justify-center rounded-lg border-2", on ? "border-answer-yes bg-answer-yes" : "border-foreground/80")}>
                            {on && <Icon icon={Check} size={16} tone="on-color" strokeWidth={3} />}
                          </View>
                        )}
                      </Pressable>
                      {!inRemoved && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("behaviours.removeLabel", { name: i.label })}
                          accessibilityState={{ disabled }}
                          disabled={disabled}
                          onPress={() => { haptic.select(); onChange(i.key, "removed"); }}
                          className="size-11 items-center justify-center"
                        >
                          <Icon icon={Trash2} size={18} tone="muted-foreground" />
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ),
      )}
    </View>
  );
}

/** Saves a selection; the error copy the two hosts show. */
export async function saveSelection(selection: BehaviorSelection): Promise<string | null> {
  const r = await saveBehaviors(actionCtx(), selection).catch(() => ({ ok: false as const, error: "network" }));
  if (r.ok) dataChanged();
  return r.ok ? null : r.error === i18n.t("errors:journal.tooManyBehaviours", { count: MAX_TAGS }) ? i18n.t("more:behaviours.tooMany") : i18n.t("more:behaviours.saveFailed");
}
