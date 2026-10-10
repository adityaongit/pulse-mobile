import { useLocalSearchParams } from "expo-router";
import { PlusSheet } from "@/screens/home/PlusMenu";

// The menu under My Day's "+" (src/screens/home/PlusMenu.tsx); `label` is "Add to today" or "Add to Mon., Sep. 28".
export default function Plus() {
  const { label } = useLocalSearchParams<{ label?: string }>();
  return <PlusSheet label={label ?? "Add to today"} />;
}
