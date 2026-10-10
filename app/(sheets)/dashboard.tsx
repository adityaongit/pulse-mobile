import { useLocalSearchParams } from "expo-router";
import { EditDashboardSheet } from "@/screens/home/EditDashboard";

// Home's My Dashboard editor, a full-screen sheet opened by CUSTOMIZE (src/screens/home/EditDashboard.tsx).
export default function Dashboard() {
  const { keys, empty } = useLocalSearchParams<{ keys?: string; empty?: string }>();
  return <EditDashboardSheet keys={keys} empty={empty} />;
}
