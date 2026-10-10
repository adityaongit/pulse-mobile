import { View } from "react-native";
import type { JournalVM } from "@/queries/types";
import { Button } from "@/ui/Button";
import { StatusChip } from "@/ui/metrics/primitives";
import { SectionShell } from "@/ui/shells/SectionShell";
import { openSheet } from "@/ui/shells/sheets";
import { Text } from "@/ui/Text";

/** The pill of a behaviour: 28 px, secondary fill, 13 px semibold (the web's Badge with TAG_CLASS). */
export function TagBadge({ children }: { children: string }) {
  return (
    <View className="h-7 items-center justify-center rounded-full bg-secondary px-3">
      <Text className="text-[13px] font-semibold text-secondary-foreground">{children}</Text>
    </View>
  );
}

/** The Journal's check-in card (spec §7.11, journey 7). Its button opens the app-wide check-in sheet. */
export function CheckInCard({ dayLabel, day, today, checkIn }: { dayLabel: string; day: string; today: string; checkIn: JournalVM["checkIn"] }) {
  const start = () => openSheet(day === today ? "/checkin" : `/checkin?d=${day}`);
  // The section above is headed "Check-in", so the card is titled by its day, as History's rows are (SYM2).
  return (
    <SectionShell variant="card" title={dayLabel} fill>
      {checkIn.done ? (
        <View className="flex-1 gap-4">
          {/* Status and the day's behaviours on one wrapping line. */}
          <View className="flex-row flex-wrap items-center gap-2">
            <StatusChip tone="optimal">Checked in</StatusChip>
            {checkIn.yes.length > 0 && (
              <View accessibilityLabel="Behaviours logged" className="flex-row flex-wrap gap-2">
                {checkIn.yes.map((y) => (
                  <TagBadge key={y.tag}>{y.label}</TagBadge>
                ))}
              </View>
            )}
          </View>
          {/* Full width at the card's foot, as Check in and Home's card buttons are (SYM3). */}
          <Button variant="secondary" className="mt-auto w-full" onPress={start}>
            Edit check-in
          </Button>
        </View>
      ) : (
        <View className="flex-1 gap-4">
          <Text className="max-w-[65ch] text-[15px] leading-[22px] text-foreground-secondary">Log what you did today. Pulse compares it with tomorrow’s Recovery.</Text>
          <Button className="mt-auto w-full" onPress={start}>
            Check in
          </Button>
        </View>
      )}
    </SectionShell>
  );
}
