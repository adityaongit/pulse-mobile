import { View } from "react-native";
import { formatDay } from "@/lib/format";
import { quantity } from "@/lib/units";
import type { WeekDay } from "@/queries/journalExtras";
import { Card } from "@/ui/Card";
import { ColumnChart } from "@/ui/charts/ColumnChart";
import { cn } from "@/ui/cn";
import { CAPTION, LABEL } from "@/ui/metrics/primitives";
import { Text } from "@/ui/Text";

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

/** Journal's week beside the log: water and food for the seven days ending on the selected day, that day highlighted. */
export function WeekCard({ week, day }: { week: WeekDay[]; day: string }) {
  // Water in the person's units (src/lib/units.ts); the week's days come in ml.
  const water = quantity("ml");
  const rows = [
    { key: "water" as const, title: "Water", unit: water.unit, shown: water.value },
    { key: "kcal" as const, title: "Food", unit: "kcal", shown: (v: number) => v },
  ];
  return (
    <Card className="gap-4 px-4">
      {rows.map((r) => {
        const values = week.map((w) => {
          const v = w[r.key];
          return v === null ? null : r.shown(v);
        });
        const a = avg(values);
        return (
          <View key={r.key} accessibilityLabel={`${r.title}, last 7 days`} className="gap-1">
            <View className="flex-row items-baseline justify-between gap-3">
              <Text accessibilityRole="header" className={LABEL}>
                {r.title}
              </Text>
              <Text className={cn(CAPTION, "tabular-nums")}>{a === null ? "No data" : `avg ${a.toLocaleString("en-US")} ${r.unit}`}</Text>
            </View>
            <ColumnChart
              summary={`${r.title} per day for the 7 days to ${formatDay(day, { month: "short", day: "numeric" })}`}
              format="grouped"
              unit={r.unit}
              data={week.map((w, i) => ({ label: formatDay(w.day, { weekday: "short" }), title: formatDay(w.day, { weekday: "short", month: "short", day: "numeric" }), value: values[i], highlight: w.day === day }))}
            />
          </View>
        );
      })}
    </Card>
  );
}
