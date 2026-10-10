import { useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { store } from "@/data/store";
import { loadDemoData, type SeedPhase, type SeedProgress, type SeedResult } from "@/seed/load";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Ground } from "@/ui/Ground";
import { Text } from "@/ui/Text";

type State = { status: "idle" } | { status: "running"; progress: SeedProgress | null } | { status: "done"; result: SeedResult } | { status: "error"; message: string };

const PHASES: { phase: SeedPhase; label: string; unit: string }[] = [
  { phase: "generate", label: "Generating", unit: "days" },
  { phase: "write", label: "Writing", unit: "days" },
  { phase: "score", label: "Scoring", unit: "" },
];
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

// Dev only (the More tab links here in development): fills this phone's database with 180 days of generated data ending
// now and scores it, as pulse's demo mode does. src/seed/load.ts refuses a database that already holds data.
export default function DemoData() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: "idle" });

  const run = async () => {
    setState({ status: "running", progress: null });
    try {
      const result = await loadDemoData(store, { onProgress: (progress) => setState({ status: "running", progress }) });
      setState({ status: "done", result });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const p = state.status === "running" ? state.progress : null;
  const step = PHASES.findIndex((x) => x.phase === p?.phase);
  return (
    <View className="flex-1 bg-background">
      <Ground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 48 }}>
        <View className="gap-4 px-4">
          <Text accessibilityRole="header" className="text-[28px] font-semibold leading-9 tracking-[-0.01em]">
            Load demo data
          </Text>
          <Text className="text-[15px] leading-[22px] text-foreground-secondary">
            Fills this app with 180 days of generated data ending now, then scores it, as the web app&apos;s demo mode does. It replaces your profile with the demo person&apos;s, and only works on an empty app: delete everything in Settings first.
          </Text>

          {state.status !== "running" && state.status !== "done" && <Button onPress={run}>Load demo data</Button>}

          {state.status === "running" && (
            <Card className="gap-3 px-4">
              <Text className="text-[15px] font-semibold leading-[22px]">{step < 0 ? "Starting" : `Step ${step + 1} of 3: ${PHASES[step].label}`}</Text>
              <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: p?.total ?? 1, now: p?.done ?? 0 }} className="h-2 overflow-hidden rounded-full bg-foreground/10">
                <View className="h-2 rounded-full bg-primary" style={{ width: `${p ? Math.round((100 * p.done) / p.total) : 0}%` }} />
              </View>
              {p && PHASES[step].unit !== "" && (
                <Text className="font-numeric text-xs leading-4 tabular-nums text-muted-foreground">
                  {p.done} of {p.total} {PHASES[step].unit}
                </Text>
              )}
            </Card>
          )}

          {state.status === "error" && (
            <Card className="gap-1 px-4">
              <Text className="text-[15px] font-semibold leading-[22px]">Could not load the demo data</Text>
              <Text className="text-[15px] leading-[22px] text-foreground-secondary">{state.message}</Text>
            </Card>
          )}

          {state.status === "done" && (
            <>
              <Card className="gap-2 px-4">
                <Text className="text-[15px] font-semibold leading-[22px]">
                  Loaded {state.result.days} days, {state.result.rows} rows
                </Text>
                {PHASES.map((x) => (
                  <View key={x.phase} className="flex-row justify-between">
                    <Text className="text-[15px] leading-[22px] text-foreground-secondary">{x.label}</Text>
                    <Text className="font-numeric text-[15px] leading-[22px] tabular-nums">{seconds(state.result.ms[x.phase])}</Text>
                  </View>
                ))}
              </Card>
              <Button onPress={() => router.replace("/")}>Open Home</Button>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
