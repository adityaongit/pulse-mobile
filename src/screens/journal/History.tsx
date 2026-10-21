import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { dayLabel } from "@/lib/format";
import type { JournalVM } from "@/queries/types";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { EmptyState } from "@/ui/shells/EmptyState";
import { Text } from "@/ui/Text";
import { TagBadge } from "./CheckInCard";
import { Press } from "@/ui/Press";

/** History rows before "Show 30 days": a week. The day strip above already reaches every day of the last three weeks. */
const RECENT = 7;
/** At most two tags beside the date, the rest as "+N". */
const MAX_TAGS = 2;
const GAP = 6;
const PLUS_W = 28;

/**
 * A history row's tags on one line: two when both fit beside the date, else one, then "+N". The tags are measured once in
 * an invisible copy, so the count follows the phone's width and the tag names.
 */
function FitTags({ tags }: { tags: string[] }) {
  const [room, setRoom] = useState(0);
  const [widths, setWidths] = useState<number[]>([]);
  const candidates = tags.slice(0, MAX_TAGS);
  const measured = room > 0 && candidates.every((_, i) => widths[i] > 0);
  let count = candidates.length;
  if (measured) {
    const need = (k: number) => widths.slice(0, k).reduce((a, b) => a + b, 0) + GAP * (k - 1) + (tags.length > k ? GAP + PLUS_W : 0);
    while (count > 1 && need(count) > room) count--;
  }
  const more = tags.length - count;
  return (
    <View accessibilityElementsHidden className="min-w-0 flex-1 flex-row justify-end gap-1.5 overflow-hidden" onLayout={(e) => setRoom(e.nativeEvent.layout.width)}>
      <View pointerEvents="none" className="absolute flex-row gap-1.5 opacity-0">
        {candidates.map((t, i) => (
          <View key={t} className="shrink-0" onLayout={(e) => { const w = e.nativeEvent.layout.width; setWidths((ws) => (ws[i] === w ? ws : Object.assign([...ws], { [i]: w }))); }}>
            <TagBadge>{t}</TagBadge>
          </View>
        ))}
      </View>
      {measured &&
        candidates.slice(0, count).map((t) => (
          <View key={t} className="shrink-0">
            <TagBadge>{t}</TagBadge>
          </View>
        ))}
      {measured && more > 0 && <Text className="shrink-0 self-center font-numeric text-[13px] font-semibold tabular-nums text-muted-foreground">+{more}</Text>}
    </View>
  );
}

/** Journal's History (spec §7.11): the days with answers, newest first, each a row that selects that day. */
export function History({ history, day, today, onSelect }: { history: JournalVM["history"]; day: string; today: string; onSelect: (day: string) => void }) {
  const { t } = useTranslation("journal");
  const [all, setAll] = useState(false);
  if (!history.length) return <EmptyState body={t("history.empty")} action={{ label: t("actions.checkIn", { ns: "common" }), sheet: "checkin" }} />;
  return (
    <Card className="gap-0 px-4 py-1">
      <View>
        {(all ? history : history.slice(0, RECENT)).map((h, i) => {
          const selected = h.day === day;
          return (
            <View key={h.day} className={cn("border-border", i > 0 && "border-t")}>
              <Press
                activeBg="bg-accent"
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={t("history.row", { day: dayLabel(h.day, today), behaviours: h.yes.length ? h.yes.join(", ") : t("history.noneSpoken") })}
                onPress={() => onSelect(h.day)}
                className="-mx-2 min-h-13 flex-row items-center gap-3 rounded-lg px-2 py-2"
              >
                {/* The selected day's 3 px marker at the row's left edge. */}
                {selected && <View accessibilityElementsHidden className="absolute inset-y-3.5 left-0 w-[3px] rounded-full bg-foreground" />}
                <Text className="w-28 shrink-0 text-xs font-bold uppercase leading-4 tracking-[0.1em] tabular-nums">{dayLabel(h.day, today)}</Text>
                {h.yes.length ? (
                  <FitTags tags={h.yes} />
                ) : (
                  <View accessibilityElementsHidden className="min-w-0 flex-1 flex-row justify-end">
                    <Text className="text-xs font-medium leading-4 text-muted-foreground">{t("history.none")}</Text>
                  </View>
                )}
                <Icon icon={ChevronRight} size={16} tone="muted-foreground" strokeWidth={1.75} />
              </Press>
            </View>
          );
        })}
      </View>
      {history.length > RECENT && (
        <Press activeBg="bg-accent" accessibilityRole="button" onPress={() => setAll(!all)} className="-mx-2 mb-1 h-11 items-center justify-center rounded-lg border-t border-border">
          <Text className="text-xs font-bold uppercase tracking-[0.1em] text-foreground-body">{all ? t("history.showWeek") : t("history.show30")}</Text>
        </Press>
      )}
    </Card>
  );
}
