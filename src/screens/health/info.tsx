// The Health screens' info-card copy, from pulse's pages, reworded for the Pulse engine. The web's <p> is a <Text> styled as
// the info card's body (the same as src/screens/_lib/info.tsx's, which does not export it). Each card is an object of
// getters, so the text resolves when the card opens, in the language then in use.
import type { ReactNode } from "react";
import { View } from "react-native";
import { i18n } from "@/i18n/config";
import { Text } from "@/ui/Text";
import type { InfoContent } from "@/ui/shells/InfoButton";

function P({ children }: { children: ReactNode }) {
  return <Text className="text-[15px] leading-[22px] text-foreground-body">{children}</Text>;
}

export const MONITOR_INFO: InfoContent = {
  get title() {
    return i18n.t("health:info.monitorTitle");
  },
  get body() {
    return <P>{i18n.t("health:info.monitorBody")}</P>;
  },
};

const LEVELS = [
  { swatch: "bg-stress-low", key: "info.stressLow" },
  { swatch: "bg-stress-medium", key: "info.stressMedium" },
  { swatch: "bg-stress-high", key: "info.stressHigh" },
] as const;

export const STRESS_INFO: InfoContent = {
  get title() {
    return i18n.t("health:info.stressTitle");
  },
  get body() {
    return (
      <>
        <P>{i18n.t("health:info.stressIntro")}</P>
        <View className="gap-2">
          {LEVELS.map((l) => (
            <View key={l.swatch} className="flex-row items-start gap-3">
              <View accessibilityElementsHidden className={`mt-1.5 size-2.5 shrink-0 rounded-sm ${l.swatch}`} />
              <View className="flex-1">
                <P>{i18n.t(`health:${l.key}`)}</P>
              </View>
            </View>
          ))}
        </View>
        <P>{i18n.t("health:info.stressNote")}</P>
      </>
    );
  },
};

export const FITNESS_INFO: InfoContent = {
  get title() {
    return i18n.t("health:info.fitnessTitle");
  },
  get body() {
    return <P>{i18n.t("health:info.fitnessBody")}</P>;
  },
};

export const HEALTHSPAN_INFO: InfoContent = {
  get title() {
    return i18n.t("health:info.healthspanTitle");
  },
  get body() {
    return <P>{i18n.t("health:info.healthspanBody")}</P>;
  },
};

export const HEART_RATE_INFO: InfoContent = {
  get title() {
    return i18n.t("health:info.hrTitle");
  },
  get body() {
    return (
      <>
        <P>{i18n.t("health:info.hrBody1")}</P>
        <P>{i18n.t("health:info.hrBody2")}</P>
        <P>{i18n.t("health:info.hrBody3")}</P>
      </>
    );
  },
};
