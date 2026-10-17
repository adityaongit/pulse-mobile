// Journal's Log tiles (spec §11 LG1), pulse's (app)/journal/Log.tsx without its sheet (that is app/log.tsx):
// one tile per thing to log, with the day's figure, each opening its sheet. A row that scrolls edge to edge, as the
// day strip above it.
import { ScrollView, View } from "react-native";
import { CalendarHeart, Droplet, FlaskConical, HeartPulse, Plus, Scale, Smile, Thermometer, Utensils, type LucideIcon } from "lucide-react-native";
import { DAY, formatDay, quantityText } from "@/lib/format";
import { KIND_LABEL, MOODS, VALENCES, type LogData, type LogKind } from "@/queries/log";
import type { DayLogVM as LogVM } from "@/queries/journalExtras";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Press } from "@/ui/Press";
import { push } from "@/ui/navigate";

export const ICON: Record<LogKind, LucideIcon> = {
  water: Droplet,
  food: Utensils,
  weight: Scale,
  spo2: HeartPulse,
  mood: Smile,
  symptoms: Thermometer,
  period: CalendarHeart,
  ovulation: FlaskConical,
};

const n = (v: number) => v.toLocaleString("en-US");
const MOOD_LABEL = Object.fromEntries([...MOODS, ...VALENCES].map(([v, l]) => [v, l]));

/** Each tile's figure for the day shown: a total, the latest reading, or nothing yet. */
function tileValue(k: LogKind, vm: LogVM): { value: string; sub?: string } | null {
  switch (k) {
    case "water":
      return vm.water.total ? { value: quantityText(vm.water.total, "ml", "grouped") } : { value: "None" };
    case "food":
      return vm.food.kcal ? { value: `${n(vm.food.kcal)} kcal` } : { value: "None" };
    case "weight": {
      const w = vm.body.latest;
      return w ? { value: quantityText(w.kg, "kg", "decimal1"), sub: w.day === vm.day ? undefined : formatDay(w.day, DAY.monthDay) } : null;
    }
    case "spo2":
      return vm.spo2 !== null ? { value: `${vm.spo2}%` } : null;
    case "mood": {
      const m = vm.moods.at(-1)?.data as LogData["moods"] | undefined;
      return m ? { value: MOOD_LABEL[m.moods[0] ?? m.valence ?? ""] ?? "Logged" } : null;
    }
    case "symptoms":
      return { value: vm.symptoms.length ? `${vm.symptoms.length} logged` : "None" };
    default:
      return null;
  }
}

/** The route of a log sheet, over Journal's day (`d` left out for today). Food opens Nutrition's food sheet, as halo's does. */
export const logHref = (kind: LogKind, vm: Pick<LogVM, "day" | "today">) => {
  const d = vm.day === vm.today ? "" : `d=${vm.day}`;
  return kind === "food" ? `/food${d && `?${d}`}` : `/log?kind=${kind}${d && `&${d}`}`;
};

function Tile({ k, vm }: { k: LogKind; vm: LogVM }) {
  const shadow = useCardStyle();
  const t = tileValue(k, vm);
  // Short names fit the 96 px tile on one line.
  const label = k === "ovulation" ? "Ovulation" : k === "spo2" ? "SpO₂" : KIND_LABEL[k];
  return (
    <Press
      activeScale={0.96}
      accessibilityRole="button"
      accessibilityLabel={t ? `${label}, ${t.value}${t.sub ? ` on ${t.sub}` : ""}. Log ${label.toLowerCase()}` : `Log ${label.toLowerCase()}`}
      onPress={() => push(logHref(k, vm))}
      className={`${CARD_CLASS} h-24 w-24 justify-between p-3`}
      style={shadow}
    >
      <CardFill />
      <View className="w-full flex-row items-start justify-between">
        <Icon icon={ICON[k]} size={20} tone="foreground-secondary" strokeWidth={1.75} />
        <Icon icon={Plus} size={16} tone="foreground-secondary" strokeWidth={2} />
      </View>
      <View className="min-w-0">
        {t && (
          <Text numberOfLines={1} className="font-numeric text-[15px] font-bold leading-5 tabular-nums">
            {t.value}
          </Text>
        )}
        <Text className="text-[13px] font-semibold leading-[18px]">{label}</Text>
      </View>
    </Press>
  );
}

export function LogTiles({ vm }: { vm: LogVM }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={104} decelerationRate="fast" accessibilityLabel="Log" className="-mx-4" contentContainerClassName="gap-2 px-4 pb-1">
      {vm.kinds.map((k) => (
        <Tile key={k} k={k} vm={vm} />
      ))}
    </ScrollView>
  );
}
