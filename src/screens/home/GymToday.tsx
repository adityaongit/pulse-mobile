// Home's gym tile: one row. The glyph, what the day's workout is (up next in the split, in progress, or done), and two
// round keys: log a weight, and start or resume. Tapping the row opens the template, the running workout or today's.
import { useState } from "react";
import { View } from "react-native";
import { useIsFocused } from "expo-router";
import { useTranslation } from "react-i18next";
import { Check, Dumbbell, Play, Weight } from "lucide-react-native";
import { startSession } from "@/actions/gym";
import { ago } from "@/lib/format";
import { getHomeGym, type HomeGymVM } from "@/queries/homeGym";
import { actionCtx, dataChanged } from "@/state/app";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { push } from "@/ui/navigate";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { clockText, lengthText, useNow } from "../gym/parts";
import { useScreen } from "../useScreen";

export function GymToday() {
  const { t } = useTranslation("gym");
  const { data } = useScreen(getHomeGym, ["home-gym"]);
  const [pending, setPending] = useState(false);
  const cardStyle = useCardStyle();
  if (!data) return null;
  const { active, suggested, doneToday } = data;

  const start = async () => {
    if (pending) return;
    if (active) return push(`/gym/session/${active.sessionId}`);
    setPending(true);
    haptic.tap();
    // No try/finally: the React Compiler skips a component that has one.
    const res = await startSession(actionCtx(), suggested ? { routineId: suggested.routineId } : {}).catch(() => null);
    setPending(false);
    if (!res || !res.ok) return;
    dataChanged("gym");
    push(`/gym/session/${res.data.session.id}`);
  };
  const open = () =>
    push(active ? `/gym/session/${active.sessionId}` : doneToday ? `/gym/session/${doneToday.sessionId}` : suggested ? `/gym/routine/${suggested.routineId}` : "/gym");

  const state = active ? "active" : doneToday ? "done" : "next";
  return (
    <Press activeScale={0.98} accessibilityRole="link" onPress={open} className={cn(CARD_CLASS, "flex-row items-center gap-3 py-3.5 pl-4 pr-3.5")} style={cardStyle}>
      <CardFill />
      <View className={cn("size-11 items-center justify-center rounded-2xl", state === "done" ? "bg-optimal/15" : "bg-strain/15")}>
        <Icon icon={state === "done" ? Check : Dumbbell} size={22} tone={state === "done" ? "optimal-text" : "strain-text"} strokeWidth={state === "done" ? 2.6 : 1.9} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={cn("text-[11px] font-bold uppercase leading-4 tracking-[0.1em]", state === "active" ? "text-strain-text" : state === "done" ? "text-optimal-text" : "text-muted-foreground")}>
          {state === "active" ? t("card.inProgress") : state === "done" ? t("card.done") : suggested ? t("card.upNext") : t("card.title")}
        </Text>
        <Text className="text-[19px] font-bold leading-6 tracking-[-0.01em]" numberOfLines={1}>
          {active?.name ?? doneToday?.name ?? suggested?.name ?? t("card.startEmpty")}
        </Text>
        <Meta data={data} />
      </View>
      {!active && (
        <Press accessibilityRole="button" accessibilityLabel={t("card.logWeight")} onPress={() => push("/scale")} className="size-10 items-center justify-center rounded-full bg-secondary">
          <Icon icon={Weight} size={18} tone="foreground-secondary" />
        </Press>
      )}
      {!doneToday && (
        <Press
          accessibilityRole="button"
          accessibilityLabel={active ? t("card.resume", { name: active.name }) : suggested ? t("card.start", { name: suggested.name }) : t("card.startEmpty")}
          disabled={pending}
          activeScale={0.92}
          onPress={() => void start()}
          className="size-[46px] items-center justify-center rounded-full bg-foreground"
        >
          <View className="ml-0.5">
            <Icon icon={Play} size={18} tone="background" strokeWidth={2.4} />
          </View>
        </Press>
      )}
    </Press>
  );
}

/** The line under the name. The running workout's clock ticks here only, and only while Home is in front. */
function Meta({ data }: { data: HomeGymVM }) {
  const { t } = useTranslation("gym");
  const focused = useIsFocused();
  const now = useNow(focused && !!data.active);
  const { active, doneToday, suggested } = data;
  const text = active
    ? t("card.progress", { done: active.done, total: active.total, time: clockText(now - active.startTs) })
    : doneToday
      ? t("card.summary", { count: doneToday.sets, time: lengthText(doneToday.seconds) })
      : suggested
        ? [t("card.exercises", { count: suggested.exercises }), suggested.lastTs != null ? ago(suggested.lastTs * 1000, now * 1000) : null].filter(Boolean).join(" · ")
        : t("card.noTemplate");
  return (
    <Text className="font-numeric text-[12.5px] leading-4 tabular-nums text-muted-foreground" numberOfLines={1}>
      {text}
    </Text>
  );
}
