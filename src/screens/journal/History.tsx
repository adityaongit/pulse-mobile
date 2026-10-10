import { useState } from "react";
import { Pressable, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { dayLabel } from "@/lib/format";
import type { JournalVM } from "@/queries/types";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { EmptyState } from "@/ui/shells/EmptyState";
import { Text } from "@/ui/Text";
import { TagBadge } from "./CheckInCard";

/** History rows before "Show 30 days": a week. The day strip above already reaches every day of the last three weeks. */
const RECENT = 7;

/** Journal's History (spec §7.11): the days with answers, newest first, each a row that selects that day. */
export function History({ history, day, today, onSelect }: { history: JournalVM["history"]; day: string; today: string; onSelect: (day: string) => void }) {
  const [all, setAll] = useState(false);
  if (!history.length) return <EmptyState body="No check-ins yet. Your first one takes under a minute." action={{ label: "Check in", sheet: "checkin" }} />;
  return (
    <Card className="gap-0 px-4 py-1">
      <View>
        {(all ? history : history.slice(0, RECENT)).map((h, i) => {
          const shown = h.yes.slice(0, 2); // the narrow column fits two tags beside the date
          const more = h.yes.length - shown.length;
          const selected = h.day === day;
          return (
            <View key={h.day} className={cn("border-border", i > 0 && "border-t")}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${dayLabel(h.day, today)}: ${h.yes.length ? h.yes.join(", ") : "no behaviours"}`}
                onPress={() => onSelect(h.day)}
                className="-mx-2 min-h-13 flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-accent"
              >
                {/* The selected day's 3 px marker at the row's left edge. */}
                {selected && <View accessibilityElementsHidden className="absolute inset-y-3.5 left-0 w-[3px] rounded-full bg-foreground" />}
                <Text className="w-28 shrink-0 text-xs font-bold uppercase leading-4 tracking-[0.1em] tabular-nums">{dayLabel(h.day, today)}</Text>
                <View accessibilityElementsHidden className="min-w-0 flex-1 flex-row flex-wrap justify-end gap-1.5">
                  {shown.map((y) => (
                    <TagBadge key={y}>{y}</TagBadge>
                  ))}
                  {more > 0 && <Text className="self-center font-numeric text-[13px] font-semibold tabular-nums text-muted-foreground">+{more}</Text>}
                  {!h.yes.length && <Text className="self-center text-xs font-medium leading-4 text-muted-foreground">No behaviours</Text>}
                </View>
                <Icon icon={ChevronRight} size={16} tone="muted-foreground" strokeWidth={1.75} />
              </Pressable>
            </View>
          );
        })}
      </View>
      {history.length > RECENT && (
        <Pressable accessibilityRole="button" onPress={() => setAll(!all)} className="-mx-2 mb-1 h-11 items-center justify-center rounded-lg border-t border-border active:bg-accent">
          <Text className="text-xs font-bold uppercase tracking-[0.1em] text-foreground/85">{all ? "Show last week" : "Show 30 days"}</Text>
        </Pressable>
      )}
    </Card>
  );
}
