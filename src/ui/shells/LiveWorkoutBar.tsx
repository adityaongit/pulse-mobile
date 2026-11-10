// While a workout records, a slim bar over the tab bar: the activity, its time and the bpm, one tap back into it.
// WHOOP locks the app to its live screen; its members ask for exactly this minimised form instead.
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { ChevronUp, Heart } from "lucide-react-native";
import { i18n } from "@/i18n/config";
import { workoutRecorder } from "@/live/workoutRecorder";
import { push } from "../navigate";
import { Press } from "../Press";
import { Text } from "../Text";
import { useTheme } from "../theme";

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
};

export function LiveWorkoutBar() {
  const { c } = useTheme();
  const active = useSyncExternalStore(workoutRecorder.subscribe, () => workoutRecorder.getSnapshot().active, () => workoutRecorder.getSnapshot().active);
  if (!active) return null;
  const paused = active.status !== "recording";
  const name = i18n.t(`workouts:recorder.types.${active.type}`);
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={i18n.t("workouts:live.open", { name })}
      onPress={() => push("/workout/live")}
      activeScale={0.98}
      className={paused ? "h-12 flex-row items-center gap-3 rounded-2xl bg-secondary px-4" : "h-12 flex-row items-center gap-3 rounded-2xl bg-strain px-4"}
    >
      <View className={paused ? "size-2 rounded-full bg-warning" : "size-2 rounded-full bg-on-strain"} />
      <Text className={paused ? "flex-1 text-[13px] font-bold uppercase tracking-[0.1em] text-foreground" : "flex-1 text-[13px] font-bold uppercase tracking-[0.1em] text-on-strain"} numberOfLines={1}>
        {paused ? i18n.t("workouts:live.pausedBar", { name }) : name}
      </Text>
      {!paused && active.lastBpm !== null && (
        <View className="flex-row items-center gap-1">
          <Heart size={14} color={c["on-strain"]} fill={c["on-strain"]} />
          <Text className="font-numeric text-[15px] font-bold text-on-strain">{active.lastBpm}</Text>
        </View>
      )}
      <Text className={paused ? "font-numeric text-[15px] font-bold tabular-nums text-foreground" : "font-numeric text-[15px] font-bold tabular-nums text-on-strain"}>{clock(active.activeMs)}</Text>
      <ChevronUp size={18} color={paused ? c.foreground : c["on-strain"]} />
    </Press>
  );
}
