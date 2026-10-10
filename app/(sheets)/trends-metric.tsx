import { useLocalSearchParams } from "expo-router";
import { MetricSheetBody } from "@/screens/trends/MetricSheet";

// The Trends metric picker, opened from the picker row on /trends (src/screens/trends/MetricSheet.tsx).
export default function TrendsMetric() {
  const { current, r } = useLocalSearchParams<{ current?: string; r?: string }>();
  return <MetricSheetBody current={current} r={r} />;
}
