// Select Behaviors (journal-04..09). Ported from pulse (app)/more/behaviours/SelectBehaviors.tsx (`BehaviorPicker`,
// `shownOf`, `saveSelection`): search, category tabs, then the chosen behaviours above a "Not selected" rule, each a name,
// its daily question and a checkbox. The two groups are split as the picker opened, so ticking a row doesn't move it.
// Nothing is written until the host saves `selected`. (The Journal's pencil sheet over the check-in is the Journal stream's.)
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Check, Search } from "lucide-react-native";
import { saveBehaviors } from "@/actions/journal";
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

type Tab = "all" | BehaviorCategory | "custom";
type Item = { key: string; label: string; question: string; category: BehaviorCategory | "custom" };

/** The catalogue A to Z, then the user's own behaviours. */
const itemsOf = (tags: BehavioursVM["tags"]): Item[] => [
  ...BEHAVIORS.map((b) => ({ key: b.key, label: b.label, question: b.question, category: b.category })),
  ...tags.filter((t) => !behavior(t.tag)).map((t) => ({ key: t.tag, label: t.label, question: questionOf(t.tag, t.label), category: "custom" as const })),
];

/** What the journal asks today: every behaviour the user has and hasn't hidden. */
export const shownOf = (tags: BehavioursVM["tags"]) => new Set(tags.filter((t) => !t.hidden).map((t) => t.tag));

export function BehaviorPicker({ tags, initial, selected, onChange }: { tags: BehavioursVM["tags"]; initial: Set<string>; selected: Set<string>; onChange: (next: Set<string>) => void }) {
  const { t } = useTranslation("more");
  const { c } = useTheme();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const items = itemsOf(tags);
  const tabs: { key: Tab; label: string }[] = [{ key: "all", label: t("behaviours.tabAll") }, ...BEHAVIOR_CATEGORIES, ...(items.some((i) => i.category === "custom") ? [{ key: "custom" as const, label: t("behaviours.tabYours") }] : [])];
  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => (tab === "all" || i.category === tab) && (!q || i.label.toLowerCase().includes(q) || i.question.toLowerCase().includes(q)));
  const groups = [
    { key: "selected", title: t("behaviours.selected"), rows: shown.filter((i) => initial.has(i.key)) },
    { key: "not-selected", title: t("behaviours.notSelected"), rows: shown.filter((i) => !initial.has(i.key)) },
  ];
  const toggle = (key: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    onChange(next);
  };

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
            const on = t.key === tab;
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
                    <Pressable
                      key={i.key}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${i.label}. ${i.question}`}
                      onPress={() => {
                        haptic.select();
                        toggle(i.key, !on);
                      }}
                      className="min-h-16 flex-row items-center gap-4 py-2"
                    >
                      <View className="min-w-0 flex-1">
                        <Text className="text-[17px] font-semibold leading-6">{i.label}</Text>
                        <Text className="text-[15px] leading-[22px] text-muted-foreground">{i.question}</Text>
                      </View>
                      <View className={cn("size-7 items-center justify-center rounded-lg border-2", on ? "border-answer-yes bg-answer-yes" : "border-foreground/80")}>
                        {on && <Icon icon={Check} size={16} tone="on-color" strokeWidth={3} />}
                      </View>
                    </Pressable>
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
export async function saveSelection(selected: Set<string>): Promise<string | null> {
  const r = await saveBehaviors(actionCtx(), { tags: [...selected] }).catch(() => ({ ok: false as const, error: "network" }));
  if (r.ok) dataChanged();
  return r.ok ? null : r.error === i18n.t("errors:journal.tooManyBehaviours", { count: MAX_TAGS }) ? i18n.t("more:behaviours.tooMany") : i18n.t("more:behaviours.saveFailed");
}
