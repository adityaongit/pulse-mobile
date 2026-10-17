import { View } from "react-native";
import { partColor } from "@/lib/bands";
import { hmm } from "@/lib/format";
import { cn } from "../cn";
import { Text } from "../Text";
import { useTheme } from "../theme";
import { LABEL } from "./primitives";

export type BreakdownItem = { key: string; label: string; detail?: string; value: number };

/**
 * A Trend View breakdown (spec §11 R29): a caps title with its unit in muted text ("Strain breakdown (days)"), one
 * segmented bar in proportion, then a row per part: colour square, bold count ("6x") or duration ("1:57"), label and
 * threshold ("Optimal (80%+)"). Parts with nothing in them keep their row but take no room in the bar.
 */
export function BreakdownBar({ title, unit, items }: { title: string; unit: "days" | "duration"; items: BreakdownItem[] }) {
  const { css } = useTheme();
  const total = items.reduce((a, i) => a + i.value, 0);
  const [name, aside] = title.split(/ (?=\()/);
  const amount = (v: number) => (unit === "days" ? `${v}x` : hmm(v));
  const live = items.filter((i) => i.value > 0);
  return (
    <View accessibilityLabel={title} className="min-w-0">
      <Text accessibilityRole="header" className={cn(LABEL, "text-foreground")}>
        {name} {!!aside && <Text className="text-muted-foreground">{aside}</Text>}
      </Text>
      <View accessibilityElementsHidden className="mt-3 h-2.5 flex-row gap-0.5 overflow-hidden rounded-full bg-muted">
        {/* `{ key, value }` destructured: Reanimated's Babel plugin warns on any `x.value` inside an inline style. */}
        {total > 0 && live.map(({ key, value }, k) => <View key={key} className={cn("h-full", k === 0 && "rounded-l-full", k === live.length - 1 && "rounded-r-full")} style={{ flexGrow: value, flexBasis: 0, backgroundColor: css(partColor(key)) }} />)}
      </View>
      <View className="mt-3 gap-2">
        {items.map((i) => (
          <View key={i.key} className="flex-row items-center gap-2.5">
            <View className="size-2.5 shrink-0 rounded-xs" style={{ backgroundColor: css(partColor(i.key)) }} />
            {/* The web's min-w-[3.5ch]: 3.5 × the 0 of Barlow Bold at 15 px (0.57 em) = 30 px. */}
            <Text className="min-w-[30px] font-numeric text-[15px] font-bold leading-5 tabular-nums">{amount(i.value)}</Text>
            <Text className="min-w-0 shrink text-[15px] leading-5 text-foreground-secondary">
              {i.label}
              {!!i.detail && <Text className="text-muted-foreground"> ({i.detail})</Text>}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
